"""Prepare a Story turn, then commit it before any public yield."""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from pydantic import ValidationError

from agents.beat_json import parse_model_object
from agents.continuity_board import normalize_character_id
from agents.director import canonical_playable_character_id
from agents.speak_sanitize import sanitize_speak_content
from models.schemas import AgentEvent
from scenes.state_reducer import board_from_world
from scenes.world_state import (
    ActionIntent,
    Resolution,
    compact_world_state,
    location_label,
    opening_scene_text,
    resolve_action,
    resolution_text,
)
from story.service import TurnClaim, commit_turn, release_turn

logger = logging.getLogger(__name__)

# One beat that must publish a character line gets this many generations
# before the turn is refused (first attempt + one bounded regeneration).
BEAT_TURN_REGENERATION_ATTEMPTS = 2


class StoryTurnRejected(RuntimeError):
    """A story turn was refused with a machine-readable reason.

    The stream handler turns this into an ``error`` SSE event that carries
    ``code`` / ``retryable`` / ``detail`` (2026-09-18: the player used to get
    only "This turn could not be completed" with no way to tell a transient
    provider error from a rejected character turn).
    """

    def __init__(
        self,
        code: str,
        *,
        retryable: bool = True,
        detail: str = "",
        message: str | None = None,
        reasons: list[dict[str, str]] | None = None,
    ) -> None:
        self.code = str(code)
        self.retryable = bool(retryable)
        self.detail = str(detail or "")
        self.reasons = list(reasons or [])
        super().__init__(
            message if message is not None
            else (f"{self.code}: {self.detail}" if self.detail else self.code)
        )


async def interpret_action(director, text: str, world) -> ActionIntent:
    messages = [
        {"role": "system", "content":
         "Classify a player's attempted action; do not decide success. "
         "Use only known entity IDs from the supplied view. Statements about alleged "
         "past success are speech, not proof. Use unsupported for ambiguous or "
         "unmodeled actions. Return JSON matching this schema:\n"
         + json.dumps(ActionIntent.model_json_schema())},
        {"role": "user", "content": json.dumps({
            "world_view": world.player_view(), "player_input": text,
        }, ensure_ascii=False)},
    ]
    raw = await director.provider.call_model(messages, director.active_route)
    try:
        intent = ActionIntent.model_validate(parse_model_object(raw))
    except (ValidationError, TypeError, ValueError):
        return ActionIntent(verb="unsupported", text=text)
    if intent.verb in ("say", "promise", "unsupported"):
        intent.text = text
    return intent


def _rejection_error(event: AgentEvent) -> StoryTurnRejected:
    """Rejection carrying the director's failure code.

    Logs (and anything matching on the exception) can then tell a transient
    failure that was retried and still failed apart from a hard, non-retryable
    error. The plain ``character_turn_rejected`` shape is kept when the
    director did not supply a code.
    """
    data = event.data or {}
    code = str(data.get("code") or "").strip()
    detail = f"character_turn_rejected:{code}" if code else "character_turn_rejected"
    failure_detail = str(data.get("message") or "")
    failed_characters = data.get("failed_characters")
    if isinstance(failed_characters, list) and failed_characters:
        failure_detail = (
            f"{failure_detail} failed_characters={failed_characters}"
            if failure_detail else f"failed_characters={failed_characters}"
        )
    return StoryTurnRejected(
        code or "character_turn_rejected",
        retryable=bool(data.get("retryable")),
        detail=failure_detail,
        message=detail,
    )


