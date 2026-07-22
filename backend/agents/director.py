from __future__ import annotations
import asyncio
import json
import logging
import re
from typing import Any, AsyncIterator

from agents.provider import ProviderFacade
from agents.characters import (
    WalterWhite,
    JessePinkman,
    SkylerWhite,
    SaulGoodman,
    MikeEhrmantraut,
    GusFring,
    HankSchrader,
)
from agents import mckee_story
from agents.beat_json import (
    parse_beat_events as extract_beat_events,
    parse_beat_plan,
    parse_preview,
)
from agents.speak_sanitize import sanitize_speak_content
from agents.narrative_contracts import (
    ActionProposal,
    BeatContract,
    ensure_actor_on_contract,
    synthesize_beat_contract,
    try_parse_beat_contract,
    turn_proposal_from_character_result,
    upsert_agent_act_from_turn,
    validate_turn_against_contract_basic,
)
from scenes.action_ontology import map_action_verb
from scenes.critic import score_turn
from scenes.state_reducer import apply_validated_turn
from scenes.validator import validate_world_turn
from scenes.world_mode import parse_world_mode
from models.schemas import AgentEvent
from agents.memory import update_dossiers
from sqlalchemy import select

logger = logging.getLogger(__name__)
DEFAULT_DIRECTOR_MODEL_ROUTE = "stepfun/step-3.7-flash"
MAX_AGENT_SPEAK_PER_BEAT = 2
LANG_DIRECTIVE = {
    "en": (
        "RESPONSE LANGUAGE: English only.\n"
        "ALL player-visible narrative fields must be English: "
        "outline lines, scene_change.description, agent_act.action, "
        "agent_think.thought_content, agent_speak.content, and "
        "world_state_delta field/old_value/new_value.\n"
        "emotion_state must be one English tag from: "
        "calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.\n"
        "character_id stays the canonical English names.\n"
        "gif_search_query stays English for image search."
    ),
    "zh": (
        "RESPONSE LANGUAGE: 简体中文 only.\n"
        "所有面向玩家的叙事字段必须使用简体中文："
        "大纲正文、scene_change.description、agent_act.action、"
        "agent_think.thought_content、agent_speak.content、"
        "以及 world_state_delta 的 field/old_value/new_value。\n"
        "禁止英文舞台指示或英文内心独白"
        "（例如 leans back / fingers steepled / He is terrified）。\n"
        "角色中文名必须用下列固定译名（禁止音译乱写）：\n"
        "Mike/Mike Ehrmantraut → 麦克（禁止「米克」）；\n"
        "Walter/Walter White → 沃尔特；Jesse/Jesse Pinkman → 杰西；\n"
        "Skyler/Skyler White → 斯凯勒；Saul/Saul Goodman → 索尔；\n"
        "Gus/Gus Fring → 古斯；Hank/Hank Schrader → 汉克；Marie → 玛丽；\n"
        "Todd/Todd Alquist → 托德（禁止「托霍」）；\n"
        "Jack Welker → 杰克·维尔克（禁止「杰克·托霍」）；\n"
        "Tuco/Tuco Salamanca → 图科；Gale → 盖尔；Gomez → 戈麦兹；Lydia → 莉迪亚。\n"
        "emotion_state 仍用英文标签之一："
        "calm, tense, angry, fearful, manipulative, guilty, resigned, desperate"
        "（界面会本地化展示；不要写中文 emotion）。\n"
        "character_id 仍用规范英文名（Walter White 等）。\n"
        "gif_search_query 保持英文（图片检索用）。"
    ),
}
STATUS_I18N = {
    "en": {
        "analysing": "Director is analysing the task…",
        "outlined": "Director outlined {n} beat(s). Beginning roleplay…",
        "no_action": "No action received — continuing automatically.",
        "complete": "All beats rendered. Roleplay outline complete.",
        "outline_failed": "Outline generation failed — could not reach the model.",
        "no_beats": "The generated outline contained no playable beats.",
        "beat_llm_failed": "Beat {n} — LLM call failed. Please check LLM service (current: {route}).",
        "beat_parse_failed": "Story generation failed. The model returned unparseable content. Retry or switch models (current: {route}).",
    },
    "zh": {
        "analysing": "导演正在分析任务…",
        "outlined": "导演已规划 {n} 个剧情节拍。开始角色扮演…",
        "no_action": "未收到玩家操作 — 自动继续…",
        "complete": "全部剧情节点已完成。任务收束。",
        "outline_failed": "大纲生成失败 — 无法连接模型。",
        "no_beats": "生成的大纲没有可玩的剧情节点。",
        "beat_llm_failed": "第 {n} 拍生成失败。请检查模型服务（当前: {route}）。",
        "beat_parse_failed": "剧情生成异常。AI 返回了无法解析的内容，请重试或切换模型（当前: {route}）。",
    },
}


def _norm_lang(lang: str | None) -> str:
    """Normalize UI language codes to en|zh."""
    if not lang:
        return "en"
    return "zh" if str(lang).lower().startswith("zh") else "en"


def _language_directive(lang: str) -> str:
    return LANG_DIRECTIVE[_norm_lang(lang)]


def _status_message(key: str, lang: str = "en", **kwargs) -> str:
    lang = _norm_lang(lang)
    template = STATUS_I18N.get(lang, STATUS_I18N["en"]).get(
        key, STATUS_I18N["en"].get(key, "")
    )
    return template.format(**kwargs)


def _latin_letter_ratio(text: str) -> float:
    """Share of alphabetic chars that are ASCII Latin (heuristic for English leakage)."""
    if not text or not str(text).strip():
        return 0.0
    letters = [c for c in str(text) if c.isalpha()]
    if not letters:
        return 0.0
    latin = sum(1 for c in letters if ord(c) < 128)
    return latin / len(letters)


def _needs_zh_rewrite(text: str) -> bool:
    """True when a player-visible field looks English under zh mode."""
    if not text or not str(text).strip():
        return False
    # Short pure numbers / punctuation ok
    if len(str(text).strip()) < 4:
        return False
    return _latin_letter_ratio(text) >= 0.55


# Canonical Simplified Chinese names for dialogue (not character_id).
# Longer phrases first so multi-token names win over short forms.
_ZH_NAME_FIXES: tuple[tuple[str, str], ...] = (
    ("Mike Ehrmantraut", "麦克"),
    ("Walter White", "沃尔特"),
    ("Jesse Pinkman", "杰西"),
    ("Skyler White", "斯凯勒"),
    ("Saul Goodman", "索尔"),
    ("Gus Fring", "古斯"),
    ("Hank Schrader", "汉克"),
    ("Todd Alquist", "托德"),
    ("Jack Welker", "杰克·维尔克"),
    ("Tuco Salamanca", "图科"),
    ("Gale Boetticher", "盖尔"),
    ("Steven Gomez", "戈麦兹"),
    # Bad / nonstandard transliterations → standard
    ("杰克·托霍", "杰克·维尔克"),
    ("米克·厄曼特劳特", "麦克"),
    ("米克·埃尔曼特劳特", "麦克"),
    ("托霍", "托德"),  # LLM mangling of Todd
    ("米克", "麦克"),
    ("麦克尔", "麦克"),
    ("沃尔特怀特", "沃尔特"),
    ("杰西平克曼", "杰西"),
    # English first names that leak into Chinese dialogue
    ("Mike", "麦克"),
    ("Walter", "沃尔特"),
    ("Jesse", "杰西"),
    ("Skyler", "斯凯勒"),
    ("Saul", "索尔"),
    ("Gus", "古斯"),
    ("Hank", "汉克"),
    ("Marie", "玛丽"),
    ("Todd", "托德"),
    ("Tuco", "图科"),
    ("Gale", "盖尔"),
    ("Gomez", "戈麦兹"),
    ("Lydia", "莉迪亚"),
)


def normalize_zh_character_names(text: str | None) -> str:
    """Force standard Chinese character names inside player-visible prose."""
    if not text:
        return ""
    out = str(text)
    for src, dst in _ZH_NAME_FIXES:
        if src in out:
            out = out.replace(src, dst)
    return out


_ZH_NARRATIVE_FIELDS = (
    "content",
    "action",
    "thought_content",
    "description",
    "old_value",
    "new_value",
    "field",
    "target",
    "to_scene",
    "from_scene",
)


def normalize_zh_names_in_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply Chinese name glossary to all player-visible event fields."""
    if not events:
        return events
    out: list[dict[str, Any]] = []
    for evt in events:
        if not isinstance(evt, dict):
            out.append(evt)
            continue
        data = evt.get("data")
        if not isinstance(data, dict):
            out.append(evt)
            continue
        new_data = dict(data)
        for key in _ZH_NARRATIVE_FIELDS:
            if key in new_data and isinstance(new_data[key], str):
                new_data[key] = normalize_zh_character_names(new_data[key])
        deltas = new_data.get("deltas")
        if isinstance(deltas, list):
            fixed_deltas = []
            for d in deltas:
                if isinstance(d, dict):
                    nd = dict(d)
                    for key in _ZH_NARRATIVE_FIELDS:
                        if key in nd and isinstance(nd[key], str):
                            nd[key] = normalize_zh_character_names(nd[key])
                    fixed_deltas.append(nd)
                else:
                    fixed_deltas.append(d)
            new_data["deltas"] = fixed_deltas
        out.append({**evt, "data": new_data})
    return out
# ---------------------------------------------------------------------------
# Frontend ↔ backend character-id mapping
# ---------------------------------------------------------------------------
FRONTEND_TO_BACKEND_ID: dict[str, str] = {
    "walter": "Walter White",
    "jesse": "Jesse Pinkman",
    "skyler": "Skyler White",
    "saul": "Saul Goodman",
    "mike": "Mike Ehrmantraut",
    "gus": "Gus Fring",
    "hank": "Hank Schrader",
}
BACKEND_TO_FRONTEND_ID: dict[str, str] = {v: k for k, v in FRONTEND_TO_BACKEND_ID.items()}
# Also accept display names as keys (switch_perspective / DB resume).
for _full, _short in list(BACKEND_TO_FRONTEND_ID.items()):
    FRONTEND_TO_BACKEND_ID.setdefault(_full.lower(), _full)
    FRONTEND_TO_BACKEND_ID.setdefault(_full, _full)


def resolve_backend_character_id(raw: str | None) -> str | None:
    """Map frontend id, display name, or free text → canonical backend name."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s in FRONTEND_TO_BACKEND_ID:
        return FRONTEND_TO_BACKEND_ID[s]
    low = s.lower()
    if low in FRONTEND_TO_BACKEND_ID:
        return FRONTEND_TO_BACKEND_ID[low]
    # Exact backend full name
    if s in CHARACTER_AGENTS:
        return s
    for full in CHARACTER_AGENTS:
        if full.lower() == low:
            return full
    # First-token match: "walter white" / "Walter"
    token = low.split()[0]
    if token in FRONTEND_TO_BACKEND_ID:
        return FRONTEND_TO_BACKEND_ID[token]
    logger.warning("resolve_backend_character_id: unknown id %r", raw)
    return s


