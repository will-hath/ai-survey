import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Mapping, NotRequired, Optional, TypedDict, cast

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "scenarios.json"


class AgentPayload(TypedDict):
    key: str
    slug: str
    displayName: str
    title: str
    avatarInitials: str
    promptId: str
    description: NotRequired[Optional[str]]


class BeliefPayload(TypedDict):
    key: str
    name: str
    docUrl: str
    question: str
    summary: NotRequired[Optional[str]]


@dataclass(frozen=True)
class Agent:
    key: str
    slug: str
    display_name: str
    title: str
    avatar_initials: str
    prompt_id: str
    description: Optional[str] = None

    @classmethod
    def from_dict(cls, payload: AgentPayload) -> "Agent":
        return cls(
            key=payload["key"],
            slug=payload["slug"],
            display_name=payload["displayName"],
            title=payload["title"],
            avatar_initials=payload["avatarInitials"],
            prompt_id=payload["promptId"],
            description=payload.get("description"),
        )

    def to_public_dict(self) -> Dict[str, Optional[str]]:
        return {
            "key": self.key,
            "slug": self.slug,
            "displayName": self.display_name,
            "title": self.title,
            "avatarInitials": self.avatar_initials,
            "promptId": self.prompt_id,
            "description": self.description,
        }


@dataclass(frozen=True)
class Belief:
    key: str
    name: str
    doc_url: str
    question: str
    openingMessage: str
    
    @classmethod
    def from_dict(cls, payload: BeliefPayload) -> "Belief":
        return cls(
            key=payload["key"],
            name=payload["name"],
            doc_url=payload["docUrl"],
            question=payload["question"],
            openingMessage=payload["openingMessage"],
        )

    def to_public_dict(self) -> Dict[str, Optional[str]]:
        return {
            "key": self.key,
            "name": self.name,
            "docUrl": self.doc_url,
            "question": self.question,
            "openingMessage": self.openingMessage,
        }


@dataclass(frozen=True)
class SurveyConfig:
    agents: Dict[str, Agent]
    beliefs: Dict[str, Belief]


@lru_cache(maxsize=1)
def load_config() -> SurveyConfig:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Survey config not found at {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        raw: Dict[str, Any] = json.load(handle)

    agents_payload = cast(Dict[str, AgentPayload], raw.get("agents") or {})
    beliefs_payload = cast(Dict[str, BeliefPayload], raw.get("beliefs") or {})

    agents = {key: Agent.from_dict(value) for key, value in agents_payload.items()}
    beliefs = {key: Belief.from_dict(value) for key, value in beliefs_payload.items()}
    if not agents:
        raise ValueError("At least one agent must be configured.")
    if not beliefs:
        raise ValueError("At least one belief must be configured.")

    return SurveyConfig(agents=agents, beliefs=beliefs)


def resolve_agent(key: str) -> Agent:
    config = load_config()
    agent = config.agents.get(key)
    if not agent:
        raise KeyError(f"Unknown agent key '{key}'")
    return agent


def resolve_belief(key: str) -> Belief:
    config = load_config()
    belief = config.beliefs.get(key)
    if not belief:
        raise KeyError(f"Unknown belief key '{key}'")
    return belief
