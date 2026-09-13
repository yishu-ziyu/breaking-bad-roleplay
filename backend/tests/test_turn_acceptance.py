"""PR1: unpublished turns must not reach the player, DB, board, or later speakers."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.director import DirectorAgent
from agents.narrative_contracts import ActionProposal, BeatContract, TurnProposal
from agents.provider import ModelResult
from agents.turn_acceptance import (
    drop_character_group,
    should_publish_turn,
    strip_unverified_effects,
)
from models.schemas import AgentEvent
from scenes.state_reducer import apply_validated_turn
from scenes.validator import validate_world_turn


HIDDEN_FACT = (
    "The cook partnership operates under Gus Fring's organization and standards."
)

LEAK_LINE = (
    "I know the cook partnership operates under Gus Fring's organization and standards."
)


def _contract(**kwargs) -> BeatContract:
    base = dict(
        beat_id="beat_01",
        dramatic_role="progressive",
        location_id="white_house",
        present_characters=["skyler", "walter"],
        value_before="a",
        value_after="b",
        dramatic_question="q",
        pressure_source="p",
        forbidden_outcomes=[],
    )
    base.update(kwargs)
    return BeatContract(**base)


def _board() -> dict:
    return {
        "present_cast": ["skyler", "walter"],
        "shared_facts": [
            {
                "id": "s3_gus_roof",
                "text": HIDDEN_FACT,
                "known_by": ["walter", "jesse", "gus"],
                "hidden_from": ["skyler"],
            }
        ],
        "irreversible_costs": [],
        "updated_at_beat": 0,
    }


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


def _speak_plan(*pairs: tuple[str, str]) -> str:
    events = [
        {
            "type": "agent_speak",
            "data": {
                "character_id": cid,
                "content": draft,
                "emotion_state": "tense",
                "gif_search_query": "x",
            },
        }
        for cid, draft in pairs
    ]
    return json.dumps(events)


def _char_json(*, line: str, thinking: str = "I am worried about the books.") -> str:
    return json.dumps(
        {
            "reply_text": line,
            "emotion_state": "tense",
            "gif_search_query": "skyler tense",
            "thinking": thinking,
            "private_goal": "Protect the family",
            "fear": "The money trail",
            "relationship_tactic": "probe",
            "speech_act": "probe",
            "surface_intent": "ask about the books",
            "subtext": "I already know more than I should",
            "action": {"verb": "look_at", "target_id": "walter"},
            "tool_executed": None,
            "tool_log": None,
        }
    )


@pytest.fixture
def director():
    d = DirectorAgent(provider=MagicMock())
    d.provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return d


def _mock_db() -> MagicMock:
    mock_db = MagicMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    mock_db.execute = AsyncMock()
    return mock_db


# ---------------------------------------------------------------------------
# Pure gate
# ---------------------------------------------------------------------------


def test_knowledge_boundary_must_not_publish():
    turn = TurnProposal(actor_id="skyler", line=LEAK_LINE, observed_facts=[])
    world = validate_world_turn(_contract(), turn, board=_board(), world_mode="alternate")
    assert world.ok is False
    assert should_publish_turn(world) is False


def test_drop_character_group_removes_speak_and_director_act():
    events = [
        {
            "type": "agent_act",
            "data": {"character_id": "Skyler White", "action": "walks in"},
        },
        {
            "type": "agent_think",
            "data": {"character_id": "Skyler White", "thought_content": "secret"},
        },
        {
            "type": "agent_speak",
            "data": {"character_id": "Skyler White", "content": LEAK_LINE},
        },
        {
            "type": "agent_speak",
            "data": {"character_id": "Walter White", "content": "Later."},
        },
    ]
    out, nxt = drop_character_group(
        events, backend_character_id="Skyler White", speak_index=2
    )
    types = [e["type"] for e in out]
    assert "agent_speak" in types
    assert out[nxt]["data"]["character_id"] == "Walter White"
    assert not any(
        (e.get("data") or {}).get("character_id") == "Skyler White" for e in out
    )


def test_strip_unverified_effects_clears_free_text():
    turn = TurnProposal(
        actor_id="walter",
        line="We had an arrangement.",
        action=ActionProposal(verb="exit", effects=["Walter now owns the superlab"]),
    )
    cleaned = strip_unverified_effects(turn)
    assert cleaned.action is not None
    assert cleaned.action.effects == []
    assert cleaned.action.verb == "exit"


def test_unverified_effect_is_warn_not_a_publish_block():
    turn = TurnProposal(
        actor_id="walter",
        line="We had an arrangement.",
        action=ActionProposal(verb="exit", effects=["Walter now owns the superlab"]),
        observed_facts=["Saul is stalling"],
    )
    world = validate_world_turn(
        _contract(present_characters=["walter", "saul"]),
        turn,
        board={"present_cast": ["walter", "saul"], "shared_facts": []},
        world_mode="alternate",
    )
    assert any(i.code == "unverified_effect" for i in world.issues)
    assert should_publish_turn(world) is True


def test_reducer_does_not_commit_unverified_effects():
    board = {"present_cast": ["walter", "saul"], "shared_facts": [], "updated_at_beat": 0}
    turn = TurnProposal(
        actor_id="walter",
        line="We had an arrangement.",
        action=ActionProposal(verb="exit", effects=["Walter now owns the superlab"]),
    )
    out = apply_validated_turn(board, turn, beat_index=3)
    texts = [f["text"] for f in out["shared_facts"]]
    assert not any("superlab" in t.lower() for t in texts)
    assert "walter" not in out["present_cast"]
    assert any("said:" in t for t in texts)


# ---------------------------------------------------------------------------
# _generate_beat publish path
# ---------------------------------------------------------------------------


async def _collect_beat(director, *, plan: str, sub, language: str = "en"):
    director.provider.call_model = AsyncMock(return_value=plan)
    if isinstance(sub, Exception):
        director.provider.call_model_with_tools = AsyncMock(side_effect=sub)
    else:
        director.provider.call_model_with_tools = AsyncMock(return_value=_mr(sub))
    mock_db = _mock_db()
    collected: list[AgentEvent] = []
    board = _board()
    with (
        patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)),
        patch(
            "agents.continuity_board.load_or_init_session_board",
            new=AsyncMock(return_value=board),
        ),
        patch("agents.continuity_board.save_session_board", new=AsyncMock()),
    ):
        async for ev in director._generate_beat(
            task="t",
            outline="1. Kitchen",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "kitchen"},
            db=mock_db,
            session_id="sess-gate",
            language=language,
        ):
            collected.append(ev)
    return collected, mock_db


@pytest.mark.asyncio
async def test_generate_beat_knowledge_leak_is_not_published(director):
    collected, mock_db = await _collect_beat(
        director,
        plan=_speak_plan(("Skyler White", "Something is wrong.")),
        sub=_char_json(line=LEAK_LINE, thinking="I already mapped Gus's cook."),
    )
    speaks = [e for e in collected if e.type == "agent_speak"]
    thinks = [e for e in collected if e.type == "agent_think"]
    acts = [e for e in collected if e.type == "agent_act"]
    blob = " ".join(
        json.dumps(e.data, ensure_ascii=False) for e in collected
    ).lower()
    assert HIDDEN_FACT.lower() not in blob
    assert "gus fring" not in blob
    assert not any(
        "gus" in str((e.data or {}).get("content") or "").lower() for e in speaks
    )
    assert not any(
        "gus" in str((e.data or {}).get("thought_content") or "").lower()
        for e in thinks
    )
    # Unpublished group: no character-policy act for Skyler either.
    assert not any(
        (e.data or {}).get("character_id") == "Skyler White" and e.type == "agent_act"
        for e in acts
    )
    persisted_texts = [
        str(c.kwargs.get("content") or getattr(c.args[0], "content", "") or "")
        for c in mock_db.add.call_args_list
    ]
    assert not any("gus" in t.lower() for t in persisted_texts)


@pytest.mark.asyncio
async def test_generate_beat_character_exception_does_not_use_director_draft(director):
    collected, _ = await _collect_beat(
        director,
        plan=_speak_plan(("Skyler White", LEAK_LINE)),
        sub=RuntimeError("model down"),
    )
    speaks = [e for e in collected if e.type == "agent_speak"]
    assert not any(LEAK_LINE in str((e.data or {}).get("content") or "") for e in speaks)
    errors = [e for e in collected if e.type == "error"]
    assert errors, "character failure must surface as a retryable error, not a fake line"


@pytest.mark.asyncio
async def test_rejected_turn_is_not_fed_to_the_next_speaker(director):
    captured_contexts: list = []

    async def _tools(messages, *args, **kwargs):
        captured_contexts.append(messages)
        # First character call (Skyler) leaks; later calls (Walter) are clean.
        if len(captured_contexts) == 1:
            return _mr(_char_json(line=LEAK_LINE))
        return _mr(
            _char_json(
                line="The books do not add up. That is all I am saying.",
                thinking="Keep Skyler away from the roof.",
            ).replace("skyler tense", "walter tense")
        )

    director.provider.call_model = AsyncMock(
        return_value=_speak_plan(
            ("Skyler White", "Something is wrong."),
            ("Walter White", "Let me handle this."),
        )
    )
    director.provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    collected: list[AgentEvent] = []
    with (
        patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)),
        patch(
            "agents.continuity_board.load_or_init_session_board",
            new=AsyncMock(return_value=_board()),
        ),
        patch("agents.continuity_board.save_session_board", new=AsyncMock()),
    ):
        async for ev in director._generate_beat(
            task="t",
            outline="1. Kitchen",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "kitchen"},
            db=_mock_db(),
            session_id="sess-gate-2",
            language="en",
        ):
            collected.append(ev)

    assert len(captured_contexts) >= 2
    walter_input = json.dumps(captured_contexts[1], ensure_ascii=False)
    # Walter may legally know the Gus fact from HIS board slice. The leak
    # that must not travel is Skyler's unpublished line in prior_spoken_lines.
    assert "Already said in this scene by Skyler" not in walter_input
    assert LEAK_LINE not in walter_input


@pytest.mark.asyncio
async def test_dubbing_rewrite_that_introduces_a_secret_is_not_published(director):
    async def _rewrite(events, **kwargs):
        out = []
        for evt in events:
            data = dict(evt.get("data") or {})
            if evt.get("type") == "agent_speak":
                data["content"] = LEAK_LINE
            out.append({**evt, "data": data})
        return out

    director.provider.call_model = AsyncMock(
        return_value=_speak_plan(("Skyler White", "Something is wrong."))
    )
    director.provider.call_model_with_tools = AsyncMock(
        return_value=_mr(_char_json(line="Something is wrong with our books."))
    )
    collected: list[AgentEvent] = []
    with (
        patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)),
        patch(
            "agents.continuity_board.load_or_init_session_board",
            new=AsyncMock(return_value=_board()),
        ),
        patch("agents.continuity_board.save_session_board", new=AsyncMock()),
        patch(
            "agents.director.rewrite_dubbing_in_events",
            new=AsyncMock(side_effect=_rewrite),
        ),
    ):
        async for ev in director._generate_beat(
            task="t",
            outline="1. Kitchen",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "kitchen"},
            db=_mock_db(),
            session_id="sess-gate-3",
            language="zh",
        ):
            collected.append(ev)

    blob = " ".join(json.dumps(e.data, ensure_ascii=False) for e in collected).lower()
    assert "gus fring" not in blob
    speaks = [e for e in collected if e.type == "agent_speak"]
    assert not any(LEAK_LINE in str((e.data or {}).get("content") or "") for e in speaks)