def apply_character_thinking(
    events: list[dict[str, Any]],
    character_id: str,
    thinking: str | None,
    *,
    speak_index: int,
) -> list[dict[str, Any]]:
    """Bind Character-agent thinking into the beat event list.

    Policy: agent_think must come from the Character Policy Card path, not
    the Director's generic draft. When the Character Agent returns ``thinking``
    with a speak rewrite:

    1. Prefer overwriting the nearest prior ``agent_think`` for the same
       character (index < speak_index).
    2. If none exists, insert a new ``agent_think`` immediately before speak.

    Returns the (possibly extended) events list. Mutates in place and may
    insert, so callers must use the returned list and re-resolve indices.
    """
    thought = (thinking or "").strip()
    if not thought or speak_index < 0 or speak_index >= len(events):
        return events

    think_idx: int | None = None
    for i in range(speak_index - 1, -1, -1):
        evt = events[i]
        if evt.get("type") != "agent_think":
            continue
        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
        if data.get("character_id") == character_id:
            think_idx = i
            break

    if think_idx is not None:
        prev = events[think_idx]
        data = dict(prev.get("data") or {})
        data["character_id"] = character_id
        data["thought_content"] = thought
        events[think_idx] = {**prev, "type": "agent_think", "data": data}
        return events

    speak = events[speak_index]
    insert = {
        "type": "agent_think",
        "data": {
            "character_id": character_id,
            "thought_content": thought,
        },
    }
    if speak.get("recommended_model"):
        insert["recommended_model"] = speak["recommended_model"]
    events.insert(speak_index, insert)
    return events
# ---------------------------------------------------------------------------
# Crew-mode chat message handler
# ---------------------------------------------------------------------------
CREW_CHAT_SYSTEM_PROMPT = """\
You are the **Director** managing a multi-character Breaking Bad chat scene.
Your task is to produce a natural dialogue exchange between 2-3 characters
responding to a user message.
EMIT A SINGLE JSON ARRAY — one object per character turn in order:
[
  {
    "character_id": "Walter White" | "Jesse Pinkman" | "Skyler White" | "Saul Goodman" | "Mike Ehrmantraut" | "Gus Fring" | "Hank Schrader",
    "content": "<spoken dialogue only — in character, 2-6 sentences>",
    "emotion_state": "<calm|tense|angry|fearful|manipulative|guilty|resigned|desperate>",
    "gif_search_query": "<English visual emotion search phrase>",
    "thinking": "<1-3 sentence inner monologue>",
    "tool_executed": "<fictional tool name or null>",
    "tool_log": "<tool result or null>"
  }
]
RULES:
- Each object is one character's full response (dialogue + metadata).
- content is pure spoken words — no parenthetical stage directions or narrator
  similes (ban "（声音放低，像是…）", "(as if…)", "like a teacher").
- Include 2-3 turns total (not counting the user's message).
- Characters should react to each other, not just the user.
- The first character should be the one closest to the user's relation.
- emotion_state must be one of: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- gif_search_query must be in English and visually descriptive.
- tool_executed and tool_log describe any in-world tool the character uses (e.g. "disposal service", "lab scanner"), or null.
- Do NOT include any fields outside this schema.
- Do NOT include the user's message in the array.
"""
DIRECTOR_SYSTEM_PROMPT = """\
You are the **Director** of a Breaking Bad interactive roleplay.
Known characters: Walter White, Jesse Pinkman, Skyler White, Saul Goodman,
Mike Ehrmantraut, Gus Fring, Hank Schrader.
Your job is NOT to write prose.  Your job is to orchestrate character agents
and emit structured events for the client.  For every narrative beat you must:
BEAT PLANNING
1. Decide which characters are present and what each one does.
2. Decide if the location changes (emit a scene_change event).
3. Decide what emotional beat this moment carries.
4. Choose the model for this scene (always "stepfun/step-3.7-flash").
THINKING
- Have characters think before they act — emit agent_think events to reveal
  their inner conflict and motivation.  Breaking Bad tension lives in what
  characters hide.
SPEAKING
- Emit agent_speak events with the character's actual dialogue ONLY.
- agent_speak.content is pure spoken words — no parentheticals, no stage
  directions, no narrator similes (ban: "（声音放低，像是…）", "(as if…)",
  "like a teacher explaining", "带着…的神情").
- Delivery and threat come from the line itself (rhythm, pressure, subtext),
  not from author commentary inside the dialogue.
- Include the character's current emotion_state and a gif_search_query that
  captures their emotional state visually (e.g. "walter white angry determined",
  "jesse pinkman scared nervous").
ACTING
- Emit agent_act events for physical actions: entering, leaving, handing over
  an object, cooking, driving, lowering voice volume as action text, etc.
- Keep agent_act.action short and performable (camera can film it). No metaphors.
WORLD STATE
- After the beat is complete, list every fact that changed as a world_state_delta
  event.  Examples: Walt now knows X, the location is now Y, trust between
  characters shifted.
OUTPUT FORMAT — emit a single JSON array of event objects.  Each event object
has a "type" field and a "data" field matching one of these shapes:
  scene_change:     { "from_scene": "<current location>", "to_scene": "<new location>", "description": "<why the transition happens>" }
  agent_act:        { "character_id": "<character name>", "action": "<physical action>", "target": "<optional target>" }
  agent_think:      { "character_id": "<character name>", "thought_content": "<inner monologue>" }
  agent_speak:      { "character_id": "<character name>", "content": "<spoken dialogue>", "emotion_state": "<emotion tag>", "gif_search_query": "<visual emotion search phrase>" }
  world_state_delta:{ "deltas": [ { "target": "<character or location>", "field": "<what changed>", "old_value": "<before>", "new_value": "<after>" } ] }
NOTE: This JSON event format is for BEAT events only. When asked for an outline
(overall plot structure), output a plain text numbered list instead.
IMPORTANT: Every beat event object MUST include a "recommended_model" field
set to "stepfun/step-3.7-flash".
Example output:
[
  { "type": "scene_change", "data": { "from_scene": "RV in the desert", "to_scene": "White family kitchen", "description": "Cut from the cook to Walt at home" }, "recommended_model": "stepfun/step-3.7-flash" },
  { "type": "agent_act", "data": { "character_id": "Walter White", "action": "sits down at the table", "target": null }, "recommended_model": "stepfun/step-3.7-flash" },
  { "type": "agent_think", "data": { "character_id": "Walter White", "thought_content": "If Skyler finds out about the lab, I lose everything." }, "recommended_model": "stepfun/step-3.7-flash" },
  { "type": "agent_speak", "data": { "character_id": "Walter White", "content": "I need to tell you something.", "emotion_state": "tense", "gif_search_query": "walter white nervous serious" }, "recommended_model": "stepfun/step-3.7-flash" },
  { "type": "world_state_delta", "data": { "deltas": [ { "target": "Walter White", "field": "emotional_state", "old_value": "composed", "new_value": "anxious" } ] }, "recommended_model": "stepfun/step-3.7-flash" }
]
RULES:
- Always emit at least one agent_think or agent_speak per character per beat.
- Emotion states: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- GIF queries must be in English and specific enough to find relevant images.
- scene_change is only emitted when the narrative location actually shifts.
- world_state_delta must always appear as the last event in a beat.
- character_id must be exactly "Walter White", "Jesse Pinkman", "Skyler White",
  "Saul Goodman", "Mike Ehrmantraut", "Gus Fring", or "Hank Schrader" — no variations.
- recommended_model must be "stepfun/step-3.7-flash" on every event.
- NEVER put stage notes inside agent_speak.content parentheses. Use agent_act.
""" + mckee_story.mckee_system_addon()
# ---------------------------------------------------------------------------
# Director agent
# ---------------------------------------------------------------------------
CHARACTER_AGENTS: dict[str, Any] = {
    "Walter White": WalterWhite,
    "Jesse Pinkman": JessePinkman,
    "Skyler White": SkylerWhite,
    "Saul Goodman": SaulGoodman,
    "Mike Ehrmantraut": MikeEhrmantraut,
    "Gus Fring": GusFring,
    "Hank Schrader": HankSchrader,
}

# Crew mention → cast (word boundaries; no bare "dea").
_CREW_MENTION_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\bsaul\b", "Saul Goodman"),
    (r"\bmike\b", "Mike Ehrmantraut"),
    (r"\bgus\b", "Gus Fring"),
    (r"\bskyler\b", "Skyler White"),
    (r"\bjesse\b", "Jesse Pinkman"),
    (r"\bhank\b", "Hank Schrader"),
    (r"\bschrader\b", "Hank Schrader"),
)


def crew_participants_from_message(character_id: str, user_message: str, *, cap: int = 3) -> list[str]:
    """Return backend character names for a crew turn (primary first, max cap)."""
    backend_primary = FRONTEND_TO_BACKEND_ID.get(character_id, "Walter White")
    participants: list[str] = [backend_primary]
    text_lower = (user_message or "").lower()
    for pattern, backend_name in _CREW_MENTION_PATTERNS:
        if re.search(pattern, text_lower) and backend_name not in participants:
            participants.append(backend_name)
    return participants[:cap]


