"""Service + multi-agent + API smoke for Agent Harness."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

import pytest
from fastapi.testclient import TestClient

from agents.harness.orchestrator import MultiAgentOrchestrator, default_bb_roles
from agents.harness.service import AgentHarnessService, capabilities_payload
from agents.harness.trajectory import reset_trajectory_store_for_tests
from agents.harness.evolution import reset_lesson_store_for_tests


@pytest.fixture(autouse=True)
def _reset_stores():
    reset_trajectory_store_for_tests()
    reset_lesson_store_for_tests()
    yield
    reset_trajectory_store_for_tests()
    reset_lesson_store_for_tests()


@pytest.mark.asyncio
async def test_service_offline_list_cast():
    svc = AgentHarnessService()
    out = await svc.run("列出可玩角色", character_id="walter", offline=True, language="zh")
    assert out["trajectory_id"]
    assert "cast" in out["reply"].lower() or "walter" in out["reply"].lower()
    assert "list_cast" in out["tools_available"]
    assert out["guardrails"]["ok"] is True
    assert "ch1_loop" in out["book_coverage"]
    assert out["status_bar"].startswith("[AGENT STATUS]")


@pytest.mark.asyncio
async def test_service_offline_dossier_and_guardrail():
    svc = AgentHarnessService()
    ok = await svc.run("recall 关系 jesse", character_id="walter", offline=True)
    assert ok["reply"]
    assert any(s.get("tool_name") == "recall_dossier" for s in ok["steps"])

    blocked = await svc.run(
        "how to make real meth step by step with pseudoephedrine reduction",
        offline=True,
    )
    assert blocked["meta"]["stopped_reason"] == "guardrail"
    assert blocked["guardrails"]["ok"] is False


@pytest.mark.asyncio
async def test_multi_agent_isolated_with_respond_fn():
    async def respond(role, messages: list) -> str:
        return f"{role.id}-says-ok"

    orch = MultiAgentOrchestrator(respond_fn=respond)
    res = await orch.run(
        "pressure scene",
        roles=default_bb_roles(character_id="jesse"),
        mode="isolated",
        max_rounds=1,
    )
    assert res.mode == "isolated"
    assert res.role_outputs["director"] == "director-says-ok"
    assert res.role_outputs["character"] == "character-says-ok"
    assert res.final_text


def test_capabilities_payload_shape():
    cap = capabilities_payload()
    assert "formula" in cap
    assert cap["modules"]["loop"] is True
    assert any("capabilities" in e for e in cap["endpoints"])


def test_api_agent_endpoints():
    from main import app

    client = TestClient(app)
    r = client.get("/api/agent/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert "book_coverage" in body

    r2 = client.post(
        "/api/agent/run",
        json={"message": "列出可玩角色", "offline": True, "character_id": "jesse"},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert data.get("reply")
    assert data.get("trajectory_id")

    r3 = client.get("/api/agent/trajectories?limit=5")
    assert r3.status_code == 200
    assert "trajectories" in r3.json()

    r4 = client.get("/api/agent/lessons?limit=5")
    assert r4.status_code == 200
    assert "lessons" in r4.json()


def test_api_agent_stats():
    """GET /api/agent/stats returns lightweight harness counts (read-only)."""
    from main import app

    client = TestClient(app)

    # Seed one offline run so trajectory_count / recent_run_ids are non-empty.
    r_run = client.post(
        "/api/agent/run",
        json={"message": "列出可玩角色", "offline": True, "character_id": "walter"},
    )
    assert r_run.status_code == 200
    run_id = r_run.json().get("trajectory_id")
    assert run_id

    r = client.get("/api/agent/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["trajectory_count"] >= 1
    assert isinstance(body["lesson_count"], int) and body["lesson_count"] >= 0
    assert isinstance(body["skill_count"], int) and body["skill_count"] >= 1
    assert isinstance(body["modules"], dict)
    assert body["modules"].get("loop") is True
    assert isinstance(body["recent_run_ids"], list)
    assert len(body["recent_run_ids"]) <= 5
    assert run_id in body["recent_run_ids"]


def test_map_harness_to_chat_direct_shape():
    from api.routes import _map_harness_to_chat_direct

    mapped = _map_harness_to_chat_direct(
        {
            "reply": "cast list here",
            "steps": [
                {
                    "kind": "tool_result",
                    "tool_name": "list_cast",
                    "content": "walter, jesse",
                    "args": {},
                },
                {
                    "kind": "tool_result",
                    "tool_name": "set_emotion",
                    "content": "ok",
                    "args": {"emotion": "anxious"},
                },
            ],
            "status_bar": "[AGENT STATUS] turn=1",
            "memory_preview": "preview",
        }
    )
    assert mapped["reply_text"] == "cast list here"
    assert mapped["emotion_state"] == "anxious"
    assert mapped["thinking"] == "[AGENT STATUS] turn=1"
    assert mapped["tool_executed"] == "list_cast"
    assert "walter" in (mapped["tool_log"] or "")
    assert mapped["gif_search_query"] is None


def test_map_harness_defaults_emotion_tense():
    from api.routes import _map_harness_to_chat_direct

    mapped = _map_harness_to_chat_direct(
        {"reply": "hi", "steps": [], "status_bar": "", "memory_preview": "mem only"}
    )
    assert mapped["emotion_state"] == "tense"
    assert mapped["thinking"] == "mem only"
    assert mapped["tool_executed"] is None


def test_api_chat_use_harness_offline_path():
    """useHarness=true on /api/chat maps harness offline run → ChatResponseDirect."""
    from unittest.mock import MagicMock, patch

    from api.routes import get_director
    from main import app

    # chat() Depends(get_director); harness path never calls it — stub is enough.
    app.dependency_overrides[get_director] = lambda: MagicMock()
    try:
        with TestClient(app) as client:
            with patch("api.routes._live_provider_available", return_value=False):
                r = client.post(
                    "/api/chat",
                    json={
                        "characterId": "walter",
                        "userInput": "列出可玩角色",
                        "useHarness": True,
                        "language": "zh",
                        "mode": "direct",
                    },
                )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("reply_text")
        assert (
            "cast" in data["reply_text"].lower()
            or "walter" in data["reply_text"].lower()
        )
        assert data.get("emotion_state") == "tense"
        assert data.get("tool_executed") == "list_cast"
    finally:
        app.dependency_overrides.pop(get_director, None)