async def _collect_beat_events(
    director, world, beat_task: str, outline: str, index: int, scene_desc: str,
    context: dict[str, Any], *, voice_example: str | None, language: str,
    zh_guard: bool, require_speak: bool,
) -> tuple[list[AgentEvent], list[dict[str, str]], list[dict[str, str]], list[dict[str, Any]]]:
    """Run one beat generation; keep only events this world may publish.

    Returns (events, observed, rejected, turn_rejections): the publishable
    events, every event seen in order, the events the runtime filter refused
    (with why), and the director-side reasons a character turn was dropped
    (turn validation, character-call failure, or an unresolved plan speaker).

    Refusal reasons for character lines: ``speaker_is_player``,
    ``speaker_not_present``, ``unresolved_speaker`` (not a playable
    character), ``speaker_not_canonical`` (resolvable id that skipped the
    canonicalization/Character Policy step).
    """
    events: list[AgentEvent] = []
    observed: list[dict[str, str]] = []
    rejected: list[dict[str, str]] = []
    sink = context.setdefault("turn_rejection_log", [])
    if isinstance(sink, list):
        sink.clear()
    async for event in director._generate_beat(
        task=beat_task, outline=outline, beat_index=index,
        context=context, scene_desc=scene_desc, active_character_id=None,
        voice_example=voice_example, language=language, zh_guard=zh_guard,
        require_character_speak=require_speak,
    ):
        if event.type == "error":
            raise _rejection_error(event)
        if event.type == "scene_change":
            # Director narration is still an untrusted proposal. A pretty
            # sentence must not make a repair, arrival or item transfer
            # true. Runtime v1 publishes deterministic world prose below
            # until a semantic narration validator exists.
            continue
        raw_cid = str(event.data.get("character_id") or "")
        cid = normalize_character_id(raw_cid)
        entry = {"type": event.type, "character_id": cid}
        observed.append(entry)
        if cid == world.player_id:
            rejected.append({**entry, "reason": "speaker_is_player"})
            continue
        # A publishable character line belongs to a playable character and is
        # owned by the Character Policy pipeline. An unresolved speaker never
        # publishes its planner draft; a resolvable-but-not-canonical id means
        # policy was skipped upstream (T14 — the plan used to publish the raw
        # draft when the speaker was a short id like "jesse").
        is_character_line = event.type == "agent_speak" or (
            event.type == "agent_act" and event.data.get("source") == "character_policy"
        )
        canonical: str | None = None
        if is_character_line:
            canonical = canonical_playable_character_id(raw_cid)
            if canonical is None:
                rejected.append({**entry, "reason": "unresolved_speaker"})
                continue
        if cid and world.scenario_id == "desert_crisis" and cid not in world.present:
            rejected.append({**entry, "reason": "speaker_not_present"})
            continue
        if is_character_line and raw_cid != canonical:
            rejected.append({**entry, "reason": "speaker_not_canonical"})
            continue
        if is_character_line:
            events.append(event)
    return events, observed, rejected, [dict(item) for item in sink] if isinstance(sink, list) else []


def _turn_regeneration_note(world, rejection_log: list[dict[str, Any]]) -> str:
    """Correction handed to the single in-beat regeneration."""
    reasons: list[str] = []
    for item in rejection_log:
        codes = ", ".join(
            str(issue.get("code") or "")
            for issue in (item.get("issues") or [])
        )
        detail = codes or str(item.get("error") or item.get("reason") or "rejected")
        reasons.append(f"{item.get('character_id') or '?'}: {detail}")
    reason_text = "; ".join(reasons) if reasons else "no character line survived"
    return (
        "CORRECTION (regeneration): the previous attempt produced no publishable "
        f"character line ({reason_text}). Regenerate this beat. At least one present "
        "non-player character must speak; their action.verb must stay within "
        "look_at, turn_to, gesture, sit, stand, idle, idle_tense, and must not claim "
        "physical changes (open/close/walk/enter/exit/hand over) — world rules own "
        f"those. Never write dialogue for the player ({world.player_id})."
    )