class DirectorAgent:
    """
    Orchestrates a Breaking Bad roleplay session as an async event stream.
    For each session the Director:
      1. Generates a dramatic outline from the user task.
      2. For each scene in the outline, calls _generate_beat() which:
         a. Decides the scene transition (if any) → scene_change
         b. Determines which characters act/think/speak → agent_act/think/speak
         c. Calls character sub-agents for authentic dialogue → agent_speak
         d. Computes what world facts changed → world_state_delta
         e. Updates dossiers in Postgres
         e. Signals beat completion → beat_ready
    """
    def __init__(
        self,
        provider: ProviderFacade,
        model_route: str = DEFAULT_DIRECTOR_MODEL_ROUTE,
        system_prompt: str = DIRECTOR_SYSTEM_PROMPT,
        enable_dossier_updates: bool = True,
    ):
        self.provider = provider
        self.model_route = model_route
        # The base prompt documents the default route in examples and rules.
        # Keep those instructions aligned when a deployment selects a
        # different provider via DIRECTOR_MODEL_ROUTE.
        self.system_prompt = system_prompt.replace(
            DEFAULT_DIRECTOR_MODEL_ROUTE,
            model_route,
        )
        self.enable_dossier_updates = enable_dossier_updates
    async def process(
        self,
        task: str,
        session_factory: Any = None,
        session_id: str | None = None,
        action_queue: Any = None,
        db: Any = None,
        voice_example: str | None = None,
        language: str = "en",
    ) -> AsyncIterator[AgentEvent]:
        """
        Main entry point.  Consumes a task description and yields
        AgentEvent objects until the roleplay outline is fully rendered.
        Event types emitted:
          status, outline, scene_change, agent_act, agent_think,
          agent_speak, world_state_delta, beat_ready, complete, error

        Cycle 45 (H1): ``session_factory`` is the preferred DB handle —
        the director opens a short-lived session per DB operation via
        ``async with session_factory() as session:`` so no connection is
        held during the inter-beat 300s wait. The legacy ``db`` kwarg is
        retained for unit tests that inject a mock session directly; when
        both are supplied, ``session_factory`` wins.
        """
        yield AgentEvent(
            type="status", data={"message": _status_message("analysing", language)}
        )
        # ---- Step 1: generate the outline -----------------------------------
        outline_text = await self._generate_outline(task, language=language)
        if outline_text is None:
            yield AgentEvent(
                type="error",
                data={"message": _status_message("outline_failed", language)},
            )
            return
        scenes = self._parse_outline(outline_text)
        yield self._outline_event(outline_text, scenes=scenes)
        if not scenes:
            yield AgentEvent(
                type="error",
                data={"message": _status_message("no_beats", language)},
            )
            return
        yield AgentEvent(
            type="status",
            data={
                "message": _status_message("outlined", language, n=len(scenes))
            },
        )
        # ---- Step 2: render each beat (beat-by-beat with pause) ----------
        previous_scene = ""
        previous_scene_desc = ""
        idx = 0
        active_character_id: str | None = None  # backend full-name form, e.g. "Jesse Pinkman"
        while idx < len(scenes):
            scene_desc = scenes[idx]
            current_scene = self._short_scene_name(scene_desc)
            async for event in self._generate_beat(
                task=task,
                outline=outline_text,
                beat_index=idx,
                context={
                    "previous_scene": previous_scene,
                    "previous_scene_desc": previous_scene_desc,
                    "current_scene": current_scene,
                },
                scene_desc=scene_desc,
                db=db,
                session_factory=session_factory,
                session_id=session_id,
                active_character_id=active_character_id,
                voice_example=voice_example,
                language=language,
            ):
                yield event
            # Wait for player to continue (unless this is the last beat)
            if idx < len(scenes) - 1 and action_queue is not None:
                yield AgentEvent(
                    type="status",
                    data={"message": "Waiting for player to continue…"},
                )
                try:
                    # Wait up to 5 minutes for player action
                    signal = await asyncio.wait_for(action_queue.get(), timeout=300)
                    act_type = signal.get("action") if isinstance(signal, dict) else signal
                    if act_type == "stop":
                        yield AgentEvent(
                            type="status",
                            data={"message": "Session paused by player."},
                        )
                        return
                    elif act_type == "redirect":
                        task = signal.get("prompt", task)
                        new_outline = await self._generate_outline(task, language=language)
                        if new_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Redirect applied but outline regeneration failed — continuing with current outline."},
                            )
                        else:
                            outline_text = new_outline
                            scenes = self._parse_outline(outline_text)
                            yield self._outline_event(outline_text, scenes=scenes)
                            idx = 0
                            previous_scene = ""
                            previous_scene_desc = ""
                            continue  # skip trailing idx+=1 / previous_scene overwrite
                    elif act_type == "switch_perspective":
                        # Resolve target from signal first (routes.py:151 pushes
                        # {"target": ...}), fall back to db for session-resume.
                        target_raw = signal.get("target") if isinstance(signal, dict) else None
                        if not target_raw and session_id is not None and (session_factory is not None or db is not None):
                            try:
                                from sqlalchemy import select
                                # models.py:9 class is `Session`, routes.py:12
                                # imports `Session as SessionModel`. Use the
                                # alias form to match existing convention.
                                from db.models import Session as SessionModel
                                # Cycle 45 (H1): prefer a short-lived session
                                # from the factory so we don't pin the
                                # request-level connection during the wait.
                                if session_factory is not None:
                                    async with session_factory() as sess:
                                        row = await sess.execute(
                                            select(SessionModel.active_character_id).where(
                                                SessionModel.id == session_id
                                            )
                                        )
                                        target_raw = row.scalar_one_or_none()
                                else:
                                    row = await db.execute(
                                        select(SessionModel.active_character_id).where(
                                            SessionModel.id == session_id
                                        )
                                    )
                                    target_raw = row.scalar_one_or_none()
                            except Exception as e:
                                logger.error(
                                    "Error fetching active_character_id for session %s: %s",
                                    session_id,
                                    e,
                                )
                                target_raw = None
                        # Map frontend short id / display name -> backend full name.
                        if target_raw:
                            active_character_id = resolve_backend_character_id(
                                str(target_raw)
                            )
                        # Fall through to idx += 1 (same as old `pass`).
                    elif act_type == "continue_chapter":
                        # Append a brand-new chapter to the running outline.
                        # The Director prompts the LLM to continue from
                        # where we are; parsed scenes are concatenated onto
                        # the existing scenes list.
                        branch_goal = signal.get("branch_goal") if isinstance(signal, dict) else None
                        next_outline = await self._generate_outline_followup(
                            base_task=task,
                            prior_outline=outline_text,
                            existing_scenes=scenes,
                            branch_goal=branch_goal,
                            language=language,
                        )
                        if next_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Chapter continuation failed — keeping current outline."},
                            )
                        else:
                            next_scenes = self._parse_outline(next_outline)
                            payload = mckee_story.outline_event_payload(
                                next_outline, scenes=next_scenes
                            )
                            payload["appended"] = True
                            payload["chapter"] = 2
                            yield AgentEvent(type="outline", data=payload)
                            scenes = scenes + next_scenes
                            # Re-enter the beat loop starting at the first
                            # newly appended scene so the next iteration
                            # renders beat 1 of chapter 2 (not the next
                            # unrendered beat of chapter 1).
                            idx = len(scenes) - len(next_scenes) - 1
                            previous_scene = current_scene
                            previous_scene_desc = scene_desc
                            continue
                    elif act_type == "branch":
                        # Replace everything from a chosen beat onward. Beats
                        # before from_beat_id stay; everything after is
                        # regenerated. ``scenes[beat_idx]`` keeps the
                        # original beat text; ``branch_scenes`` are appended
                        # after, so the next loop iteration renders
                        # ``scenes[beat_idx + 1]`` which is
                        # ``branch_scenes[0]``. The branch starts AFTER the
                        # chosen beat, not at it.
                        from_beat_id = signal.get("from_beat_id") if isinstance(signal, dict) else None
                        branch_goal = signal.get("branch_goal") if isinstance(signal, dict) else None
                        try:
                            beat_idx = int(str(from_beat_id).rsplit("_", 1)[-1]) - 1
                        except (ValueError, AttributeError, IndexError):
                            beat_idx = max(0, idx - 1)
                        beat_idx = max(0, min(beat_idx, len(scenes) - 1))
                        branch_outline = await self._generate_branch_outline(
                            base_task=task,
                            prior_outline=outline_text,
                            branch_beat_index=beat_idx,
                            scenes=scenes,
                            branch_goal=branch_goal,
                            language=language,
                        )
                        if branch_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Branch generation failed — keeping current outline."},
                            )
                        else:
                            branch_scenes = self._parse_outline(branch_outline)
                            payload = mckee_story.outline_event_payload(
                                branch_outline, scenes=branch_scenes
                            )
                            payload["branched"] = True
                            payload["from_beat_id"] = from_beat_id
                            yield AgentEvent(type="outline", data=payload)
                            # Keep scenes[0..beat_idx] (inclusive) from the
                            # original outline, then append the freshly
                            # generated scenes. The next iteration of the
                            # loop will re-render scenes[beat_idx] with new
                            # body content but same beat position.
                            prefix = scenes[: beat_idx + 1]
                            scenes = prefix + branch_scenes
                            previous_scene = ""
                            previous_scene_desc = ""
                            idx = beat_idx
                            continue  # skip trailing idx+=1 / previous_scene overwrite
                    elif act_type == "replay":
                        # Re-render a specific beat. ``idx`` is set one
                        # before the target so the loop's idx+=1 lands on
                        # it again. The next iteration regenerates that
                        # beat's events without changing the outline.
                        beat_id = signal.get("beat_id") if isinstance(signal, dict) else None
                        try:
                            replay_idx = int(str(beat_id).rsplit("_", 1)[-1]) - 1
                        except (ValueError, AttributeError, IndexError):
                            replay_idx = idx
                        replay_idx = max(0, min(replay_idx, len(scenes) - 1))
                        # If the user replays the LAST beat, splice a copy
                        # so the loop pauses again instead of immediately
                        # emitting ``complete``.
                        if replay_idx == len(scenes) - 1:
                            scenes.append(scenes[replay_idx])
                        previous_scene = ""
                        previous_scene_desc = ""
                        idx = max(0, replay_idx - 1)
                        continue  # skip trailing idx+=1 / previous_scene overwrite
                    # "continue": fall through to next beat
                except asyncio.TimeoutError:
                    yield AgentEvent(
                        type="status",
                        data={"message": _status_message("no_action", language)},
                    )
            idx += 1
            previous_scene = current_scene
            previous_scene_desc = scene_desc
        yield AgentEvent(
            type="complete",
            data={"message": _status_message("complete", language)},
        )

    async def process_next_beat(
        self,
        *,
        session_factory: Any,
        session_id: str,
        voice_example: str | None = None,
        language: str = "en",
    ) -> AsyncIterator[AgentEvent]:
        """Render one persisted story beat without cross-request memory.

        Vercel may route each request to a different function instance. The
        session row therefore owns the outline and next beat index, while this
        method keeps each streaming invocation bounded to one generated beat.
        """
        from db.models import Session as SessionModel

        async with session_factory() as session:
            result = await session.execute(
                select(SessionModel).where(SessionModel.id == session_id)
            )
            story_session = result.scalar_one_or_none()
            if story_session is None:
                raise ValueError("Session not found")
            task = story_session.task_prompt
            outline_text = story_session.plot_outline
            beat_index = int(getattr(story_session, "next_beat_index", 0) or 0)
            active_character_raw = story_session.active_character_id

        if not task:
            raise ValueError("Session has no task_prompt")

        if not outline_text:
            yield AgentEvent(
                type="status",
                data={"message": _status_message("analysing", language)},
            )
            active_for_spine = None
            if active_character_raw:
                active_for_spine = resolve_backend_character_id(
                    str(active_character_raw)
                )
            outline_text = await self._generate_outline(
                task,
                language=language,
                active_character=active_for_spine,
            )
            if outline_text is None:
                yield AgentEvent(
                    type="error",
                    data={"message": _status_message("outline_failed", language)},
                )
                return

            scenes = self._parse_outline(outline_text)
            async with session_factory() as session:
                result = await session.execute(
                    select(SessionModel).where(SessionModel.id == session_id)
                )
                story_session = result.scalar_one_or_none()
                if story_session is None:
                    raise ValueError("Session not found")
                story_session.plot_outline = outline_text
                story_session.next_beat_index = 0
                await session.commit()

            beat_index = 0
            yield self._outline_event(outline_text, scenes=scenes)
            yield AgentEvent(
                type="status",
                data={
                    "message": _status_message("outlined", language, n=len(scenes))
                },
            )
        else:
            scenes = self._parse_outline(outline_text)

        if not scenes:
            yield AgentEvent(
                type="error",
                data={"message": _status_message("no_beats", language)},
            )
            return

        if beat_index >= len(scenes):
            async with session_factory() as session:
                result = await session.execute(
                    select(SessionModel).where(SessionModel.id == session_id)
                )
                story_session = result.scalar_one_or_none()
                if story_session is not None:
                    story_session.status = "complete"
                    await session.commit()
            yield AgentEvent(
                type="complete",
                data={"message": _status_message("complete", language)},
            )
            return

        scene_desc = scenes[beat_index]
        current_scene = self._short_scene_name(scene_desc)
        previous_scene = (
            self._short_scene_name(scenes[beat_index - 1]) if beat_index > 0 else ""
        )
        previous_scene_desc = scenes[beat_index - 1] if beat_index > 0 else ""
        active_character_id = resolve_backend_character_id(active_character_raw)
        ready_event: AgentEvent | None = None

        async for event in self._generate_beat(
            task=task,
            outline=outline_text,
            beat_index=beat_index,
            context={
                "previous_scene": previous_scene,
                "previous_scene_desc": previous_scene_desc,
                "current_scene": current_scene,
            },
            scene_desc=scene_desc,
            session_factory=session_factory,
            session_id=session_id,
            active_character_id=active_character_id,
            voice_example=voice_example,
            language=language,
        ):
            if event.type == "beat_ready":
                ready_event = event
            else:
                yield event

        next_beat_index = beat_index + 1
        is_final = next_beat_index >= len(scenes)
        async with session_factory() as session:
            result = await session.execute(
                select(SessionModel).where(SessionModel.id == session_id)
            )
            story_session = result.scalar_one_or_none()
            if story_session is None:
                raise ValueError("Session not found")
            story_session.plot_outline = outline_text
            story_session.next_beat_index = next_beat_index
            story_session.status = "complete" if is_final else "waiting"
            await session.commit()

        ready_data = dict(ready_event.data) if ready_event is not None else {
            "beat_id": f"beat_{next_beat_index}",
            "beat_summary": scene_desc,
        }
        ready_data["is_final"] = is_final
        yield AgentEvent(
            type="beat_ready",
            data=ready_data,
            model_route=ready_event.model_route if ready_event is not None else None,
        )

        if is_final:
            yield AgentEvent(
                type="complete",
                data={"message": _status_message("complete", language)},
            )

    # ------------------------------------------------------------------
    # Outline generation
    # ------------------------------------------------------------------
    async def _generate_outline(
        self,
        task: str,
        language: str = "en",
        *,
        active_character: str | None = None,
    ) -> str | None:
        """Call the LLM to produce a McKee-structured Breaking Bad outline."""
        lang_directive = _language_directive(language)
        user_body = mckee_story.build_outline_user_prompt(
            task, language, active_character=active_character
        )
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": f"{lang_directive}\n\n{user_body}",
            },
        ]
        try:
            raw = await self.provider.call_model(messages, self.model_route)
            # B1 fix: if LLM returned JSON despite instructions, extract text
            if raw and raw.strip().startswith(('[', '{')):
                return self._extract_text_from_json_outline(raw)
            return raw
        except Exception:
            logger.exception("Outline generation LLM call failed")
            return None
    @staticmethod
    def _route_for_provider(
        self,
        provider_id: str | None,
        model_id: str | None = None,
        *,
        fallback: str | None = None,
    ) -> str:
        """Map UI/BYOK provider id to provider/model route."""
        from agents.byok_presets import preset_by_id
        from agents.credential_context import get_credential_override

        pid = (provider_id or "").strip().lower()
        ov = get_credential_override()
        if ov and ov.provider_id:
            pid = ov.provider_id.strip().lower() or pid
            model_id = model_id or ov.model_id

        if not pid:
            return fallback or "stepfun/step-3.7-flash"

        if pid == "cliproxy":
            model = model_id or getattr(
                self.provider, "cli_proxy_default_model", "gemini-pro-agent"
            )
            return f"cliproxy/{model}"

        preset = preset_by_id(pid)
        default_model = (
            (preset.get("defaultModel") if preset else None)
            or {
                "minimax": "MiniMax-M3",
                "stepfun": "step-3.7-flash",
            }.get(pid)
            or "step-3.7-flash"
        )
        model = (model_id or "").strip() or default_model
        # If unknown provider and no preset, keep fallback when possible.
        if preset is None and pid not in ("minimax", "stepfun", "cliproxy"):
            return fallback or f"{pid}/{model}"
        return f"{pid}/{model}"


    def _extract_text_from_json_outline(raw: str) -> str:
        """Extract readable scene descriptions from a JSON array the LLM
        returned despite the plain-text instruction (B1 fallback)."""
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                lines = []
                for i, item in enumerate(data, 1):
                    if isinstance(item, dict):
                        scene = item.get('scene') or item.get('title') or item.get('name', '')
                        desc = item.get('description') or item.get('desc', '')
                        text = f"{scene} — {desc}" if desc else scene
                        if text:
                            lines.append(f"{i}. {text}")
                    elif isinstance(item, str):
                        lines.append(f"{i}. {item}")
                return '\n'.join(lines) if lines else raw
        except (json.JSONDecodeError, TypeError):
            pass
        return raw
    @staticmethod
    def _short_scene_name(scene_desc: str) -> str:
        """Player-facing location label (no McKee value/gap/risk scaffolding)."""
        return mckee_story.player_facing_scene_label(scene_desc)

    async def _generate_outline_followup(
        self,
        base_task: str,
        prior_outline: str,
        existing_scenes: list[str],
        branch_goal: str | None = None,
        language: str = "en",
    ) -> str | None:
        """Generate the next chapter's outline as a continuation.

        Returns a numbered plain-text outline (same format as
        ``_generate_outline``). Scenes from this outline are concatenated
        onto the existing list — beats are never re-numbered.
        """
        lang_directive = _language_directive(language)
        user_body = mckee_story.build_followup_user_prompt(
            base_task,
            prior_outline,
            existing_scenes,
            language,
            branch_goal=branch_goal,
        )
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": f"{lang_directive}\n\n{user_body}",
            },
        ]
        try:
            raw = await self.provider.call_model(messages, self.model_route)
            if raw and raw.strip().startswith(('[', '{')):
                return self._extract_text_from_json_outline(raw)
            return raw
        except Exception:
            logger.exception("Outline followup LLM call failed")
            return None

    async def _generate_branch_outline(
        self,
        base_task: str,
        prior_outline: str,
        branch_beat_index: int,
        scenes: list[str],
        branch_goal: str | None = None,
        language: str = "en",
    ) -> str | None:
        """Generate a new outline for everything AFTER the branch beat.

        The Director keeps ``scenes[: branch_beat_index + 1]`` and replaces
        the rest with the LLM's output. Output is a plain-text numbered
        list (continuing the prior outline's tone, not duplicating beats).
        """
        lang_directive = _language_directive(language)
        user_body = mckee_story.build_branch_user_prompt(
            base_task,
            prior_outline,
            branch_beat_index,
            scenes,
            language,
            branch_goal=branch_goal,
        )
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": f"{lang_directive}\n\n{user_body}",
            },
        ]
        try:
            raw = await self.provider.call_model(messages, self.model_route)
            if raw and raw.strip().startswith(('[', '{')):
                return self._extract_text_from_json_outline(raw)
            return raw
        except Exception:
            logger.exception("Branch outline LLM call failed")
            return None
    @staticmethod
    def _outline_event(
        outline_text: str,
        *,
        scenes: list[str] | None = None,
    ) -> AgentEvent:
        """Emit outline SSE with McKee spine meta + soft structure warnings."""
        scene_list = (
            scenes
            if scenes is not None
            else DirectorAgent._parse_outline(outline_text)
        )
        return AgentEvent(
            type="outline",
            data=mckee_story.outline_event_payload(
                outline_text, scenes=scene_list
            ),
        )

    @staticmethod
    def _parse_outline(text: str) -> list[str]:
        """Parse an LLM-generated outline into a list of scene descriptions.
        Handles McKee meta headers, plain-text numbered lists, and JSON arrays.
        """
        # Drop McKee spine meta so PROTAGONIST/SPINE lines never become beats.
        text = mckee_story.filter_playable_outline_lines(text)
        # B1 fix: if the text is a JSON array, extract readable descriptions first
        stripped = text.strip()
        if stripped.startswith(('[', '{')):
            extracted = DirectorAgent._extract_text_from_json_outline(stripped)
            if extracted != stripped:
                text = extracted
        scenes: list[str] = []
        current: list[str] = []
        list_item_re = re.compile(r"^[\s]*(\d+[\.\)]\s+|[-\*]\s+)")
        for raw_line in text.splitlines():
            stripped_line = raw_line.strip()
            if not stripped_line:
                continue
            if list_item_re.match(stripped_line):
                if current:
                    scenes.append(" ".join(current).strip())
                    current = []
                content = list_item_re.sub("", stripped_line).strip()
                current.append(content)
            elif current:
                # Continuation of a multi-line beat; skip stray meta mid-outline.
                if mckee_story.is_meta_outline_line(stripped_line):
                    continue
                current.append(stripped_line)
        if current:
            scenes.append(" ".join(current).strip())
        if scenes:
            return scenes
        stripped = text.strip()
        return [stripped] if stripped else []
    # ------------------------------------------------------------------
    # Beat generation
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_model_route(event_dict: dict[str, Any]) -> str | None:
        """Pull recommended_model from a raw event dict emitted by the LLM."""
        raw = event_dict.get("recommended_model")
        if raw and isinstance(raw, str) and raw.startswith(("minimax/", "stepfun/", "cliproxy/")):
            return raw
        return None

    def _system_prompt_with_voice_example(self, voice_example: str | None) -> str:
        if not voice_example:
            return self.system_prompt
        return (
            f"{self.system_prompt}\n\n"
            "VOICE ANCHOR:\n"
            "Use this reference speaking style when drafting or rewriting story dialogue. "
            "Keep the current scene facts, but match this cadence and relationship pressure. "
            "The reference may be in a different language than the user's reply language; "
            "translate the register and pressure into the target reply language rather "
            "than transliterating the surface words.\n"
            f"{voice_example}"
        )

    async def _generate_beat(
        self,
        task: str,
        outline: str,
        beat_index: int,
        context: dict[str, str],
        scene_desc: str | None = None,
        db: Any = None,
        session_factory: Any = None,
        session_id: str | None = None,
        active_character_id: str | None = None,
        voice_example: str | None = None,
        language: str = "en",
    ) -> AsyncIterator[AgentEvent]:
        """
        Generate a single narrative beat with fine-grained events.
        Steps:
          1. Ask the LLM to produce a JSON array of events for this beat
          2. Parse recommended_model from each event to determine per-beat routing
          3. For agent_speak events, call the actual character sub-agent
          4. Yield each event (with model_route attached)
          5. After all events, update dossiers if db is available
          6. Emit beat_ready

        ``scene_desc`` is the pre-parsed scene description for this beat.
        Callers that already hold the parsed outline (e.g. ``process()``)
        should pass it to avoid re-parsing the outline per beat (O(n²) → O(n)).
        Falls back to parsing ``outline`` only if not supplied.
        """
        if scene_desc is None:
            scene_desc = self._parse_outline(outline)[beat_index]
        parsed_scenes = self._parse_outline(outline) if outline else [scene_desc]
        total_beats = max(len(parsed_scenes), beat_index + 1)
        current_scene = self._short_scene_name(scene_desc)
        previous_scene = context.get("previous_scene", "")
        characters_in_scene: list[str] = list(CHARACTER_AGENTS.keys())
        mckee_role = mckee_story.resolve_beat_role(
            scene_desc, beat_index, total_beats
        )
        # Emit scene transition if location changed.
        # Player stage must never show McKee craft lines (value/gap/risk).
        if current_scene and current_scene != previous_scene:
            blurb = mckee_story.player_facing_scene_blurb(scene_desc)
            if language.startswith("zh"):
                scene_desc_text = blurb or f"切换至：{current_scene}"
            else:
                scene_desc_text = blurb or f"Transitioning to: {current_scene}"
            yield AgentEvent(
                type="scene_change",
                data={
                    "from_scene": previous_scene or "unknown",
                    "to_scene": current_scene,
                    "description": scene_desc_text,
                    "mckee_role": mckee_role,
                },
            )
        # Ask Director LLM to plan this beat's events.
        # Language directive MUST be on this prompt: agent_think / agent_act
        # are written here, not by character sub-agents.
        lang_directive = _language_directive(language)
        beat_prompt = (
            f"{lang_directive}\n\n"
            f"Task: {task}\n\n"
            f"Outline:\n{outline}\n\n"
            f"Current scene (beat {beat_index + 1}/{total_beats}): {scene_desc}\n\n"
        )
        if active_character_id:
            beat_prompt += (
                f"Active perspective character: {active_character_id}\n"
                f"IMPORTANT: The FIRST agent_speak event in this beat MUST have "
                f"character_id exactly equal to \"{active_character_id}\". "
                f"Other characters may speak afterwards, but the opening voice must be "
                f"{active_character_id}.\n\n"
            )
        beat_prompt += mckee_story.build_beat_planning_addon(
            scene_desc,
            beat_index=beat_index,
            total_beats=total_beats,
            language=language,
            previous_scene_desc=context.get("previous_scene_desc") or None,
            outline_text=outline,
        )
        beat_prompt += (
            "PREFERRED OUTPUT (DEC-0005 Beat Contract + events): a single JSON object:\n"
            "{\n"
            '  "contract": {\n'
            f'    "beat_id": "beat_{beat_index + 1:02d}",\n'
            f'    "dramatic_role": "{mckee_role or "progressive"}",\n'
            '    "location_id": "<short location slug>",\n'
            '    "present_characters": ["walter","jesse", ... short ids only],\n'
            '    "value_before": "<private dramatic value before>",\n'
            '    "value_after": "<private dramatic value after>",\n'
            '    "dramatic_question": "<what must be answered this beat>",\n'
            '    "pressure_source": "<what presses the cast>",\n'
            '    "required_outcome": ["..."],\n'
            '    "forbidden_outcomes": ["character learns unknown facts", "..."]\n'
            "  },\n"
            '  "events": [ /* legacy event array — see system prompt */ ]\n'
            "}\n"
            "Contract is authorial intent only — do NOT put final spoken lines in the contract. "
            "agent_speak.content in events may be draft; Character Agents own final dialogue. "
            "Legacy fallback: if you cannot emit a contract, emit the events JSON array alone.\n"
            "Keep the beat concise: include at most two agent_speak events total. "
            "Include only one scene_change if needed. Include brief agent_act and agent_think events. "
            "End with one world_state_delta containing only concrete changed facts. "
            "Every event object must include a 'recommended_model' field set to "
            f"'{self.model_route}'. "
            "Obey RESPONSE LANGUAGE for every narrative string field "
            "(action, thought_content, content, description, deltas)."
        )
        system_content = self._system_prompt_with_voice_example(voice_example)
        if _norm_lang(language) == "zh":
            # System prompt examples are English; force Chinese output override.
            system_content = (
                f"{lang_directive}\n\n"
                f"{system_content}\n\n"
                "CRITICAL OVERRIDE: Even though the schema examples above are English, "
                "every player-visible narrative string you emit in this beat "
                "(action, thought_content, content, description, delta values) "
                "MUST be Simplified Chinese. English stage directions are forbidden."
            )
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": beat_prompt},
        ]
        try:
            llm_response = await self.provider.call_model(messages, self.model_route)
        except Exception:
            logger.exception("Beat %d LLM call failed", beat_index + 1)
            yield AgentEvent(
                type="error",
                data={
                    "message": _status_message(
                        "beat_llm_failed",
                        language,
                        n=beat_index + 1,
                        route=self.model_route,
                    )
                },
            )
            yield self._beat_ready_event(beat_index, f"Beat {beat_index + 1} failed.")
            return
        # Parse LLM response as DEC-0005 plan (contract + events) or legacy array.
        events, contract_raw = parse_beat_plan(llm_response)
        if not events:
            # One repair pass: models often emit prose + broken JSON after
            # perspective switches (longer constraints). Ask for JSON-only.
            logger.warning(
                "Beat %d parse miss; retrying JSON repair (route=%s preview=%s)",
                beat_index + 1,
                self.model_route,
                parse_preview(llm_response),
            )
            repair_messages = [
                {
                    "role": "system",
                    "content": (
                        "You repair broken story-beat JSON. "
                        "Prefer {\"contract\":{...},\"events\":[...]} (DEC-0005). "
                        "Or a plain JSON array of event objects. No markdown, no prose."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"{lang_directive}\n\n"
                        "The previous model output could not be parsed as a beat plan.\n"
                        "Re-emit valid JSON for this beat with the same rules:\n"
                        "- types: scene_change | agent_act | agent_think | agent_speak | world_state_delta\n"
                        f"- at most two agent_speak; first speak character_id must be "
                        f"\"{active_character_id}\" if set\n"
                        "- recommended_model on every event\n"
                        "- agent_speak.content pure dialogue, no parentheticals\n"
                        f"- end with world_state_delta\n\n"
                        f"Scene: {scene_desc}\nTask: {task}\n\n"
                        f"Broken output to repair:\n{str(llm_response or '')[:6000]}"
                    ),
                },
            ]
            try:
                repaired = await self.provider.call_model(
                    repair_messages, self.model_route, max_tokens=4096
                )
                events, repair_contract = parse_beat_plan(repaired)
                if repair_contract and not contract_raw:
                    contract_raw = repair_contract
            except Exception:
                logger.exception("Beat %d JSON repair call failed", beat_index + 1)
                events = []
        if not events:
            yield AgentEvent(
                type="error",
                data={
                    "message": _status_message(
                        "beat_parse_failed", language, route=self.model_route
                    ),
                    "route": self.model_route,
                    "preview": parse_preview(llm_response),
                },
            )
            yield self._beat_ready_event(beat_index, f"Beat {beat_index + 1} (parse fallback).")
            return

        # Filter fallback: if active_character_id set, hoist its first agent_speak
        # to be the first agent_speak in yield order. Other events keep relative order.
        if active_character_id:
            target_name = active_character_id
            idx_first_speak = None
            idx_target_speak = None
            for i, evt in enumerate(events):
                if evt.get("type") == "agent_speak" and idx_first_speak is None:
                    idx_first_speak = i
                if (
                    evt.get("type") == "agent_speak"
                    and evt.get("data", {}).get("character_id") == target_name
                    and idx_target_speak is None
                ):
                    idx_target_speak = i
            if idx_target_speak is not None and idx_target_speak != idx_first_speak:
                target_evt = events.pop(idx_target_speak)
                events.insert(idx_first_speak, target_evt)
        events = self._prepare_beat_events(events)
        # If language is zh but the planner still emitted English narrative,
        # rewrite those fields before character polish / yield.
        events = await self._rewrite_english_fields_to_zh(
            events, language=language, model_route=self.model_route
        )
        if _norm_lang(language) == "zh":
            events = normalize_zh_names_in_events(events)
        # Resolve per-beat model route: prefer LLM-suggested, fall back to rule-based
        llm_suggested: str | None = None
        for evt in events:
            candidate = self._extract_model_route(evt)
            if candidate:
                llm_suggested = candidate
                break
        if llm_suggested:
            beat_model_route = llm_suggested
        else:
            beat_model_route = self.provider.resolve_model_route(
                scene_context=scene_desc,
                characters=characters_in_scene,
            )
        # ------------------------------------------------------------------
        # DEC-0005 P1 — Beat Contract (Director authority)
        # Prefer LLM contract; synthesize from events if omitted.
        # ------------------------------------------------------------------
        beat_contract: BeatContract | None = try_parse_beat_contract(contract_raw)
        if beat_contract is None:
            beat_contract = synthesize_beat_contract(
                beat_index=beat_index,
                scene_desc=scene_desc or "",
                location_id=current_scene or scene_desc or "unknown",
                dramatic_role=mckee_role or "progressive",
                events=events,
                active_backend_id=active_character_id,
            )
            logger.info(
                "Beat %d: synthesized BeatContract (LLM contract missing/invalid)",
                beat_index + 1,
            )
        else:
            logger.info(
                "Beat %d: BeatContract ok role=%s cast=%s",
                beat_index + 1,
                beat_contract.dramatic_role,
                beat_contract.present_characters,
            )
        # Process each event - substitute real character responses for agent_speak
        beat_events_for_dossier: list[dict[str, Any]] = []
        # agent_speak event payloads collected during the loop; persisted
        # after the loop in a single short-lived DB session (Cycle 45 / H1).
        speak_events_to_persist: list[dict[str, Any]] = []
        # Continuity Board: shared room memory so later speakers continue
        # from what already happened, and only receive facts they would know.
        from agents.continuity_board import (
            apply_delta_facts,
            filter_board_for_character,
            format_board_prompt,
            load_or_init_session_board,
            save_session_board,
            set_location,
        )
        continuity_board: dict[str, Any] | None = None
        try:
            continuity_board = await load_or_init_session_board(
                session_factory,
                session_id or "",
                location=current_scene or scene_desc or "",
            )
            if current_scene or scene_desc:
                continuity_board = set_location(
                    continuity_board, current_scene or scene_desc or ""
                )
        except Exception:
            logger.debug("Continuity board load failed for beat %s", beat_index + 1)
            continuity_board = None
        # ------------------------------------------------------------------
        # Phase 1 — Character Policy owns act + mind + line (Turn Proposal)
        # Director: Beat Contract + optional event skeleton only.
        # Character: action (closed verb), inner_monologue, speech strategy, line.
        # Rewrite BEFORE any yield so UI never streams Director-generic mind/act.
        # ------------------------------------------------------------------
        prior_spoken_lines: list[dict[str, str]] = []
        i = 0
        while i < len(events):
            evt = events[i]
            evt_type = evt.get("type", "")
            evt_data = dict(evt.get("data") or {}) if isinstance(evt.get("data"), dict) else {}
            if evt_type != "agent_speak":
                i += 1
                continue

            character_id = str(evt_data.get("character_id") or "")
            character_cls = CHARACTER_AGENTS.get(character_id)
            char_thinking: str | None = None
            if character_cls is not None:
                character_agent = character_cls(self.provider)
                dossier_context = ""
                if session_factory is not None:
                    try:
                        async with session_factory() as sess:
                            from db.models import CharacterDossier
                            stmt = select(CharacterDossier).where(
                                CharacterDossier.session_id == session_id,
                            )
                            result = await sess.execute(stmt)
                            all_dossiers = result.scalars().all()
                            from agents.memory import format_dossier_context
                            dossier_context = format_dossier_context(
                                list(all_dossiers), character_id,
                            )
                    except Exception:
                        logger.debug("Dossier load failed for %s", character_id)
                if continuity_board is not None:
                    try:
                        board_view = filter_board_for_character(
                            continuity_board, character_id
                        )
                        board_block = format_board_prompt(
                            board_view, character_id=character_id
                        )
                        dossier_context = (
                            f"{dossier_context}\n\n{board_block}".strip()
                            if dossier_context
                            else board_block
                        )
                    except Exception:
                        logger.debug(
                            "Continuity board inject failed for %s", character_id
                        )
                peer_context: list[dict[str, str]] = []
                for prior in prior_spoken_lines:
                    peer_context.append(
                        {
                            "role": "user",
                            "content": (
                                f"[Already said in this scene by "
                                f"{prior['character_id']}]: {prior['content']}"
                            ),
                        }
                    )
                try:
                    speak_lang_note = (
                        "台词 reply_text 必须用简体中文。不要用英文对白。"
                        "只写角色说出口的话：禁止任何括号舞台指示或旁白评语"
                        "（禁止「（声音放低，像是…）」「（眼神…）」「仿佛/像是/带着…的神情」）。"
                        "物理动作必须写在 action.verb（封闭词表），禁止写进台词。"
                        "thinking 必须是该角色私密内心（1-3 句），从面具底下写，"
                        "禁止旁白腔、禁止解说剧情功能。"
                        "角色中文名固定：Mike→麦克（禁米克）、Walter→沃尔特、"
                        "Jesse→杰西、Skyler→斯凯勒、Saul→索尔、Gus→古斯、"
                        "Hank→汉克、Todd→托德（禁托霍）、Jack Welker→杰克·维尔克"
                        "（禁杰克·托霍）、Tuco→图科。"
                        if _norm_lang(language) == "zh"
                        else (
                            "Dialogue reply_text must be English. "
                            "Spoken words only: no parenthetical stage directions "
                            "or narrator similes. "
                            "YOU own physical action via action.verb (closed ontology). "
                            "thinking must be this character's private inner monologue "
                            "(1-3 sentences), from under the public mask — not narrator "
                            "commentary or plot-function exposition."
                        )
                    )
                    prior_note = ""
                    if prior_spoken_lines:
                        prior_note = (
                            "Earlier lines in this beat already happened; "
                            "continue from them, do not restart the scene.\n"
                        )
                    director_draft = str(evt_data.get("content") or "").strip()
                    draft_note = (
                        f"Director draft line is optional scene pressure only "
                        f"(facts may be wrong for your knowledge — rewrite):\n"
                        f"{director_draft}\n"
                        if director_draft
                        else ""
                    )
                    contract_note = ""
                    if beat_contract is not None:
                        contract_note = (
                            f"Beat Contract (authorial intent — obey constraints, "
                            f"do not dump craft labels into dialogue):\n"
                            f"- role: {beat_contract.dramatic_role}\n"
                            f"- dramatic_question: {beat_contract.dramatic_question}\n"
                            f"- pressure: {beat_contract.pressure_source}\n"
                            f"- forbidden: {beat_contract.forbidden_outcomes}\n"
                        )
                    sub_result = await character_agent.respond_structured(
                        context=peer_context,
                        user_message=(
                            f"{_language_directive(language)}\n\n"
                            f"{speak_lang_note}\n"
                            f"{prior_note}"
                            f"{contract_note}"
                            f"{draft_note}"
                            f"Scene: {scene_desc}\nContext: {task}\n"
                            "Respond as Character Policy: fill action, thinking, "
                            "speech strategy fields, and reply_text."
                        ),
                        model_route=beat_model_route,
                        voice_example=voice_example,
                        dossier_context=dossier_context or None,
                        policy_turn=True,
                    )
                    reply = sub_result["reply_text"]
                    if _norm_lang(language) == "zh" and _needs_zh_rewrite(reply):
                        reply = await self._translate_one_field_to_zh(
                            reply, model_route=beat_model_route
                        )
                    if _norm_lang(language) == "zh":
                        reply = normalize_zh_character_names(reply)
                    reply = sanitize_speak_content(reply)
                    char_thinking = (sub_result.get("thinking") or "").strip() or None
                    if char_thinking and _norm_lang(language) == "zh":
                        if _needs_zh_rewrite(char_thinking):
                            char_thinking = await self._translate_one_field_to_zh(
                                char_thinking, model_route=beat_model_route
                            )
                        char_thinking = normalize_zh_character_names(char_thinking)

                    # Director act is fallback only if Character omitted action.
                    director_action: str | None = None
                    for j in range(i - 1, -1, -1):
                        prev = events[j]
                        if prev.get("type") != "agent_act":
                            continue
                        pdata = prev.get("data") if isinstance(prev.get("data"), dict) else {}
                        if pdata.get("character_id") == character_id:
                            if pdata.get("source") != "character_policy":
                                director_action = (
                                    str(pdata.get("action") or "").strip() or None
                                )
                            break

                    observed = [
                        f"{p['character_id']}: {p['content']}"
                        for p in prior_spoken_lines
                        if p.get("content")
                    ]
                    turn = turn_proposal_from_character_result(
                        backend_character_id=character_id,
                        reply_text=reply,
                        thinking=char_thinking,
                        emotion_state=sub_result.get("emotion_state")
                        or evt_data.get("emotion_state"),
                        director_action=director_action,
                        character_action=sub_result.get("action"),
                        observed_facts=observed,
                        private_goal=str(sub_result.get("private_goal") or ""),
                        fear=str(sub_result.get("fear") or ""),
                        relationship_tactic=str(
                            sub_result.get("relationship_tactic") or ""
                        ),
                        speech_act=str(sub_result.get("speech_act") or ""),
                        surface_intent=str(sub_result.get("surface_intent") or ""),
                        subtext=str(sub_result.get("subtext") or ""),
                    )
                    # Canonicalize action verb onto the closed ontology.
                    if turn.action and (turn.action.verb or "").strip():
                        canon_verb, _mapped = map_action_verb(turn.action.verb)
                        turn = turn.model_copy(
                            update={
                                "action": turn.action.model_copy(
                                    update={"verb": canon_verb}
                                )
                            }
                        )
                    elif turn.action is None:
                        # Character must still stage something executable.
                        turn = turn.model_copy(
                            update={"action": ActionProposal(verb="idle_tense")}
                        )
                    # Speakers implied by director drafts are always legal cast.
                    beat_contract = ensure_actor_on_contract(beat_contract, character_id)
                    basic = validate_turn_against_contract_basic(beat_contract, turn)
                    world_mode = parse_world_mode(
                        context.get("world_mode") or context.get("worldMode")
                    )
                    world = validate_world_turn(
                        beat_contract,
                        turn,
                        board=continuity_board,
                        world_mode=world_mode,
                    )
                    v_ok = basic.ok and world.ok
                    if not v_ok:
                        logger.warning(
                            "Beat %d world/turn validation failed for %s mode=%s: %s",
                            beat_index + 1,
                            character_id,
                            world_mode,
                            [iss.model_dump() for iss in (basic.issues + world.issues)],
                        )
                    # Hard knowledge / presence failure: strip monologue that
                    # leaks, keep sanitized line if still speakable.
                    if not world.ok and any(
                        iss.code == "knowledge_boundary" and iss.severity == "error"
                        for iss in world.issues
                    ):
                        turn = turn.model_copy(update={"inner_monologue": ""})
                        char_thinking = None
                    if not v_ok and any(
                        iss.code in ("actor_removed", "empty_turn")
                        and iss.severity == "error"
                        for iss in (basic.issues + world.issues)
                    ):
                        # Do not commit speech for dead/removed actors.
                        reply = ""
                        turn = turn.model_copy(update={"line": "", "inner_monologue": ""})
                        char_thinking = None
                    # Commit Turn Proposal → speak fields (SSE-compatible).
                    reply = sanitize_speak_content(turn.line or reply)
                    char_thinking = (turn.inner_monologue or char_thinking or "").strip() or None
                    evt_data = {
                        **evt_data,
                        "content": reply,
                        "emotion_state": turn.emotion_state
                        or sub_result["emotion_state"]
                        or evt_data.get("emotion_state"),
                        "gif_search_query": sub_result["gif_search_query"]
                        or evt_data.get("gif_search_query"),
                        "speech_act": turn.speech_act or None,
                        "surface_intent": turn.surface_intent or None,
                        "subtext": turn.subtext or None,
                        "relationship_tactic": turn.relationship_tactic or None,
                        "private_goal": turn.private_goal or None,
                        "turn_validation_ok": v_ok,
                        "world_mode": world_mode,
                        "action_source": "character_policy",
                    }
                    # Soft critic (P3): score only; hard fail already applied above.
                    if v_ok:
                        try:
                            critic = score_turn(
                                beat_contract, turn, board=continuity_board
                            )
                            evt_data["critic_score"] = {
                                "weighted_total": critic.weighted_total,
                                "intentionality": critic.intentionality,
                                "causal_relevance": critic.causal_relevance,
                                "continuity": critic.continuity,
                                "dramatic_value": critic.dramatic_value,
                                "visual_executability": critic.visual_executability,
                                "notes": critic.notes or None,
                            }
                        except Exception:
                            logger.debug(
                                "Soft critic failed for %s beat %s",
                                character_id,
                                beat_index + 1,
                            )
                    # Character Policy action overwrites/inserts agent_act.
                    events, i = upsert_agent_act_from_turn(
                        events,
                        backend_character_id=character_id,
                        turn=turn,
                        speak_index=i,
                    )
                    # Deterministic board commit only when hard validation passed.
                    if v_ok and continuity_board is not None:
                        try:
                            continuity_board = apply_validated_turn(
                                continuity_board, turn, beat_index=beat_index
                            )
                        except Exception:
                            logger.debug(
                                "State reducer failed for %s beat %s",
                                character_id,
                                beat_index + 1,
                            )
                except Exception:
                    logger.warning(
                        "Character sub-agent call failed for %s, using LLM dialogue fallback",
                        character_id,
                    )

            # Always purify speak content (director draft fallback path included).
            cleaned = sanitize_speak_content(str(evt_data.get("content") or ""))
            if _norm_lang(language) == "zh":
                cleaned = normalize_zh_character_names(cleaned)
            evt_data = {**evt_data, "content": cleaned}
            events[i] = {**evt, "type": "agent_speak", "data": evt_data}

            if char_thinking:
                events = apply_character_thinking(
                    events,
                    character_id,
                    char_thinking,
                    speak_index=i,
                )
                # Insertion shifts speak to i+1; advance past think+speak.
                if (
                    i < len(events)
                    and events[i].get("type") == "agent_think"
                    and (events[i].get("data") or {}).get("character_id") == character_id
                    and i + 1 < len(events)
                    and events[i + 1].get("type") == "agent_speak"
                ):
                    i += 2
                    content = cleaned.strip()
                    if content:
                        prior_spoken_lines.append(
                            {"character_id": character_id, "content": content}
                        )
                    continue

            content = cleaned.strip()
            if content:
                prior_spoken_lines.append(
                    {"character_id": character_id, "content": content}
                )
            i += 1

        # ------------------------------------------------------------------
        # Phase 2 — yield enriched events (think already Character-bound)
        # ------------------------------------------------------------------
        for evt in events:
            evt_type = evt.get("type", "")
            evt_data = evt.get("data", {}) if isinstance(evt.get("data"), dict) else {}
            # Final speak purify (idempotent).
            if evt_type == "agent_speak":
                cleaned = sanitize_speak_content(str(evt_data.get("content") or ""))
                if _norm_lang(language) == "zh":
                    cleaned = normalize_zh_character_names(cleaned)
                evt_data = {**evt_data, "content": cleaned}
            yield AgentEvent(
                type=evt_type,
                data=evt_data,
                model_route=beat_model_route,
            )
            # Collect agent_speak events to persist after the loop. Deferring
            # the DB writes keeps the session open for the shortest possible
            # window (Cycle 45 / H1: avoid holding a DB connection during the
            # character sub-agent LLM calls). Other event types (agent_think,
            # act, scene_change, world_state_delta) are not user-visible
            # dialogue and are intentionally not persisted here.
            if evt_type == "agent_speak":
                speak_events_to_persist.append(evt_data)
            beat_events_for_dossier.append(
                {"type": evt_type, "data": evt_data, "recommended_model": evt.get("recommended_model")}
            )
        # Persist agent_speak Messages + update dossiers. All writes share
        # ONE session because:
        #  - Messages are committed before update_dossiers (L5 fix) so they
        #    survive a dossier-failure rollback.
        #  - update_dossiers calls db.add/commit internally and must see
        #    the same transaction state.
        # Cycle 45 (H1): when session_factory is provided, open a fresh
        # short-lived session so no DB connection is held during the LLM
        # sub-agent calls or the inter-beat 300s wait. The legacy ``db``
        # path is retained for unit tests that pass a mock session directly.
        has_db = (
            session_id is not None
            and (session_factory is not None or db is not None)
            and len(speak_events_to_persist) > 0
        )
        # Even with no agent_speak events, we still call update_dossiers if
        # a session is available — dossier deltas can derive from non-speak
        # events (agent_act, scene_change) in beat_events_for_dossier.
        if not has_db and session_id is not None and (session_factory is not None or db is not None):
            has_db = True
        deltas: list[dict[str, Any]] | None = None
        if has_db:
            if session_factory is not None:
                async with session_factory() as session:
                    deltas = await self._persist_beat_writes(
                        session=session,
                        session_id=session_id,
                        beat_index=beat_index,
                        speak_events=speak_events_to_persist,
                        beat_events_for_dossier=beat_events_for_dossier,
                        scene_desc=scene_desc,
                        beat_model_route=beat_model_route,
                    )
            else:
                deltas = await self._persist_beat_writes(
                    session=db,
                    session_id=session_id,
                    beat_index=beat_index,
                    speak_events=speak_events_to_persist,
                    beat_events_for_dossier=beat_events_for_dossier,
                    scene_desc=scene_desc,
                    beat_model_route=beat_model_route,
                )
            if deltas:
                yield AgentEvent(
                    type="world_state_delta",
                    data={"deltas": deltas, "model_route": beat_model_route},
                )
        # Append beat deltas onto Continuity Board and persist (memory, not judgment).
        if continuity_board is not None:
            try:
                delta_payload: list[dict[str, Any]] = []
                for raw_evt in events:
                    if raw_evt.get("type") != "world_state_delta":
                        continue
                    raw_deltas = (raw_evt.get("data") or {}).get("deltas") or []
                    if isinstance(raw_deltas, list):
                        delta_payload.extend(
                            d for d in raw_deltas if isinstance(d, dict)
                        )
                if deltas:
                    delta_payload.extend(d for d in deltas if isinstance(d, dict))
                speakers = [
                    str(s.get("character_id") or "")
                    for s in speak_events_to_persist
                    if s.get("character_id")
                ]
                known_by = speakers or list(continuity_board.get("present_cast") or [])
                if delta_payload:
                    continuity_board = apply_delta_facts(
                        continuity_board,
                        deltas=delta_payload,
                        known_by=known_by,
                        beat_index=beat_index,
                    )
                if current_scene or scene_desc:
                    continuity_board = set_location(
                        continuity_board, current_scene or scene_desc or ""
                    )
                await save_session_board(
                    session_factory, session_id or "", continuity_board
                )
            except Exception:
                logger.debug(
                    "Continuity board save failed for beat %s", beat_index + 1
                )
        # Signal beat completion (attach contract summary for clients/debug).
        yield self._beat_ready_event(
            beat_index,
            scene_desc,
            mckee_role=mckee_role,
            beat_contract=beat_contract,
        )

    async def _translate_one_field_to_zh(
        self, text: str, *, model_route: str
    ) -> str:
        """Best-effort rewrite of one English narrative string to Simplified Chinese."""
        if not text or not _needs_zh_rewrite(text):
            return text
        messages = [
            {
                "role": "system",
                "content": (
                    "You translate Breaking Bad roleplay lines into natural Simplified Chinese. "
                    "Keep character voice and pressure. Output ONLY the Chinese translation, "
                    "no quotes, no English. "
                    "Name glossary (mandatory): Mike→麦克 (never 米克), Walter→沃尔特, "
                    "Jesse→杰西, Skyler→斯凯勒, Saul→索尔, Gus→古斯, Hank→汉克, Marie→玛丽, "
                    "Todd→托德 (never 托霍), Jack Welker→杰克·维尔克 (never 杰克·托霍), "
                    "Tuco→图科, Gale→盖尔, Gomez→戈麦兹, Lydia→莉迪亚."
                ),
            },
            {"role": "user", "content": text},
        ]
        try:
            out = await self.provider.call_model(messages, model_route)
            cleaned = (out or "").strip().strip('"').strip("'")
            if cleaned:
                cleaned = normalize_zh_character_names(cleaned)
            if cleaned and not _needs_zh_rewrite(cleaned):
                return cleaned
            if cleaned:
                return cleaned
        except Exception:
            logger.exception("zh rewrite failed for single field")
        return text

    async def _rewrite_english_fields_to_zh(
        self,
        events: list[dict[str, Any]],
        *,
        language: str,
        model_route: str,
    ) -> list[dict[str, Any]]:
        """If planner leaked English under zh UI, batch-translate narrative fields."""
        if _norm_lang(language) != "zh" or not events:
            return events

        # Collect (evt_idx, field_path) needing rewrite
        jobs: list[tuple[int, str, str]] = []  # (event_index, field, text)
        for i, evt in enumerate(events):
            data = evt.get("data")
            if not isinstance(data, dict):
                continue
            et = evt.get("type")
            if et == "agent_think" and _needs_zh_rewrite(str(data.get("thought_content") or "")):
                jobs.append((i, "thought_content", str(data["thought_content"])))
            elif et == "agent_act" and _needs_zh_rewrite(str(data.get("action") or "")):
                jobs.append((i, "action", str(data["action"])))
            elif et == "agent_speak" and _needs_zh_rewrite(str(data.get("content") or "")):
                jobs.append((i, "content", str(data["content"])))
            elif et == "scene_change" and _needs_zh_rewrite(str(data.get("description") or "")):
                jobs.append((i, "description", str(data["description"])))
            elif et == "world_state_delta":
                deltas = data.get("deltas")
                if isinstance(deltas, list):
                    for j, d in enumerate(deltas):
                        if not isinstance(d, dict):
                            continue
                        for key in ("field", "old_value", "new_value"):
                            val = d.get(key)
                            if val is not None and _needs_zh_rewrite(str(val)):
                                jobs.append((i, f"deltas.{j}.{key}", str(val)))

        if not jobs:
            return normalize_zh_names_in_events(events)

        # Batch translate as JSON array for one LLM round-trip
        payload = [{"id": n, "text": t} for n, (_i, _f, t) in enumerate(jobs)]
        messages = [
            {
                "role": "system",
                "content": (
                    "Translate each item's text into natural Simplified Chinese for a "
                    "Breaking Bad interactive roleplay UI. Preserve meaning and tone. "
                    "Return ONLY a JSON array: [{\"id\":0,\"text\":\"中文\"}, ...]. "
                    "No markdown fences."
                ),
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        try:
            raw = await self.provider.call_model(messages, model_route)
            if not raw:
                return normalize_zh_names_in_events(events)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
                cleaned = re.sub(r"\s*```$", "", cleaned)
            translated = json.loads(cleaned)
            if not isinstance(translated, list):
                return normalize_zh_names_in_events(events)
            by_id = {
                int(item["id"]): str(item["text"])
                for item in translated
                if isinstance(item, dict) and "id" in item and "text" in item
            }
        except Exception:
            logger.exception("batch zh rewrite failed; leaving original English fields")
            return normalize_zh_names_in_events(events)

        # Apply
        out = [dict(e) for e in events]
        for n, (evt_idx, field, _orig) in enumerate(jobs):
            new_text = by_id.get(n)
            if not new_text:
                continue
            data = dict(out[evt_idx].get("data") or {})
            if field.startswith("deltas."):
                parts = field.split(".")
                # deltas.{j}.{key}
                try:
                    j = int(parts[1])
                    key = parts[2]
                    deltas = list(data.get("deltas") or [])
                    if 0 <= j < len(deltas) and isinstance(deltas[j], dict):
                        row = dict(deltas[j])
                        row[key] = new_text
                        deltas[j] = row
                        data["deltas"] = deltas
                except (ValueError, IndexError):
                    continue
            else:
                data[field] = new_text
            out[evt_idx] = {**out[evt_idx], "data": data}
        return out

    @staticmethod
    def _prepare_beat_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Trim noisy Director output into a playable beat.

        MiniMax can over-produce repeated dialogue turns when asked for a
        cinematic beat. We keep the first concrete action/thought/state
        events, drop duplicate scene changes (the server already emits one),
        cap rewritten dialogue calls, and remove empty dossier-style deltas
        like ``∅ -> ∅`` that add noise to the UI.
        """
        prepared: list[dict[str, Any]] = []
        speak_count = 0
        spoken_characters: set[str] = set()

        for evt in events:
            evt_type = evt.get("type")
            evt_data = evt.get("data")
            if not isinstance(evt_data, dict):
                evt_data = {}
                evt["data"] = evt_data

            if evt_type == "scene_change":
                continue

            if evt_type == "agent_speak":
                character_id = str(evt_data.get("character_id") or "")
                if speak_count >= MAX_AGENT_SPEAK_PER_BEAT:
                    continue
                if character_id and character_id in spoken_characters:
                    continue
                speak_count += 1
                if character_id:
                    spoken_characters.add(character_id)

            if evt_type == "world_state_delta":
                deltas = evt_data.get("deltas")
                if not isinstance(deltas, list):
                    continue
                concrete_deltas = [
                    delta for delta in deltas
                    if DirectorAgent._is_concrete_delta(delta)
                ]
                if not concrete_deltas:
                    continue
                evt_data = {**evt_data, "deltas": concrete_deltas}
                evt = {**evt, "data": evt_data}

            prepared.append(evt)

        return prepared

    @staticmethod
    def _is_concrete_delta(delta: Any) -> bool:
        if not isinstance(delta, dict):
            return False
        old_value = str(delta.get("old_value") or "").strip()
        new_value = str(delta.get("new_value") or "").strip()
        field = str(delta.get("field") or "").strip()
        target = str(delta.get("target") or "").strip()
        empty_values = {"", "∅", "none", "null", "n/a"}
        if old_value.lower() in empty_values and new_value.lower() in empty_values:
            return False
        return bool(field or target or old_value or new_value)

    async def _persist_beat_writes(
        self,
        session: Any,
        session_id: str,
        beat_index: int,
        speak_events: list[dict[str, Any]],
        beat_events_for_dossier: list[dict[str, Any]],
        scene_desc: str,
        beat_model_route: str,
    ) -> list[dict[str, Any]] | None:
        """Persist agent_speak Messages and update dossiers in one session.

        Returns the dossier deltas (None if update_dossiers failed).
        L5: Messages are committed BEFORE update_dossiers so a dossier
        failure rollback does not undo the already-committed dialogue —
        story history survives page refresh even when the dossier layer
        errors out.
        """
        from db.models import Message

        for evt_data in speak_events:
            session.add(
                Message(
                    session_id=session_id,
                    role="assistant",
                    content=evt_data.get("content", ""),
                    character_name=evt_data.get("character_id"),
                    emotion_state=evt_data.get("emotion_state"),
                    gif_search_query=evt_data.get("gif_search_query"),
                    beat_id=f"beat_{beat_index + 1}",
                )
            )
        # L5 fix: commit the agent_speak Messages BEFORE calling
        # update_dossiers. If update_dossiers fails below, session.rollback()
        # only undoes the dossier changes — the already-committed Messages
        # survive so dialogue does not "disappear" on page refresh after a
        # dossier failure.
        await session.commit()
        if not self.enable_dossier_updates:
            return []
        try:
            deltas = await update_dossiers(
                db=session,
                session_id=session_id,
                beat_summary=scene_desc,
                beat_events=beat_events_for_dossier,
                provider=self.provider,
                model_route=beat_model_route,
            )
            return deltas
        except Exception:
            logger.exception(
                "Dossier update failed for session %s", session_id
            )
            # Rollback partial dossier changes to prevent inconsistent state.
            await session.rollback()
            return None
    @staticmethod
    def _beat_ready_event(
        beat_index: int,
        summary: str,
        *,
        mckee_role: str | None = None,
        beat_contract: BeatContract | None = None,
    ) -> AgentEvent:
        data: dict[str, Any] = {
            "beat_id": f"beat_{beat_index + 1}",
            "beat_summary": summary,
        }
        if mckee_role:
            data["mckee_role"] = mckee_role
        if beat_contract is not None:
            # Authorial intent only — never player-facing craft dump.
            data["beat_contract"] = {
                "beat_id": beat_contract.beat_id,
                "dramatic_role": beat_contract.dramatic_role,
                "location_id": beat_contract.location_id,
                "present_characters": list(beat_contract.present_characters),
            }
        return AgentEvent(type="beat_ready", data=data)
    @staticmethod
    def _parse_beat_events(text: str) -> list[dict[str, Any]]:
        """Parse the LLM response as a JSON array of event objects.

        Delegates to agents.beat_json for balanced-bracket extraction,
        fence stripping, trailing-comma repair, and wrapper-object shapes.
        """
        return extract_beat_events(text)
    # ------------------------------------------------------------------
    # Chat-mode handlers (direct + crew)
    # ------------------------------------------------------------------
    async def handle_chat_message(
        self,
        character_id: str,
        user_message: str,
        context: dict[str, Any],
        session_factory: Any = None,
    ) -> dict[str, Any]:
        """
        Handle a single user message in chat mode.
        Args:
            character_id: Frontend character id (e.g. "walter", "jesse").
            user_message: The user's latest message text.
            context: Dict with keys: relation (str), history (list[dict]),
                     language (str), llmProvider (str), mode (str),
                     voiceExample (str|None).
        Returns:
            For direct mode:
              { reply_text, emotion_state, gif_search_query, thinking,
                tool_executed, tool_log, updated_relationship_state }
            For crew mode:
              { participants, scene_goal, tension_note, debate_logs }
        """
        mode = context.get("mode", "direct")
        if mode == "crew":
            return await self._handle_crew_chat(character_id, user_message, context, session_factory)
        return await self._handle_direct_chat(character_id, user_message, context, session_factory)
    async def _handle_direct_chat(
        self,
        character_id: str,
        user_message: str,
        context: dict[str, Any],
        session_factory: Any = None,
    ) -> dict[str, Any]:
        """Direct-mode: call the character agent with structured output."""
        backend_id = FRONTEND_TO_BACKEND_ID.get(character_id, "Walter White")
        character_cls = CHARACTER_AGENTS.get(backend_id)
        if character_cls is None:
            character_cls = CHARACTER_AGENTS["Walter White"]
        relation: str = context.get("relation", "partner")
        language: str = context.get("language", "en")
        target_language = "Simplified Chinese" if language == "zh" else "English"
        llm_provider: str = context.get("llmProvider", "stepfun")
        # Resolve model route
        scene_context = f"{backend_id} {relation} {user_message}".lower()
        model_route = self.provider.resolve_model_route(
            scene_context=scene_context,
            characters=list(CHARACTER_AGENTS.keys()),
        )
        # Override from frontend / BYOK selection (any catalog provider).
        model_route = self._route_for_provider(
            llm_provider,
            context.get("modelId"),
            fallback=model_route,
        )
        # Build context messages from history
        history: list[dict] = context.get("history", [])
        ctx_messages: list[dict] = []
        for turn in history:
            role = turn.get("sender", "user")
            if role == "user":
                ctx_messages.append({"role": "user", "content": turn.get("text", "")})
            else:
                ctx_messages.append({"role": "assistant", "content": turn.get("text", "")})
        voice_example: str | None = context.get("voiceExample")
        user_msg_with_context = (
            f"{user_message}\n\n"
            f"[Reply language: {target_language} only.]"
        )
        if voice_example:
            user_msg_with_context += (
                "\n\n[Reference speaking style: "
                "use this only for cadence and relationship pressure. "
                "Do not copy the reference language; translate the style into "
                f"{target_language}: {voice_example}]"
            )
        # Load dossier context from DB if available
        dossier_context = ""
        if session_factory is not None:
            try:
                async with session_factory() as sess:
                    from db.models import CharacterDossier
                    stmt = select(CharacterDossier).where(
                        CharacterDossier.session_id.is_(None),
                        CharacterDossier.subject_id == backend_id,
                    )
                    result = await sess.execute(stmt)
                    world_dossiers = result.scalars().all()
                    from agents.memory import format_dossier_context
                    dossier_context = format_dossier_context(
                        list(world_dossiers), backend_id,
                    )
            except Exception:
                logger.debug("Dossier load failed for direct chat %s", backend_id)
        # Instantiate character and call structured respond
        agent = character_cls(self.provider)
        result = await agent.respond_structured(
            context=ctx_messages,
            user_message=user_msg_with_context,
            model_route=model_route,
            dossier_context=dossier_context or None,
        )
        # Compute updated relationship state (lightweight — no DB round-trip
        # for chat mode; frontend holds the local state).
        updated_relationship_state = None
        return {
            "reply_text": result["reply_text"],
            "emotion_state": result["emotion_state"],
            "gif_search_query": result["gif_search_query"],
            "thinking": result["thinking"],
            "tool_executed": result["tool_executed"],
            "tool_log": result["tool_log"],
            "updated_relationship_state": updated_relationship_state,
        }
    async def _handle_crew_chat(
        self,
        character_id: str,
        user_message: str,
        context: dict[str, Any],
        session_factory: Any = None,
    ) -> dict[str, Any]:
        """Crew mode: generate a multi-character debate turn."""
        llm_provider: str = context.get("llmProvider", "stepfun")
        provider_prefix = "minimax" if llm_provider == "minimax" else "stepfun"
        participants_backend = crew_participants_from_message(character_id, user_message)
        backend_primary = participants_backend[0]
        participants_frontend = [
            BACKEND_TO_FRONTEND_ID.get(name, name.lower().split()[0])
            for name in participants_backend
        ]
        # Build the multi-turn prompt
        relation: str = context.get("relation", "partner")
        language: str = context.get("language", "en")
        target_language = "Simplified Chinese" if language == "zh" else "English"
        history: list[dict] = context.get("history", [])
        history_summary = ""
        if history:
            recent = history[-6:]
            lines = []
            for turn in recent:
                sender = turn.get("sender", "unknown")
                lines.append(f"{sender}: {turn.get('text', '')}")
            history_summary = "\n".join(lines)
        crew_prompt = (
            f"User message: {user_message}\n"
            f"Relation to primary character ({backend_primary}): {relation}\n"
            f"Reply language: {target_language} only.\n\n"
        )
        if history_summary:
            crew_prompt += f"Recent conversation:\n{history_summary}\n\n"
        crew_prompt += (
            f"Generate a dialogue turn for each of these characters: "
            f"{', '.join(participants_backend)}. "
            f"Emit the JSON array as specified."
        )
        # Inject per-character voice guides so each character in the crew
        # retains their distinct voice (Loop 7 fix). Also attach a Continuity
        # Board slice per speaker so each mouth only "knows" its known_by facts.
        from agents.continuity_board import (
            filter_board_for_character,
            format_board_prompt,
            load_or_init_session_board,
        )
        crew_session_id = str(context.get("sessionId") or context.get("session_id") or "")
        try:
            continuity_board = await load_or_init_session_board(
                session_factory,
                crew_session_id,
            )
        except Exception:
            logger.debug("Crew continuity board load failed")
            continuity_board = None
        character_voice_guides: list[str] = []
        for backend_name in participants_backend:
            char_cls = CHARACTER_AGENTS.get(backend_name)
            if char_cls is not None:
                try:
                    char_agent = char_cls(self.provider)
                    block = (
                        f"CHARACTER VOICE: {backend_name}\n"
                        f"{char_agent.system_prompt()}"
                    )
                    if continuity_board is not None:
                        try:
                            view = filter_board_for_character(
                                continuity_board, backend_name
                            )
                            board_block = format_board_prompt(
                                view, character_id=backend_name
                            )
                            block = f"{block}\n\n{board_block}"
                        except Exception:
                            logger.debug(
                                "Crew board inject failed for %s", backend_name
                            )
                    character_voice_guides.append(block)
                except Exception:
                    logger.debug("Failed to load system prompt for %s", backend_name)
        voice_guide_block = ""
        if character_voice_guides:
            voice_guide_block = (
                "\n\nCHARACTER VOICE GUIDES - follow each character's voice "
                "exactly when writing their dialogue.\n"
                "KNOWLEDGE RIGHTS: when writing a character's line, use ONLY the "
                "CONTINUITY BOARD facts listed under that character. Do not let "
                "one character speak another character's private board facts.\n\n"
                + "\n\n---\n\n".join(character_voice_guides)
            )
        system_content = CREW_CHAT_SYSTEM_PROMPT + voice_guide_block
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": crew_prompt},
        ]
        # Use the primary character's preferred model route
        primary_context = f"{backend_primary} {user_message}".lower()
        model_route = self.provider.resolve_model_route(
            scene_context=primary_context,
            characters=participants_backend,
        )
        model_route = self._route_for_provider(
            provider_prefix,
            context.get("modelId"),
            fallback=model_route,
        )
        try:
            raw = await self.provider.call_model(messages, model_route)
        except Exception as exc:
            # Fallback: generate minimal debate logs
            fallback_reply = json.dumps([{
                "character_id": backend_primary,
                "content": f"[Model error — fallback response: {exc}]",
                "emotion_state": "calm",
                "gif_search_query": f"{backend_primary.lower()} calm",
                "thinking": None,
                "tool_executed": None,
                "tool_log": None,
            }])
            raw = fallback_reply
        # Parse the debate logs
        debate_logs = self._parse_crew_debate_logs(raw, participants_backend)
        # Map back to frontend IDs
        for log in debate_logs:
            char_id = log.pop("character_id", log.get("sender", "walter"))
            log["sender"] = BACKEND_TO_FRONTEND_ID.get(char_id, char_id.lower().split()[0])
        return {
            "participants": participants_frontend,
            "scene_goal": f"Crew debate: {user_message[:80]}",
            "tension_note": f"{', '.join(participants_frontend)} debating.",
            "debate_logs": debate_logs,
        }
    @staticmethod
    def _parse_crew_debate_logs(
        raw: str,
        participants: list[str],
    ) -> list[dict[str, Any]]:
        """Parse the LLM crew-debate JSON array into frontend-ready log entries."""
        trimmed = raw.strip()
        # Try fenced JSON first
        fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", trimmed, re.DOTALL)
        raw_json = fenced.group(1) if fenced else trimmed
        start = raw_json.find("[")
        end = raw_json.rfind("]")
        if start < 0 or end <= start:
            return []
        try:
            entries = json.loads(raw_json[start : end + 1])
        except (json.JSONDecodeError, TypeError):
            return []
        logs: list[dict[str, Any]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            char_id = entry.get("character_id", "")
            if char_id not in participants:
                continue
            logs.append({
                "sender": char_id,  # mapped to frontend id by caller
                "text": sanitize_speak_content(entry.get("content", "")),
                "emotion": entry.get("emotion_state"),
                "gifQuery": entry.get("gif_search_query"),
                "thinking": entry.get("thinking"),
                "tool_executed": entry.get("tool_executed"),
                "tool_log": entry.get("tool_log"),
            })
        return logs
