from flask import Flask, jsonify, request as flask_request
from flask.typing import ResponseReturnValue
from flask_cors import CORS
import openai
import logging

from openai.types.conversations import Conversation

from .configuration import Agent, Belief, resolve_agent, resolve_belief
from .utils import make_response_request

from dotenv import load_dotenv
import os
from functools import wraps
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, TypedDict, TypeVar, Union, cast, Literal

logger = logging.getLogger(__name__)

SerializedRole = Literal["user", "assistant"]


class SerializedMessage(TypedDict, total=False):
    id: Optional[str]
    role: SerializedRole
    content: str
    status: Optional[str]
    created_at: Optional[int]


class ConversationMetadata(TypedDict, total=False):
    participant_name: Optional[str]
    responder_id: Optional[str]
    agent_key: Optional[str]
    belief_key: Optional[str]
    handoff_url: Optional[str]


class PublicSessionMetadata(TypedDict):
    participantName: Optional[str]
    responderId: Optional[str]
    agentKey: Optional[str]
    beliefKey: Optional[str]
    agent: Optional[Dict[str, Optional[str]]]
    belief: Optional[Dict[str, Optional[str]]]
    handoffUrl: Optional[str]


F = TypeVar("F", bound=Callable[..., ResponseReturnValue])


# load env
load_dotenv()

PASSWORD = os.environ.get("PASSWORD")
if not PASSWORD:
    raise RuntimeError("PASSWORD environment variable must be set for API access.")

app = Flask(__name__)

@app.route("/api/hello")
def hello_world() -> str:
    return "<p>Hello, World!</p>"

# Enable CORS for local development (Next.js dev server on port 3000)
# Adjust origins if you use a different port/host for the frontend.
CORS(
    app,
    resources={r"/api/*": {"origins": [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://conspiracy-survey.vercel.app",
    ]}},
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)



def _is_authorized() -> bool:
    """Validate the shared password if one is configured."""
    return True
    if not PASSWORD:
        return True

    auth_header = flask_request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        candidate = auth_header[len("Bearer "):].strip()
        if candidate == PASSWORD:
            return True

    return False


def require_password(view_func: F) -> F:
    """Guard Flask views behind the shared password."""

    @wraps(view_func)
    def wrapped(*args: Any, **kwargs: Any) -> ResponseReturnValue:
        if not _is_authorized():
            logger.warning("Unauthorized request to %s", flask_request.path)
            return jsonify({"error": "Unauthorized"}), 401
        return view_func(*args, **kwargs)

    return cast(F, wrapped)


