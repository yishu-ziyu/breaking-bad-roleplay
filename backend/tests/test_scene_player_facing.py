"""Player-facing scene labels must hide McKee craft scaffolding."""

from __future__ import annotations

from agents.mckee_story import player_facing_scene_blurb, player_facing_scene_label
from agents.director import DirectorAgent


def test_label_strips_role_value_gap_risk():
    raw = (
        "[progressive] 怀特家餐厅 — 沃尔特: 启用索尔的毒计 — "
        "value: 主动→被动 — gap: 索尔以为能用假证人换时间，汉克却把传票拍在餐桌上 — risk: 高"
    )
    assert player_facing_scene_label(raw) == "怀特家餐厅"
    blurb = player_facing_scene_blurb(raw)
    assert "value" not in blurb.lower()
    assert "gap" not in blurb.lower()
    assert "risk" not in blurb.lower()
    assert "progressive" not in blurb.lower()
    assert "怀特家餐厅" in blurb
    assert "索尔" in blurb or "沃尔特" in blurb


def test_label_english_outline_line():
    raw = (
        "3. [progressive] White living room — value: trust→suspicion — "
        "gap: minimal probe meets a harder wall — risk: high"
    )
    assert player_facing_scene_label(raw) == "White living room"
    blurb = player_facing_scene_blurb(raw)
    assert "value" not in blurb.lower()
    assert "White living room" in blurb


def test_director_short_scene_name_uses_label():
    raw = "[setup] 施拉德后院烧烤 — value: 安全→不安 — risk: 低"
    assert DirectorAgent._short_scene_name(raw) == "施拉德后院烧烤"