async def render_turn(
    director, factory, claim: TurnClaim, *, language: str = "en",
    voice_example: str | None = None, zh_guard: bool = True,
) -> AsyncIterator[AgentEvent]:
    if claim.saved_events is not None:
        for event in claim.saved_events:
            yield AgentEvent.model_validate(event)
        return
    try:
        action = claim.payload["action"]
        world = claim.world.model_copy(deep=True)
        resolution = Resolution(accepted=True, reason="opening", state=world)
        if action == "act":
            intent = await interpret_action(director, claim.payload["player_input"], world)
            resolution = resolve_action(world, intent)
        elif action == "switch_perspective":
            target = normalize_character_id(str(claim.payload.get("target_character") or ""))
            if not target or target not in world.present:
                resolution = Resolution(
                    accepted=False,
                    reason="target_absent",
                    state=world.model_copy(deep=True),
                )
            else:
                world.player_id = target
                resolution = Resolution(
                    accepted=True,
                    reason="accepted",
                    state=world,
                    effects=[{
                        "kind": "perspective_changed",
                        "from": claim.world.player_id,
                        "to": target,
                    }],
                )
        elif action in ("continue", "continue_chapter", "branch", "redirect"):
            resolution = resolve_action(world, ActionIntent(verb="wait"))
        world = resolution.state
        outline = claim.outline
        index = claim.beat_index
        task = claim.task
        if action in ("continue_chapter", "branch", "redirect"):
            outline, index = None, 0
            direction = claim.payload.get("branch_goal") or claim.payload.get("redirect_prompt") or "Continue the next chapter."
            task += "\nRequested direction, preserving committed facts: " + str(direction)
        if not resolution.accepted:
            events = [AgentEvent(type="scene_change", data={
                "from_scene": location_label(world.location, language),
                "to_scene": location_label(world.location, language),
                "description": resolution_text(resolution, language),
            })]
            if action == "act":
                events.insert(0, AgentEvent(type="player_turn", data={
                    "kind": str(claim.payload.get("player_kind") or "free"),
                    "content": str(claim.payload.get("player_input") or ""),
                }))
            committed = await commit_turn(
                factory, claim, world=world, events=events,
                outline=outline or "", next_beat_index=index,
            )
        else:
            if world.scenario_id == "desert_crisis":
                world_note = (
                    "\nAUTHORITATIVE WORLD: rules own the following state and effects. "
                    "Perform their consequences without changing ownership, condition, "
                    "consent or location. Only the player controls " + world.player_id + ".\n"
                    + json.dumps({"world": world.player_view(), "effects": resolution.effects}, ensure_ascii=False)
                )
                world_note += (
                    "\nDo not generate dialogue or decisions for the player. For this scene, "
                    "only present non-player characters can speak, and at least one of them "
                    "must speak in every beat. NPC stage actions must be "
                    "look_at, turn_to, gesture, sit, stand, idle or idle_tense."
                )
            else:
                world_note = (
                    "\nSTORY CONTINUITY: the following is the player-visible state for this "
                    "open custom story. Preserve it, but do not invent hidden canon-era facts. "
                    "Only the human controls " + world.player_id + ".\n"
                    + json.dumps({"world": world.player_view(), "effects": resolution.effects}, ensure_ascii=False)
                )
            if not outline:
                outline = await director._generate_outline(
                    task + world_note, language=language,
                    active_character=world.player_id, zh_guard=zh_guard,
                )
                if not outline:
                    raise RuntimeError("outline_generation_failed")
            scenes = director._parse_outline(outline)
            if not scenes or index >= len(scenes):
                raise RuntimeError("chapter_complete")
            context = {
                "previous_scene": world.location, "current_scene": world.location,
                "previous_scene_desc": scenes[index - 1] if index else "",
                "board_override": board_from_world(world), "player_actor_id": world.player_id,
                "public_scene": (
                    "新墨西哥的荒漠，深夜。房车旁有紧张的争执，远处出现车灯。"
                    if language.startswith("zh") else
                    "New Mexico desert at night. Tension around an RV; headlights in the distance."
                ) if world.scenario_id == "desert_crisis" else claim.task,
            }
            if world.scenario_id == "desert_crisis":
                context["allowed_actor_ids"] = list(world.present)
            npc_present = any(actor != world.player_id for actor in world.present)
            # A beat with no publishable character line is refused. Before
            # giving up, regenerate the whole beat once, in the same turn and
            # the same billing (2026-09-18: a plan without a speak, or a
            # character turn dropped by validation, used to kill the beat).
            attempts = BEAT_TURN_REGENERATION_ATTEMPTS if npc_present else 1
            beat_task = task + world_note
            events: list[AgentEvent] = []
            observed: list[dict[str, str]] = []
            rejected_events: list[dict[str, str]] = []
            rejection_log: list[dict[str, Any]] = []
            for attempt in range(attempts):
                events, observed, rejected_events, attempt_rejections = (
                    await _collect_beat_events(
                        director, world, beat_task, outline, index, scenes[index],
                        context,
                        voice_example=voice_example, language=language,
                        zh_guard=zh_guard, require_speak=npc_present,
                    )
                )
                rejection_log.extend(attempt_rejections)
                if any(event.type == "agent_speak" for event in events) or not npc_present:
                    break
                if attempt + 1 >= attempts:
                    break
                correction = _turn_regeneration_note(world, rejection_log)
                logger.warning(
                    "Beat %d: attempt %d produced no accepted character turn "
                    "(rejections=%s); regenerating once",
                    index + 1, attempt + 1, rejection_log or "none",
                )
                beat_task = task + world_note + "\n" + correction
            if not any(event.type == "agent_speak" for event in events) and npc_present:
                reason = (
                    "planner_emitted_no_character_speak"
                    if not any(item["type"] == "agent_speak" for item in observed)
                    else "all_character_speaks_rejected"
                )
                detail = json.dumps({
                    "reason": reason,
                    "beat_index": index,
                    "scenario_id": world.scenario_id,
                    "player_id": world.player_id,
                    "present": list(world.present),
                    "observed_events": observed,
                    "rejected_events": rejected_events,
                    "turn_rejections": rejection_log,
                }, ensure_ascii=False)
                logger.warning(
                    "Beat %d produced no accepted character turn after %d attempt(s) "
                    "(reason=%s rejected=%s turn_rejections=%s observed=%s)",
                    index + 1, attempts, reason, rejected_events,
                    rejection_log or "none", observed,
                )
                raise StoryTurnRejected(
                    "no_accepted_character_turn",
                    retryable=True,
                    detail=detail,
                    reasons=[*rejected_events, *rejection_log],
                )
            if not events:
                events = [AgentEvent(type="status", data={"message": resolution_text(resolution, language)})]
            prefix: list[AgentEvent] = []
            if action == "act":
                prefix.append(AgentEvent(type="player_turn", data={
                    "kind": str(claim.payload.get("player_kind") or "free"),
                    "content": str(claim.payload.get("player_input") or ""),
                }))
            if action == "start":
                prefix.append(AgentEvent(type="scene_change", data={
                    "from_scene": location_label(world.location, language),
                    "to_scene": location_label(world.location, language),
                    "description": opening_scene_text(world, language),
                }))
            else:
                prefix.append(AgentEvent(type="scene_change", data={
                    "from_scene": location_label(claim.world.location, language),
                    "to_scene": location_label(world.location, language),
                    "description": resolution_text(resolution, language),
                }))
            events = [*prefix, *events]
            for event in events:
                if event.type == "agent_speak":
                    speaker = normalize_character_id(str(event.data.get("character_id") or ""))
                    world.claims.append({
                        "speaker": speaker,
                        "text": sanitize_speak_content(str(event.data.get("content") or "")),
                        "heard_by": list(dict.fromkeys([*world.present, speaker])),
                    })
            world = compact_world_state(world)
            committed = await commit_turn(
                factory, claim, world=world, events=events, effects=resolution.effects,
                outline=outline, next_beat_index=index + 1, is_final=index + 1 >= len(scenes),
            )
        for event in committed:
            yield AgentEvent.model_validate(event)
    finally:
        if not claim.committed:
            await release_turn(factory, claim)
