from typing import Dict, Mapping, Optional

from openai.types.responses.response_create_params import ResponseCreateParamsNonStreaming

from .configuration import Agent, Belief


def _build_metadata(
    responder_id: str,
    agent: Agent,
    belief: Belief,
    extra: Optional[Mapping[str, str]] = None,
) -> Dict[str, str]:
    metadata: Dict[str, str] = {
        "responder_id": responder_id,
        "agent_key": agent.key,
        "belief_key": belief.key,
    }
    if extra:
        metadata.update(extra)
    return metadata


def make_response_request(
    *,
    user_input: str,
    conversation_id: str,
    agent: Agent,
    belief: Belief,
    responder_id: str,
    metadata: Optional[Mapping[str, str]] = None,
) -> ResponseCreateParamsNonStreaming:
    combined_metadata = _build_metadata(responder_id, agent, belief, metadata)
    return ResponseCreateParamsNonStreaming(
        prompt={
            "id": agent.prompt_id,
        },
        input=user_input,
        conversation=conversation_id,
        metadata=combined_metadata,
    )
