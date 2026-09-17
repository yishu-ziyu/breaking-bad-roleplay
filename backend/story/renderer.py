"""Prepare a Story turn, then commit it before any public yield."""

from __future__ import annotations

import json
from typing import AsyncIterator

from pydantic import ValidationError

from agents.beat_json import parse_model_object
from agents.continuity_board import normalize_character_id
from agents.speak_sanitize import sanitize_speak_content
from models.schemas import AgentEvent
from scenes.state_reducer import board_from_world
from scenes.world_state import (
    ActionIntent,
    Resolution,
    compact_world_state,
    opening_scene_text,
    resolve_action,
    resolution_text,
)
from story.service import TurnClaim, commit_turn, release_turn


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
                "from_scene": world.location, "to_scene": world.location,
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
                    "only present non-player characters can speak. NPC stage actions must be "
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
            events = []
            async for event in director._generate_beat(
                task=task + world_note, outline=outline, beat_index=index,
                context=context, scene_desc=scenes[index], active_character_id=None,
                voice_example=voice_example, language=language, zh_guard=zh_guard,
            ):
                if event.type == "error":
                    raise RuntimeError("character_turn_rejected")
                if event.type == "scene_change":
                    # Director narration is still an untrusted proposal. A
                    # pretty sentence must not make a repair, arrival or item
                    # transfer true. Runtime v1 publishes deterministic world
                    # prose below until a semantic narration validator exists.
                    continue
                cid = normalize_character_id(str(event.data.get("character_id") or ""))
                if cid == world.player_id:
                    continue
                if cid and world.scenario_id == "desert_crisis" and cid not in world.present:
                    continue
                if event.type == "agent_speak" or (
                    event.type == "agent_act" and event.data.get("source") == "character_policy"
                ):
                    events.append(event)
            if not any(event.type == "agent_speak" for event in events) and any(
                actor != world.player_id for actor in world.present
            ):
                raise RuntimeError("no_accepted_character_turn")
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
                    "from_scene": world.location,
                    "to_scene": world.location,
                    "description": opening_scene_text(world, language),
                }))
            else:
                prefix.append(AgentEvent(type="scene_change", data={
                    "from_scene": claim.world.location, "to_scene": world.location,
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
