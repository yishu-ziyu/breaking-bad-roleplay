"""TDD probe tests for the "译制腔" (dubbing-tone) leak detector.

This is a cheap, deterministic, offline sentinel. It CANNOT call a real LLM;
it only tells us whether a rules-based detector can separate hand-written
dubbing-tone samples from normal Chinese. That signal decides whether the
"译制腔检测 + 改写守卫" module is worth building.
"""

from __future__ import annotations

from agents.dubbing_guard_probe import detect_dubbing_tone


def _verdict(text: str) -> str:
    return detect_dubbing_tone(text)["verdict"]


def test_normal_chinese_does_not_false_positive():
    text = "他想了一会儿，最后还是点了点头。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "clean"
    assert result["score"] == 0.0
    assert result["matches"] == []


def test_colloquial_understated_line_is_clean():
    text = "这桥份子，我顶多信三四成。"
    assert _verdict(text) == "clean"


def test_light_english_borrow_is_clean():
    text = "行，就这么办，OK？"
    assert _verdict(text) == "clean"
    assert detect_dubbing_tone(text)["matches"] == []


def test_english_skeleton_yi_xiang_dao_is_dubbing():
    text = "一想到沃尔特那张嘴，我就冒冷汗。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "dubbing"
    assert any("一想到" in m for m in result["matches"])


def test_english_skeleton_dang_de_shihou_is_dubbing():
    text = "当他走进房间的时候，所有人都安静了下来。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "dubbing"
    assert any("当" in m and "的时候" in m for m in result["matches"])


def test_abstract_plus_concrete_paste_is_dubbing():
    text = "我心里这块秩序的玻璃已经开始裂了。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "dubbing"
    assert any("秩序的玻璃" in m for m in result["matches"])


def test_english_stage_direction_residue_is_dubbing():
    text = "他 leans back，手指 steepled，沉默了很久。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "dubbing"
    assert any("英文" in m for m in result["matches"])


def test_forbidden_transliteration_is_dubbing():
    text = "米克站在那里，一句话也没说。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] == "dubbing"
    assert any("米克" in m for m in result["matches"])


def test_written_translationese_is_at_least_suspicious():
    text = "每一个决定都显得格外沉重。"
    result = detect_dubbing_tone(text)
    assert result["verdict"] in ("dubbing", "suspicious")
    assert any("每一个" in m for m in result["matches"])


def test_result_shape_is_stable():
    result = detect_dubbing_tone("当他闭上眼睛的时候，沉默的恐惧像墙一样压过来。")
    assert set(result.keys()) == {"score", "matches", "verdict"}
    assert isinstance(result["score"], float)
    assert isinstance(result["matches"], list)
    assert isinstance(result["verdict"], str)
    assert result["verdict"] == "dubbing"