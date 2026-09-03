"""World events derived from GameState. Never a source of truth."""

from __future__ import annotations

from typing import Any

from game.state import MAX_TURNS, GameState


def opening_event(state: GameState) -> dict[str, Any]:
    return {
        "id": "night_opens",
        "title": "The RV is still out there",
        "title_zh": "房车还在外面",
        "text": (
            "Desert night. Jesse called twice. The RV sits off the dirt road with "
            "yesterday still inside it. Hank left a voicemail — just checking in, buddy. "
            "Skyler is awake in the kitchen. Dawn is six decisions away."
        ),
        "text_zh": (
            "沙漠的夜。杰西打来两次。房车停在土路外，昨天还留在里面。"
            "汉克留了语音：只是问问，buddy。斯凯勒在厨房醒着。"
            "离天亮还有六个决定。"
        ),
        "turn": state.turn,
        "remaining": MAX_TURNS - state.turn,
    }


def next_event(state: GameState, *, triggered: list[dict[str, Any]], npc_actions: list[dict[str, Any]]) -> dict[str, Any]:
    if state.ended and state.ending:
        return {
            "id": f"ending:{state.ending['id']}",
            "title": state.ending["title"],
            "title_zh": state.ending["title_zh"],
            "text": state.ending["text"],
            "text_zh": state.ending["text_zh"],
            "turn": state.turn,
            "remaining": 0,
        }
    if triggered:
        debt = triggered[0]
        return {
            "id": f"debt_returns:{debt['id']}",
            "title": "An old story comes back",
            "title_zh": "旧故事回来了",
            "text": debt.get("summary") or "Something you bought cheap is collecting.",
            "text_zh": "你便宜买下的东西，开始收账。",
            "turn": state.turn,
            "remaining": max(0, MAX_TURNS - state.turn),
        }
    loud = next((n for n in npc_actions if n["action_id"] in {"visit_house", "talk", "panic", "search"}), None)
    if loud:
        return {
            "id": f"npc:{loud['npc_id']}:{loud['action_id']}",
            "title": _npc_title(loud),
            "title_zh": _npc_title_zh(loud),
            "text": loud["summary"],
            "text_zh": loud["summary"],
            "turn": state.turn,
            "remaining": max(0, MAX_TURNS - state.turn),
        }
    remaining = max(0, MAX_TURNS - state.turn)
    return {
        "id": f"night_continues:{state.turn}",
        "title": "The night is not done",
        "title_zh": "夜还没完",
        "text": f"The house holds. {remaining} decision(s) until dawn.",
        "text_zh": f"屋子还在。离天亮还有 {remaining} 个决定。",
        "turn": state.turn,
        "remaining": remaining,
    }


def _npc_title(row: dict[str, Any]) -> str:
    names = {"jesse": "Jesse", "hank": "Hank", "skyler": "Skyler", "saul": "Saul"}
    return f"{names.get(row['npc_id'], row['npc_id'])} moves"


def _npc_title_zh(row: dict[str, Any]) -> str:
    names = {"jesse": "杰西", "hank": "汉克", "skyler": "斯凯勒", "saul": "索尔"}
    return f"{names.get(row['npc_id'], row['npc_id'])}有动作"


def template_performance(beat: dict[str, Any], language: str = "en") -> dict[str, Any]:
    """Deterministic fallback lines. Not GameState. Used when LLM is disconnected."""
    action = (beat.get("player_action") or {}).get("id") or "wait"
    zh = language == "zh"
    lines = {
        "lie_to_skyler": (
            "Elliott asked us to dinner. I already said yes. That is all this is.",
            "艾略特约我们吃饭。我已经答应了。就这样。",
        ),
        "clean_rv": (
            "I will handle the vehicle. You stay where I can find you.",
            "车的事由我来处理。你待在我找得到的地方。",
        ),
        "pay_jesse": (
            "Take it. Do not turn this into a conversation about what you deserve.",
            "拿着。别把这变成一场关于你该得什么的谈话。",
        ),
        "chase_jesse": (
            "Jesse. Look at me. We are not doing this in the open.",
            "杰西。看着我。我们不会把事情摊在外面。",
        ),
        "call_saul": (
            "I need the kind of help that does not write anything down.",
            "我需要一种不会留下字据的帮助。",
        ),
        "stay_home": (
            "I am here. That should be enough for one night.",
            "我在家。对这一夜来说，这就该够了。",
        ),
        "confront_hank": (
            "You called. I came. If this is about work, say so.",
            "你打了电话。我来了。如果是公事，就直说。",
        ),
        "stash_cash": (
            "Some things do not belong on a kitchen counter.",
            "有些东西不该出现在厨房台面上。",
        ),
    }
    en_line, zh_line = lines.get(action, ("The night continues.", "夜还在继续。"))
    return {
        "character_id": "walter",
        "reply_text": zh_line if zh else en_line,
        "stage_direction": "Walter keeps his voice even. The cost is already paid." if not zh
        else "沃尔特把声音压平。代价已经付过了。",
        "emotion_state": "tense",
        "source": "template",
    }
