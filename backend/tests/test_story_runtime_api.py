"""Default Story HTTP path with SQLite and a mocked model transport."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from api import routes
from db.session import Base, get_db
from main import app
from models.schemas import AgentEvent


@pytest.fixture
async def story_api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async def database():
        async with factory() as db:
            yield db
    director = MagicMock()
    director._generate_outline = AsyncMock(return_value="1. Opening\n2. Consequence\n3. Choice")
    director._parse_outline.side_effect = lambda text: text.splitlines()
    director._short_scene_name.return_value = "desert"
    director.provider.call_model = AsyncMock(return_value=json.dumps({
        "verb": "give", "item_id": "phone", "target_id": "jesse",
    }))
    async def perform(**kwargs):
        yield AgentEvent(type="agent_speak", data={"character_id": "Jesse Pinkman", "content": "All right."})
    director._generate_beat = perform
    charge = AsyncMock(return_value=SimpleNamespace(byok=True, remaining=0, cost=0))
    monkeypatch.setattr(routes, "async_session_factory", factory)
    monkeypatch.setattr(routes, "_require_platform_quota", charge)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[routes.get_director] = lambda: director
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, charge
    app.dependency_overrides.clear()
    app.dependency_overrides.update(overrides)
    await engine.dispose()


@pytest.mark.asyncio
async def test_default_story_action_history_and_free_reconnect(story_api):
    client, charge = story_api
    created = await client.post("/api/session/create", json={
        "title": "Test", "task_prompt": "Original premise", "active_character_id": "walter",
        "scenario_id": "desert_crisis", "language": "en",
    })
    assert created.status_code == 200
    data = created.json()
    assert data["runtime_version"] == 1
    path = f"/api/session/{data['session_id']}"
    headers = {"X-Session-Key": data["session_key"]}
    first = await client.get(path + "/stream", headers=headers)
    assert "event: beat_ready" in first.text
    after_first = charge.await_count
    replay = await client.get(path + "/stream", headers=headers)
    assert replay.text == first.text
    assert charge.await_count == after_first

    payload = {"action": "act", "player_input": "Give Jesse the phone", "command_id": "give1", "expected_revision": 1}
    action = await client.post(path + "/action", headers=headers, json=payload)
    assert action.status_code == 200, action.text
    repeat = await client.post(path + "/action", headers=headers, json=payload)
    assert repeat.json()["command_id"] == action.json()["command_id"]
    second = await client.get(path + "/stream?command_id=give1", headers=headers)
    assert second.status_code == 200
    state = await client.get(path + "/state", headers=headers)
    assert state.status_code == 200, state.text
    assert state.json()["world_revision"] == 2
    assert state.json()["world"]["items"]["phone"]["holder"] == "jesse"
    assert "outline" not in state.json()
    assert state.json()["player_actor_id"] == "walter"
    assert state.json()["events"]
    graph = await client.get(path + "/plot-graph?language=en", headers=headers)
    assert graph.status_code == 200, graph.text
    assert any(
        "holder=jesse" in str(node.get("label") or "")
        for node in graph.json()["nodes"]
    )
    stale = await client.post(path + "/action", headers=headers, json={**payload, "command_id": "different"})
    assert stale.status_code == 409
    private = await client.get(path + "/state", headers={"X-Session-Key": "wrong"})
    assert private.status_code == 403


@pytest.mark.asyncio
async def test_story_command_id_rejects_sse_control_characters(story_api):
    client, _charge = story_api
    created = await client.post("/api/session/create", json={
        "title": "Test",
        "task_prompt": "Original premise",
        "active_character_id": "walter",
        "scenario_id": "desert_crisis",
        "language": "en",
    })
    data = created.json()
    headers = {"X-Session-Key": data["session_key"]}
    await client.get(f"/api/session/{data['session_id']}/stream", headers=headers)

    response = await client.post(
        f"/api/session/{data['session_id']}/action",
        headers=headers,
        json={
            "action": "act",
            "player_input": "Wait.",
            "command_id": "bad\nid:injected",
            "expected_revision": 1,
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_runtime_v1_requires_revision_and_command_id_for_mutating_controls(story_api):
    client, _charge = story_api
    created = await client.post("/api/session/create", json={
        "title": "Test",
        "task_prompt": "Original premise",
        "active_character_id": "walter",
        "scenario_id": "desert_crisis",
        "language": "en",
    })
    data = created.json()
    headers = {"X-Session-Key": data["session_key"]}
    await client.get(f"/api/session/{data['session_id']}/stream", headers=headers)

    response = await client.post(
        f"/api/session/{data['session_id']}/action",
        headers=headers,
        json={"action": "continue"},
    )

    assert response.status_code == 400
    assert "command_id" in response.json()["detail"]


@pytest.mark.asyncio
async def test_plot_graph_excludes_messages_from_an_abandoned_branch(story_api):
    client, _charge = story_api
    created = await client.post("/api/session/create", json={
        "title": "Test",
        "task_prompt": "Original premise",
        "active_character_id": "walter",
        "scenario_id": "desert_crisis",
        "language": "en",
    })
    data = created.json()
    path = f"/api/session/{data['session_id']}"
    headers = {"X-Session-Key": data["session_key"]}

    await client.get(path + "/stream", headers=headers)
    continued = await client.post(path + "/action", headers=headers, json={
        "action": "continue",
        "command_id": "future",
        "expected_revision": 1,
    })
    assert continued.status_code == 200, continued.text
    await client.get(path + "/stream?command_id=future", headers=headers)

    branched = await client.post(path + "/action", headers=headers, json={
        "action": "branch",
        "command_id": "branch",
        "expected_revision": 2,
        "from_beat_id": "beat_1",
        "branch_goal": "Choose another consequence.",
    })
    assert branched.status_code == 200, branched.text
    pending_graph = await client.get(path + "/plot-graph?language=en", headers=headers)
    assert pending_graph.status_code == 200, pending_graph.text
    assert pending_graph.json()["summary"]["beat_count"] == 0
    await client.get(path + "/stream?command_id=branch", headers=headers)

    graph = await client.get(path + "/plot-graph?language=en", headers=headers)
    assert graph.status_code == 200, graph.text
    # Opening + replacement branch. The abandoned future line must not count.
    assert graph.json()["summary"]["spoken_lines"] == 2
