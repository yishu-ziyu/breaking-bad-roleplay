from agents.beat_pipeline import collect_llm_world_deltas, hoist_perspective_speak


def test_hoist_moves_perspective_speak_before_other_speaks():
    events = [
        {"type": "scene_change", "data": {}},
        {"type": "agent_speak", "data": {"character_id": "Walter White", "content": "w"}},
        {"type": "agent_speak", "data": {"character_id": "Jesse Pinkman", "content": "j"}},
        {"type": "world_state_delta", "data": {"deltas": []}},
    ]
    out = hoist_perspective_speak(events, "Jesse Pinkman")
    speaks = [e for e in out if e.get("type") == "agent_speak"]
    assert speaks[0]["data"]["character_id"] == "Jesse Pinkman"
    assert speaks[1]["data"]["character_id"] == "Walter White"
    assert out[0]["type"] == "scene_change"


def test_hoist_noop_without_perspective():
    events = [
        {"type": "agent_speak", "data": {"character_id": "Walter White"}},
        {"type": "agent_speak", "data": {"character_id": "Jesse Pinkman"}},
    ]
    assert hoist_perspective_speak(events, None) == events


def test_collect_llm_world_deltas_skips_non_dicts():
    events = [
        {"type": "agent_speak", "data": {}},
        {"type": "world_state_delta", "data": {"deltas": [{"field": "a"}, "nope"]}},
        {"type": "world_state_delta", "data": {"deltas": {"field": "bad"}}},
    ]
    assert collect_llm_world_deltas(events) == [{"field": "a"}]
