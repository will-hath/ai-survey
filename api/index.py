from flask import Flask, jsonify, request as flask_request
from flask_cors import CORS
import openai
import logging

try:
    from .utils import make_response_request
except ImportError:
    from utils import make_response_request

from dotenv import load_dotenv
import os
from functools import wraps

logger = logging.getLogger(__name__)


# load env
load_dotenv()

PASSWORD = os.environ.get("PASSWORD")
if not PASSWORD:
    raise RuntimeError("PASSWORD environment variable must be set for API access.")

INITIAL_ASSISTANT_MESSAGE = ["hi", "i'm supposed to ask you what conspiracy theories you believe in"]

app = Flask(__name__)

@app.route("/api/hello")
def hello_world():
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



def _is_authorized():
    """Validate the shared password if one is configured."""
    if not PASSWORD:
        return True

    auth_header = flask_request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        candidate = auth_header[len("Bearer "):].strip()
        if candidate == PASSWORD:
            return True

    return False


def require_password(view_func):
    """Guard Flask views behind the shared password."""

    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not _is_authorized():
            logger.warning("Unauthorized request to %s", flask_request.path)
            return jsonify({"error": "Unauthorized"}), 401
        return view_func(*args, **kwargs)

    return wrapped


def _serialize_content_blocks(blocks):
    """Extract plain text from OpenAI content blocks."""
    texts = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type in {"input_text", "output_text", "text", "summary_text"}:
            text = block.get("text")
            if text:
                texts.append(text)
    return "\n".join(texts)


def _serialize_conversation_items(items):
    """Convert conversation items into simplified chat messages."""
    serialized = []
    for item in items:
        item_dict = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        if item_dict.get("type") != "message":
            # Skip tool calls and other non-message items.
            continue
        role = item_dict.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = _serialize_content_blocks(item_dict.get("content"))
        if not content:
            continue
        serialized.append(
            {
                "id": item_dict.get("id"),
                "role": role,
                "content": content,
                "status": item_dict.get("status"),
                "created_at": item_dict.get("created_at"),
            }
        )
    return serialized


@app.route("/api/session", methods=["POST"])
@require_password
def create_session():
    client = openai.OpenAI()
    try:
        conversation = client.conversations.create()
        logger.info("conversation: %s", conversation)

        created_items = client.conversations.items.create(
            conversation_id=conversation.id,
            items=[
                {
                    "type": "message",
                    "role": "assistant",
                    "content": message,
                }
                for message in INITIAL_ASSISTANT_MESSAGE
            ],
        )
    except openai.OpenAIError as exc:
        logger.exception("Failed to initialize conversation")
        return jsonify({"error": str(exc)}), 500

    items = getattr(created_items, "data", None)
    if items is None:
        if hasattr(created_items, "model_dump"):
            payload = created_items.model_dump()
            items = payload.get("data", [])
        elif isinstance(created_items, dict):
            items = created_items.get("data", [])
        else:
            items = []

    messages = _serialize_conversation_items(items)
    return jsonify({"conversation_id": conversation.id, "messages": messages})


@app.route("/api/session/<conversation_id>/message", methods=["POST"])
@require_password
def create_message(conversation_id):
    client = openai.OpenAI()
    payload = flask_request.get_json(silent=True) or {}
    message = payload.get("message")
    if not message:
        return jsonify({"error": "message is required"}), 400

    response_request = make_response_request(message, conversation_id)
    logger.info("request: %s", response_request)
    response = client.responses.create(**response_request)
    logger.info("response: %s", response)
    return jsonify({"response": response.output_text})


@app.route("/api/session/<conversation_id>", methods=["GET"])
@require_password
def get_conversation(conversation_id):
    client = openai.OpenAI()
    try:
        history = client.conversations.items.list(
            conversation_id=conversation_id,
            order="asc",
            limit=100,
        )
    except openai.NotFoundError:
        logger.warning("conversation not found: %s", conversation_id)
        return jsonify({"error": "Conversation not found"}), 404
    except openai.OpenAIError as exc:
        logger.exception("Failed to load conversation %s", conversation_id)
        return jsonify({"error": str(exc)}), 500

    items = getattr(history, "data", None)
    if items is None:
        payload = history.model_dump() if hasattr(history, "model_dump") else dict(history)
        items = payload.get("data", [])

    messages = _serialize_conversation_items(items)
    return jsonify({"conversation_id": conversation_id, "messages": messages})
