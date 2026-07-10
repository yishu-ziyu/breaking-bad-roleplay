"""TDD: ProviderFacade.call_model_with_tools — mocked HTTP, both providers.

Sets dummy env vars at import time so importing ``agents.provider`` (which
triggers ``config.settings`` construction) does not require a real ``.env``.
The Facade's HTTP client is replaced with a ``FakeClient`` that returns
canned tool_use responses, so no network is touched.
"""
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from types import SimpleNamespace

from agents.provider import ProviderFacade
from agents.tools import Tool


def _tool() -> Tool:
    return Tool(
        name="lab_pressure_simulator",
        description="Simulate reactor pressure.",
        parameters_json_schema={
            "type": "object",
            "properties": {"compound": {"type": "string"}},
            "required": ["compound"],
        },
    )


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, mode: str):
        self.mode = mode

    async def post(self, url, headers=None, json=None):
        if self.mode == "openai":
            return FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {
                                            "name": "lab_pressure_simulator",
                                            "arguments": '{"compound": "meth"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                }
            )
        # anthropic-compatible (minimax / cliproxy)
        return FakeResponse(
            {
                "stop_reason": "tool_use",
                "content": [
                    {"type": "text", "text": "Checking reactor."},
                    {
                        "type": "tool_use",
                        "id": "tu_1",
                        "name": "lab_pressure_simulator",
                        "input": {"compound": "meth"},
                    },
                ],
            }
        )

    async def aclose(self):
        return None


def _facade(mode: str) -> ProviderFacade:
    settings = SimpleNamespace(
        minimax_api_key="k",
        stepfun_api_key="k",
        cli_proxy_base_url="http://x",
        cli_proxy_api_key="k",
        cli_proxy_default_model="m",
    )
    f = ProviderFacade(settings=settings)
    f._client = FakeClient(mode)
    return f


async def test_minimax_tool_use():
    res = await _facade("anthropic").call_model_with_tools(
        [{"role": "user", "content": "cook"}], "minimax/MiniMax-M3", [_tool()]
    )
    assert res.stop_reason == "tool_use"
    assert len(res.tool_calls) == 1
    assert res.tool_calls[0].name == "lab_pressure_simulator"
    assert res.tool_calls[0].arguments == {"compound": "meth"}


async def test_stepfun_tool_use():
    res = await _facade("openai").call_model_with_tools(
        [{"role": "user", "content": "cook"}], "stepfun/step-3.7-flash", [_tool()]
    )
    assert len(res.tool_calls) == 1
    assert res.tool_calls[0].name == "lab_pressure_simulator"
    assert res.tool_calls[0].arguments == {"compound": "meth"}


async def test_cliproxy_tool_use():
    res = await _facade("anthropic").call_model_with_tools(
        [{"role": "user", "content": "cook"}], "cliproxy/m", [_tool()]
    )
    assert res.stop_reason == "tool_use"
    assert res.tool_calls[0].name == "lab_pressure_simulator"
    assert res.tool_calls[0].arguments == {"compound": "meth"}


async def test_cliproxy_preserves_block_content_in_tool_loop():
    """Outgoing messages carrying tool_use / tool_result blocks (the shape
    the tool loop produces) must be sent as-is to CLIProxy — NOT flattened
    with str(). Regression guard for the CRITICAL message-ordering bug."""
    captured: dict = {}

    async def _capture_post(url, headers=None, json=None):
        captured["json"] = json
        return FakeResponse(
            {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "done"}],
            }
        )

    f = _facade("anthropic")
    f._client.post = _capture_post

    loop_messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "cook"},
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "lab_pressure_simulator",
                    "input": {"compound": "meth"},
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": "state=STABLE"}
            ],
        },
    ]
    await f.call_model_with_tools(loop_messages, "cliproxy/m", [_tool()])

    sent = captured["json"]
    asst = next(m for m in sent["messages"] if m["role"] == "assistant")
    assert isinstance(asst["content"], list), "assistant tool_use block must survive"
    assert asst["content"][0]["type"] == "tool_use"

    user_block = next(
        m
        for m in sent["messages"]
        if m["role"] == "user" and isinstance(m["content"], list)
    )
    assert user_block["content"][0]["type"] == "tool_result"
