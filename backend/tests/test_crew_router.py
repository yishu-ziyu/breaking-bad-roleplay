"""Crew speaker routing: one lead, at most one short reaction, never the whole room.

docs/research/2026-10-01-chat-feel-round2-chatgpt.md — production group chats
(Nomi, SillyTavern) decide who should talk; silence is allowed; the turn goes
back to the player.
"""

from agents.crew_router import (
    addressed_in_order,
    clean_crew_line,
    crew_history_for,
    crew_room,
    mentions_in_order,
    pick_lead,
    pick_reactor,
)

W, J, S, H, G = "Walter White", "Jesse Pinkman", "Skyler White", "Hank Schrader", "Gus Fring"


def test_mentions_keep_message_order():
    assert mentions_in_order("杰西，你说呢？沃尔特别插嘴。") == [J, W]
    assert mentions_in_order("ask Hank, then Walter") == [H, W]


def test_room_is_primary_plus_recent_speakers_plus_mentions():
    history = [
        {"sender": "user", "text": "hi"},
        {"sender": "jesse", "text": "yo"},
        {"sender": "walter", "text": "quiet"},
    ]
    room = crew_room("walter", history, "汉克，你也来了？")
    assert room[0] == W
    assert set(room) == {W, J, H}


def test_addressing_someone_is_different_from_talking_about_them():
    assert addressed_in_order("杰西，你昨晚去哪了？") == [J]
    assert addressed_in_order("杰西、汉克，你们说呢") == [J, H]
    assert addressed_in_order("Jesse, Hank — thoughts?") == [J, H]
    assert addressed_in_order("沃尔特说你在骗他。") == []
    assert addressed_in_order("汉克要是知道了怎么办？") == []


def test_talking_about_someone_does_not_summon_them():
    assert crew_room("gus", [], "沃尔特说你在骗他。") == [G]
    assert pick_lead([G], "沃尔特说你在骗他。", history=[]) == G


def test_room_is_capped_at_four():
    room = crew_room("walter", [], "Jesse, Saul, Mike, Gus, Hank, Skyler: listen.")
    assert len(room) == 4 and room[0] == W


def test_lead_is_the_first_person_named():
    room = [W, J, H]
    assert pick_lead(room, "杰西，你昨晚去哪了？", history=[]) == J


def test_lead_falls_back_to_whoever_just_spoke_then_primary():
    room = [W, J]
    history = [{"sender": "user", "text": "hi"}, {"sender": "jesse", "text": "yo"}]
    assert pick_lead(room, "然后呢？", history=history) == J
    assert pick_lead(room, "然后呢？", history=[]) == W


def test_reactor_is_the_second_person_named():
    room = [W, J, H]
    assert pick_reactor(room, lead=J, lead_reply="我不知道。", user_message="杰西，汉克说的是真的吗？", history=[]) == H


def test_reactor_can_be_someone_the_lead_called_out():
    room = [W, J]
    assert pick_reactor(room, lead=W, lead_reply="问杰西，他最清楚。", user_message="昨晚怎么回事？", history=[]) == J


def test_reactor_can_come_from_a_standing_conflict():
    room = [W, H]
    assert pick_reactor(room, lead=W, lead_reply="我在学校改卷子。", user_message="你昨晚去哪了？", history=[]) == H


def test_no_reactor_when_nobody_has_a_reason():
    room = [S, G]  # no shared conflict, nobody named, lead names nobody
    assert pick_reactor(room, lead=S, lead_reply="说重点。", user_message="在吗？", history=[]) is None


def test_the_same_person_does_not_cut_in_two_rounds_running():
    room = [W, H]
    history = [
        {"sender": "user", "text": "?"},
        {"sender": "walter", "text": "..."},
        {"sender": "hank", "text": "嗯哼。"},
    ]
    assert pick_reactor(room, lead=W, lead_reply="我在学校。", user_message="你昨晚去哪了？", history=history) is None


def test_alone_in_the_room_means_no_reactor():
    assert pick_reactor([W], lead=W, lead_reply="说。", user_message="在吗", history=[]) is None


def test_clean_line_strips_name_prefixes_and_other_speakers():
    assert clean_crew_line("walter: 我在学校。", J) == "我在学校。"
    assert clean_crew_line("古斯: 可靠这个词，要看是谁在用。", G) == "可靠这个词，要看是谁在用。"
    assert clean_crew_line("jesse: 没人跟你吵。\n\nwalter: 你把话说完。", J) == "没人跟你吵。"
    assert clean_crew_line("沃尔特，你先冷静。", J) == "沃尔特，你先冷静。"  # a vocative is not a prefix


def test_each_speaker_sees_own_lines_as_theirs_and_others_by_name():
    history = [
        {"sender": "user", "text": "你昨晚去哪了？"},
        {"sender": "walter", "text": "学校。"},
        {"sender": "jesse", "text": "……学校。行。"},
    ]
    msgs = crew_history_for(J, history, language="zh")
    assert msgs[0] == {"role": "user", "content": "玩家：你昨晚去哪了？"}
    assert msgs[1] == {"role": "user", "content": "沃尔特：学校。"}
    assert msgs[2] == {"role": "assistant", "content": "……学校。行。"}