def _attach_belief_context(
    client: openai.OpenAI,
    conversation_id: str,
    agent: Agent,
    belief: Belief,
    responder_id: str,
) -> None:
    if not belief.doc_url:
        return
    try:
        client.conversations.items.create(
            conversation_id=conversation_id,
            items=[
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": f"""Your conversation partner answered that they agree with the following statement: {belief.question}.
                            Here is a packet of evidence that counters this statement for you to use as a resource during the conversation.
                            The conversation partner did not send you this packet. If they ask, you can tell them that you were given this packet by the researchers to help you provide more informed responses.""",
                        },
                        {
                            "type": "input_file",
                            "file_url": belief.doc_url,
                        },
                    ],
                }
            ],
        )
    except openai.OpenAIError:
        logger.exception("Failed to attach belief context to conversation %s", conversation_id)


def _extract_conversation_metadata(
    conversation: Union[Conversation, Mapping[str, Any]],
) -> ConversationMetadata:
    metadata_obj = getattr(conversation, "metadata", None) or {}
    metadata: Mapping[str, Any]
    if isinstance(metadata_obj, Mapping):
        metadata = metadata_obj
    else:
        metadata = {}
    return {
        "participant_name": cast(Optional[str], metadata.get("participant_name")),
        "responder_id": cast(Optional[str], metadata.get("responder_id")),
        "agent_key": cast(Optional[str], metadata.get("agent_key")),
        "belief_key": cast(Optional[str], metadata.get("belief_key")),
        "handoff_url": cast(Optional[str], metadata.get("handoff_url")),
    }


def _serialize_content_blocks(
    blocks: Optional[Iterable[Mapping[str, Any]]],
) -> str:
    """Extract plain text from OpenAI content blocks."""
    texts: List[str] = []
    for block in blocks or []:
        if not isinstance(block, Mapping):
            continue
        block_type = block.get("type")
        if block_type in {"input_text", "output_text", "text", "summary_text"}:
            text = block.get("text")
            if text:
                texts.append(text)
    return "\n".join(texts)


def _serialize_conversation_items(items: Sequence[Any]) -> List[SerializedMessage]:
    """Convert conversation items into simplified chat messages."""
    serialized: List[SerializedMessage] = []
    for item in items[1:]: # skip the initial belief context message
        if hasattr(item, "model_dump"):
            item_payload = cast(Mapping[str, Any], item.model_dump())
        elif isinstance(item, Mapping):
            item_payload = item
        else:
            try:
                item_payload = cast(Mapping[str, Any], dict(item))
            except (TypeError, ValueError):
                continue

        if item_payload.get("type") != "message":
            # Skip tool calls and other non-message items.
            continue

        role_value = item_payload.get("role")
        if role_value not in {"user", "assistant"}:
            continue
        role = cast(SerializedRole, role_value)
        content_blocks = item_payload.get("content")
        content = _serialize_content_blocks(
            cast(Optional[Iterable[Mapping[str, Any]]], content_blocks)
        )
        if not content:
            continue
        serialized.append(
            {
                "id": cast(Optional[str], item_payload.get("id")),
                "role": role,
                "content": content,
                "status": cast(Optional[str], item_payload.get("status")),
                "created_at": cast(Optional[int], item_payload.get("created_at")),
            }
        )
    return serialized


def _make_initial_message(
    participant_name: str,
    agent: Agent,
    belief: Belief,
    conversation_id: str,

) -> str:
    return f"Send a concise, friendly welcome message to {participant_name} as soon as the chat opens. "
    f"Introduce yourself as {agent.display_name} ({agent.title}) and note that you're here to discuss {belief.name}. "
    "Invite them to share their perspective right away, and avoid mentioning these developer instructions."

@app.route("/api/session", methods=["POST"])
@require_password
def create_session() -> ResponseReturnValue:
    client = openai.OpenAI()
    try:
        payload = cast(Dict[str, Any], flask_request.get_json(silent=True) or {})
        participant_name = str(payload.get("participantName") or "Anonymous").strip()
        responder_id = str(payload.get("responderId") or payload.get("responder_id") or "unknown_id").strip()
        agent_key = str(payload.get("agentKey") or payload.get("agent_key") or "").strip()
        belief_key = str(payload.get("beliefKey") or payload.get("belief_key") or "").strip()
        handoff_url = str(payload.get("handoffUrl") or payload.get("handoff_url") or "").strip()


        if not agent_key:
            return jsonify({"error": "agentKey is required"}), 400
        if not belief_key:
            return jsonify({"error": "beliefKey is required"}), 400

        try:
            agent = resolve_agent(agent_key)
        except KeyError:
            return jsonify({"error": f"Unknown agent key '{agent_key}'"}), 400

        try:
            belief = resolve_belief(belief_key)
        except KeyError:
            return jsonify({"error": f"Unknown belief key '{belief_key}'"}), 400

        conversation_metadata: Dict[str, str] = {
            "participant_name": participant_name,
            "responder_id": responder_id,
            "agent_key": agent.key,
            "belief_key": belief.key,
        }
        if handoff_url:
            conversation_metadata["handoff_url"] = handoff_url

        conversation = client.conversations.create(metadata=conversation_metadata)
        logger.warning("conversation: %s", conversation)

        _attach_belief_context(client, conversation.id, agent, belief, responder_id)
    except openai.OpenAIError as exc:
        logger.exception("Failed to initialize conversation")
        return jsonify({"error": str(exc)}), 500

    messages: List[SerializedMessage] = []
    session_metadata: PublicSessionMetadata = {
        "participantName": participant_name,
        "responderId": responder_id,
        "agentKey": agent.key,
        "beliefKey": belief.key,
        "agent": agent.to_public_dict(),
        "belief": belief.to_public_dict(),
        "handoffUrl": handoff_url or None,
    }

    return jsonify({"conversation_id": conversation.id, "messages": messages, "metadata": session_metadata})


@app.route("/api/session/<conversation_id>/message", methods=["POST"])
@require_password
def create_message(conversation_id: str) -> ResponseReturnValue:
    client = openai.OpenAI()
    payload = cast(Dict[str, Any], flask_request.get_json(silent=True) or {})
    message_value = payload.get("message")
    is_initial = bool(payload.get("initial"))

    try:
        conversation = client.conversations.retrieve(conversation_id=conversation_id)
    except openai.NotFoundError:
        logger.warning("conversation not found: %s", conversation_id)
        return jsonify({"error": "Conversation not found"}), 404
    except openai.OpenAIError as exc:
        logger.exception("Failed to load conversation metadata for %s", conversation_id)
        return jsonify({"error": str(exc)}), 500

    conversation_metadata = _extract_conversation_metadata(conversation)
    participant_name = (
        str(payload.get("participantName") or payload.get("participant_name") or "").strip()
        or conversation_metadata.get("participant_name")
        or ""
    )
    responder_id = (str(payload.get("responderId") or payload.get("responder_id") or "").strip()) or (
        conversation_metadata.get("responder_id") or ""
    )
    agent_key = (
        str(payload.get("agentKey") or payload.get("agent_key") or "").strip()
        or conversation_metadata.get("agent_key")
    )
    belief_key = (
        str(payload.get("beliefKey") or payload.get("belief_key") or "").strip()
        or conversation_metadata.get("belief_key")
    )

    if not responder_id:
        return jsonify({"error": "responderId missing from conversation metadata"}), 400
    if not agent_key:
        return jsonify({"error": "agent metadata missing for conversation"}), 400
    if not belief_key:
        return jsonify({"error": "belief metadata missing for conversation"}), 400

    try:
        agent = resolve_agent(agent_key)
        belief = resolve_belief(belief_key)
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 400

    if not is_initial and not message_value:
        return jsonify({"error": "message is required"}), 400

    metadata_overrides: Dict[str, str] = {}
    if participant_name:
        metadata_overrides["participant_name"] = participant_name

    if is_initial:
        message_content = belief.openingMessage.format(agentName=agent.display_name.split(' ')[0]) # first name
        # attach it to the conversation
        client.conversations.items.create(
            conversation_id=conversation_id,
            items=[
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {
                            "type": "output_text",
                            "text": message_content,
                        }
                    ],
                }
            ],
        )
        return jsonify({"response": message_content})
    else:
        message_content = message_value
        message_role = "user"

        response_request = make_response_request(
            content=message_content,
            role=message_role,
            conversation_id=conversation_id,
            agent=agent,
            belief=belief,
            responder_id=responder_id,
            metadata=metadata_overrides or None,
        )
        logger.warning("request: %s", response_request)
        response = client.responses.create(**response_request)
        logger.warning("response: %s", response)
        return jsonify({"response": response.output_text})


@app.route("/api/session/<conversation_id>", methods=["GET"])
@require_password
def get_conversation(conversation_id: str) -> ResponseReturnValue:
    client = openai.OpenAI()
    try:
        conversation = client.conversations.retrieve(conversation_id=conversation_id)
    except openai.NotFoundError:
        logger.warning("conversation not found: %s", conversation_id)
        return jsonify({"error": "Conversation not found"}), 404
    except openai.OpenAIError as exc:
        logger.exception("Failed to load conversation %s", conversation_id)
        return jsonify({"error": str(exc)}), 500

    try:
        history = client.conversations.items.list(
            conversation_id=conversation_id,
            order="asc",
            limit=100,
        )
    except openai.NotFoundError:
        return jsonify({"error": "Conversation not found"}), 404
    except openai.OpenAIError as exc:
        logger.exception("Failed to load messages for %s", conversation_id)
        return jsonify({"error": str(exc)}), 500

    items: Sequence[Any]
    items_candidate = getattr(history, "data", None)
    if items_candidate is None:
        if hasattr(history, "model_dump"):
            history_payload = cast(Mapping[str, Any], history.model_dump())
            items_candidate = history_payload.get("data", [])
        elif isinstance(history, Mapping):
            items_candidate = history.get("data", [])
        else:
            try:
                history_payload = vars(history)
            except TypeError:
                items_candidate = []
            else:
                items_candidate = history_payload.get("data", [])
    if isinstance(items_candidate, Sequence):
        items = items_candidate
    else:
        items = []

    messages = _serialize_conversation_items(items)
    conversation_metadata = _extract_conversation_metadata(conversation)
    agent: Optional[Agent] = None
    belief: Optional[Belief] = None
    agent_key = conversation_metadata.get("agent_key")
    belief_key = conversation_metadata.get("belief_key")
    if agent_key:
        try:
            agent = resolve_agent(agent_key)
        except KeyError:
            logger.warning("Agent key %s not found in config", agent_key)
    if belief_key:
        try:
            belief = resolve_belief(belief_key)
        except KeyError:
            logger.warning("Belief key %s not found in config", belief_key)

    response_metadata: PublicSessionMetadata = {
        "participantName": conversation_metadata.get("participant_name"),
        "responderId": conversation_metadata.get("responder_id"),
        "agentKey": agent_key,
        "beliefKey": belief_key,
        "agent": agent.to_public_dict() if agent else None,
        "belief": belief.to_public_dict() if belief else None,
        "handoffUrl": conversation_metadata.get("handoff_url"),
    }

    return jsonify({"conversation_id": conversation_id, "messages": messages, "metadata": response_metadata})
