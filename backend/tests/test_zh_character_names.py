"""Chinese character-name glossary for Breaking Bad dialogue."""

from __future__ import annotations

from agents.director import normalize_zh_character_names, normalize_zh_names_in_events


def test_mike_never_transliterates_to_mi_ke():
    assert "米克" not in normalize_zh_character_names("米克说得够清楚了。")
    assert normalize_zh_character_names("米克说得够清楚了。") == "麦克说得够清楚了。"


def test_english_mike_in_chinese_line_becomes_mai_ke():
    out = normalize_zh_character_names("Mike说得够清楚了。")
    assert out == "麦克说得够清楚了。"
    assert "Mike" not in out


def test_full_name_and_bad_variants():
    assert normalize_zh_character_names("Mike Ehrmantraut 点头") == "麦克 点头"
    assert normalize_zh_character_names("米克·厄曼特劳特走了") == "麦克走了"


def test_other_cast_names():
    line = "Walter 看着 Jesse，Saul 在旁边，Gus 没说话，Skyler 在家。"
    out = normalize_zh_character_names(line)
    assert out == "沃尔特 看着 杰西，索尔 在旁边，古斯 没说话，斯凯勒 在家。"


def test_events_normalize_speak_and_nested_delta():
    events = [
        {
            "type": "agent_speak",
            "data": {
                "character_id": "Walter White",
                "content": "米克说得够清楚了。",
            },
        },
        {
            "type": "world_state_delta",
            "data": {
                "deltas": [
                    {
                        "target": "Mike",
                        "field": "trust",
                        "old_value": "米克不信",
                        "new_value": "米克更冷",
                    }
                ]
            },
        },
    ]
    out = normalize_zh_names_in_events(events)
    assert out[0]["data"]["content"] == "麦克说得够清楚了。"
    assert out[0]["data"]["character_id"] == "Walter White"  # id stays English
    delta = out[1]["data"]["deltas"][0]
    assert delta["target"] == "麦克"
    assert delta["old_value"] == "麦克不信"
    assert delta["new_value"] == "麦克更冷"


def test_lang_directive_mentions_mike_glossary():
    from agents.director import LANG_DIRECTIVE

    zh = LANG_DIRECTIVE["zh"]
    assert "麦克" in zh
    assert "米克" in zh  # forbidden form is named
    assert "禁止" in zh
