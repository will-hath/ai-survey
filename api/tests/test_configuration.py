from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from api.configuration import load_config, resolve_agent, resolve_belief
from api.index import app as flask_app
from api import index as api_index


def test_load_config_returns_agents_and_beliefs():
    config = load_config()
    assert config.agents, "Expected at least one agent in config"
    assert config.beliefs, "Expected at least one belief in config"


def test_resolve_agent_returns_expected_display_name():
    agent = resolve_agent('pd')
    assert agent.display_name == 'Dr. Alex Chen'
    assert agent.prompt_id


def test_resolve_belief_contains_doc_url():
    belief = resolve_belief('20')
    assert 'election' in belief.name.lower()
    assert belief.doc_url.startswith('https://docs.google.com/')


def _is_pdf_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.path.lower().endswith('.pdf'):
        return True
    params = parse_qs(parsed.query)
    formats = {value.lower() for values in params.get('format', []) for value in values.split(',')}
    return 'pdf' in formats


def test_all_beliefs_reference_pdf_documents():
    config = load_config()
    assert config.beliefs, "No beliefs configured"
    for belief in config.beliefs.values():
        assert belief.doc_url, f"Belief {belief.key} missing doc_url"
        assert _is_pdf_url(belief.doc_url), f"Belief {belief.key} doc_url is not a PDF link"


class FakeConversationItems:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        role = kwargs["items"][0]["role"]
        content = kwargs["items"][0]["content"]
        return SimpleNamespace(
            data=[
                {
                    "id": "msg_123",
                    "type": "message",
                    "role": role,
                    "content": content,
                    "created_at": 1,
                    "status": "completed",
                }
            ]
        )


class FakeConversations:
    def __init__(self):
        self.items = FakeConversationItems()
        self.created_metadata = None

    def create(self, metadata):
        self.created_metadata = metadata
        return SimpleNamespace(id="conv_test", metadata=metadata)


class FakeOpenAI:
    def __init__(self):
        self.conversations = FakeConversations()
        self.responses = SimpleNamespace(create=self._raise_unexpected_call)

    @staticmethod
    def _raise_unexpected_call(*args, **kwargs):
        raise AssertionError("responses.create should not be called in this test")



def test_create_session_endpoint(monkeypatch):
    api_index.PASSWORD = "testpass"
    created_clients = []

    def fake_openai_factory():
        client = FakeOpenAI()
        created_clients.append(client)
        return client

    monkeypatch.setattr(api_index.openai, "OpenAI", fake_openai_factory)
    flask_app.testing = True
    client = flask_app.test_client()

    response = client.post(
        "/api/session",
        headers={"Authorization": "Bearer testpass"},
        json={
            "participantName": "Test User",
            "responderId": "R_test123",
            "agentKey": "pd",
            "beliefKey": "20",
        },
    )

    assert response.status_code == 200, response.data
    payload = response.get_json()
    assert payload["conversation_id"] == "conv_test"
    assert payload["metadata"]["responderId"] == "R_test123"
    assert payload["metadata"]["agentKey"] == "pd"
    assert payload["metadata"]["beliefKey"] == "20"

    fake_client = created_clients[-1]
    assert fake_client.conversations.created_metadata == {
        "participant_name": "Test User",
        "responder_id": "R_test123",
        "agent_key": "pd",
        "belief_key": "20",
    }
    item_calls = fake_client.conversations.items.calls
    # First call attaches the document, second sends the intro message
    assert len(item_calls) == 2
    belief_context = item_calls[0]
    assert belief_context["items"][0]["role"] == "system"
    assert belief_context["items"][0]["content"][1]["file_url"].endswith("format=pdf")
