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
)
from models.schemas import AgentEvent
from agents.memory import update_dossiers

logger = logging.getLogger(__name__)
DEFAULT_DIRECTOR_MODEL_ROUTE = "stepfun/step-2-16k"
MAX_AGENT_SPEAK_PER_BEAT = 2
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
}
BACKEND_TO_FRONTEND_ID: dict[str, str] = {v: k for k, v in FRONTEND_TO_BACKEND_ID.items()}
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
    "character_id": "Walter White" | "Jesse Pinkman" | "Skyler White" | "Saul Goodman" | "Mike Ehrmantraut" | "Gus Fring",
    "content": "<spoken dialogue — in character, 2-6 sentences>",
    "emotion_state": "<calm|tense|angry|fearful|manipulative|guilty|resigned|desperate>",
    "gif_search_query": "<English visual emotion search phrase>",
    "thinking": "<1-3 sentence inner monologue>",
    "tool_executed": "<fictional tool name or null>",
    "tool_log": "<tool result or null>"
  }
]
RULES:
- Each object is one character's full response (dialogue + metadata).
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
Mike Ehrmantraut, Gus Fring.
Your job is NOT to write prose.  Your job is to orchestrate character agents
and emit structured events for the client.  For every narrative beat you must:
BEAT PLANNING
1. Decide which characters are present and what each one does.
2. Decide if the location changes (emit a scene_change event).
3. Decide what emotional beat this moment carries.
4. Choose the model for this scene (always "stepfun/step-2-16k").
THINKING
- Have characters think before they act — emit agent_think events to reveal
  their inner conflict and motivation.  Breaking Bad tension lives in what
  characters hide.
SPEAKING
- Emit agent_speak events with the character's actual dialogue.
- Include the character's current emotion_state and a gif_search_query that
  captures their emotional state visually (e.g. "walter white angry determined",
  "jesse pinkman scared nervous").
ACTING
- Emit agent_act events for physical actions: entering, leaving, handing over
  an object, cooking, driving, etc.
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
set to "stepfun/step-2-16k".
Example output:
[
  { "type": "scene_change", "data": { "from_scene": "RV in the desert", "to_scene": "White family kitchen", "description": "Cut from the cook to Walt at home" }, "recommended_model": "stepfun/step-2-16k" },
  { "type": "agent_act", "data": { "character_id": "Walter White", "action": "sits down at the table", "target": null }, "recommended_model": "stepfun/step-2-16k" },
  { "type": "agent_think", "data": { "character_id": "Walter White", "thought_content": "If Skyler finds out about the lab, I lose everything." }, "recommended_model": "stepfun/step-2-16k" },
  { "type": "agent_speak", "data": { "character_id": "Walter White", "content": "I need to tell you something.", "emotion_state": "tense", "gif_search_query": "walter white nervous serious" }, "recommended_model": "stepfun/step-2-16k" },
  { "type": "world_state_delta", "data": { "deltas": [ { "target": "Walter White", "field": "emotional_state", "old_value": "composed", "new_value": "anxious" } ] }, "recommended_model": "stepfun/step-2-16k" }
]
RULES:
- Always emit at least one agent_think or agent_speak per character per beat.
- Emotion states: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- GIF queries must be in English and specific enough to find relevant images.
- scene_change is only emitted when the narrative location actually shifts.
- world_state_delta must always appear as the last event in a beat.
- character_id must be exactly "Walter White", "Jesse Pinkman", "Skyler White",
  "Saul Goodman", "Mike Ehrmantraut", or "Gus Fring" — no variations.
- recommended_model must be "stepfun/step-2-16k" on every event.
"""
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
}
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
    ):
        self.provider = provider
        self.model_route = model_route
        self.system_prompt = system_prompt
    async def process(
        self,
        task: str,
        session_factory: Any = None,
        session_id: str | None = None,
        action_queue: Any = None,
        db: Any = None,
        voice_example: str | None = None,
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
            type="status", data={"message": "Director is analysing the task…"}
        )
        # ---- Step 1: generate the outline -----------------------------------
        outline_text = await self._generate_outline(task)
        if outline_text is None:
            yield AgentEvent(
                type="error",
                data={"message": "Outline generation failed — could not reach the model."},
            )
            return
        yield AgentEvent(type="outline", data={"content": outline_text})
        scenes = self._parse_outline(outline_text)
        yield AgentEvent(
            type="status",
            data={
                "message": f"Director outlined {len(scenes)} beat(s). Beginning roleplay…"
            },
        )
        # ---- Step 2: render each beat (beat-by-beat with pause) ----------
        previous_scene = ""
        idx = 0
        active_character_id: str | None = None  # backend full-name form, e.g. "Jesse Pinkman"
        while idx < len(scenes):
            scene_desc = scenes[idx]
            current_scene = self._short_scene_name(scene_desc)
            async for event in self._generate_beat(
                task=task,
                outline=outline_text,
                beat_index=idx,
                context={"previous_scene": previous_scene, "current_scene": current_scene},
                scene_desc=scene_desc,
                db=db,
                session_factory=session_factory,
                session_id=session_id,
                active_character_id=active_character_id,
                voice_example=voice_example,
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
                        new_outline = await self._generate_outline(task)
                        if new_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Redirect applied but outline regeneration failed — continuing with current outline."},
                            )
                        else:
                            outline_text = new_outline
                            scenes = self._parse_outline(outline_text)
                            yield AgentEvent(type="outline", data={"content": outline_text})
                            idx = 0
                            previous_scene = ""
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
                        # Map frontend short id -> backend full name (F3 fix).
                        if target_raw:
                            active_character_id = FRONTEND_TO_BACKEND_ID.get(
                                target_raw, target_raw
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
                        )
                        if next_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Chapter continuation failed — keeping current outline."},
                            )
                        else:
                            next_scenes = self._parse_outline(next_outline)
                            yield AgentEvent(
                                type="outline",
                                data={
                                    "content": next_outline,
                                    "appended": True,
                                    "chapter": 2,
                                },
                            )
                            scenes = scenes + next_scenes
                            # Re-enter the beat loop starting at the first
                            # newly appended scene so the next iteration
                            # renders beat 1 of chapter 2 (not the next
                            # unrendered beat of chapter 1).
                            idx = len(scenes) - len(next_scenes) - 1
                            previous_scene = current_scene
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
                        )
                        if branch_outline is None:
                            yield AgentEvent(
                                type="status",
                                data={"message": "Branch generation failed — keeping current outline."},
                            )
                        else:
                            branch_scenes = self._parse_outline(branch_outline)
                            yield AgentEvent(
                                type="outline",
                                data={
                                    "content": branch_outline,
                                    "branched": True,
                                    "from_beat_id": from_beat_id,
                                },
                            )
                            # Keep scenes[0..beat_idx] (inclusive) from the
                            # original outline, then append the freshly
                            # generated scenes. The next iteration of the
                            # loop will re-render scenes[beat_idx] with new
                            # body content but same beat position.
                            prefix = scenes[: beat_idx + 1]
                            scenes = prefix + branch_scenes
                            previous_scene = ""
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
                        idx = max(0, replay_idx - 1)
                        continue  # skip trailing idx+=1 / previous_scene overwrite
                    # "continue": fall through to next beat
                except asyncio.TimeoutError:
                    yield AgentEvent(
                        type="status",
                        data={"message": "No action received — continuing automatically."},
                    )
            idx += 1
            previous_scene = current_scene
        yield AgentEvent(
            type="complete",
            data={"message": "All beats rendered. Roleplay outline complete."},
        )
    # ------------------------------------------------------------------
    # Outline generation
    # ------------------------------------------------------------------
    async def _generate_outline(self, task: str) -> str | None:
        """Call the LLM to produce a numbered Breaking Bad scene outline."""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": (
                    f"Task: {task}\n\n"
                    "IMPORTANT: Output a PLAIN TEXT numbered list of scenes. "
                    "Do NOT output JSON, code fences, or any structured format. "
                    "Each line should start with a number like '1. Scene title — description'. "
                    "Example:\n"
                    "1. RV in the desert — Walt and Jesse cook meth\n"
                    "2. White family kitchen — Skyler confronts Walt\n"
                    "3. DEA office — Hank finds a new lead"
                ),
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
        """Extract the short scene name from a full scene description.
        Handles both em-dash (U+2014) and en-dash (U+2013) separators."""
        name = re.split(r"[–—]", scene_desc)[0]
        return name.split(":")[0].strip()

    async def _generate_outline_followup(
        self,
        base_task: str,
        prior_outline: str,
        existing_scenes: list[str],
        branch_goal: str | None = None,
    ) -> str | None:
        """Generate the next chapter's outline as a continuation.

        Returns a numbered plain-text outline (same format as
        ``_generate_outline``). Scenes from this outline are concatenated
        onto the existing list — beats are never re-numbered.
        """
        goal_suffix = f"\nNew chapter focus: {branch_goal}" if branch_goal else ""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": (
                    f"Original task: {base_task}\n\n"
                    f"Existing outline (chapter 1):\n{prior_outline}\n\n"
                    f"Existing beats so far:\n"
                    + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(existing_scenes))
                    + f"\n\nGenerate a NEW chapter (chapter 2) that continues "
                    f"directly from where chapter 1 ends.{goal_suffix}\n"
                    "IMPORTANT: Output a PLAIN TEXT numbered list of scenes. "
                    "Do NOT output JSON, code fences, or any structured format. "
                    "Each line should start with a number like '1. Scene title — description'. "
                    "Numbering should restart at 1 for the new chapter."
                ),
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
    ) -> str | None:
        """Generate a new outline for everything AFTER the branch beat.

        The Director keeps ``scenes[: branch_beat_index + 1]`` and replaces
        the rest with the LLM's output. Output is a plain-text numbered
        list (continuing the prior outline's tone, not duplicating beats).
        """
        prior_beat = scenes[branch_beat_index] if 0 <= branch_beat_index < len(scenes) else ""
        goal_suffix = f"\nBranching focus: {branch_goal}" if branch_goal else ""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": (
                    f"Original task: {base_task}\n\n"
                    f"Existing outline:\n{prior_outline}\n\n"
                    f"Branching from beat {branch_beat_index + 1}: {prior_beat}\n"
                    f"Everything before beat {branch_beat_index + 1} is preserved. "
                    f"Generate ONLY the beats that follow.{goal_suffix}\n"
                    "IMPORTANT: Output a PLAIN TEXT numbered list of scenes. "
                    "Do NOT output JSON, code fences, or any structured format. "
                    "Each line should start with a number like '1. Scene title — description'."
                ),
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
    def _parse_outline(text: str) -> list[str]:
        """Parse an LLM-generated outline into a list of scene descriptions.
        Handles both plain-text numbered lists and JSON arrays (B1 fallback).
        """
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
                current.append(stripped_line)
        if current:
            scenes.append(" ".join(current).strip())
        return scenes if scenes else [text.strip()]
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
        current_scene = self._short_scene_name(scene_desc)
        previous_scene = context.get("previous_scene", "")
        characters_in_scene: list[str] = list(CHARACTER_AGENTS.keys())
        # Emit scene transition if location changed
        if current_scene and current_scene != previous_scene:
            yield AgentEvent(
                type="scene_change",
                data={
                    "from_scene": previous_scene or "unknown",
                    "to_scene": current_scene,
                    "description": f"Transitioning to: {scene_desc}",
                },
            )
        # Ask Director LLM to plan this beat's events
        beat_prompt = (
            f"Task: {task}\n\n"
            f"Outline:\n{outline}\n\n"
            f"Current scene (beat {beat_index + 1}): {scene_desc}\n\n"
        )
        if active_character_id:
            beat_prompt += (
                f"Active perspective character: {active_character_id}\n"
                f"IMPORTANT: The FIRST agent_speak event in this beat MUST have "
                f"character_id exactly equal to \"{active_character_id}\". "
                f"Other characters may speak afterwards, but the opening voice must be "
                f"{active_character_id}.\n\n"
            )
        beat_prompt += (
            "Generate the events for this beat as a JSON array. "
            "Keep the beat concise: include at most two agent_speak events total. "
            "Include only one scene_change if needed. Include brief agent_act and agent_think events. "
            "End with one world_state_delta containing only concrete changed facts. "
            "Every event object must include a 'recommended_model' field set to "
            f"'{self.model_route}'."
        )
        messages = [
            {"role": "system", "content": self._system_prompt_with_voice_example(voice_example)},
            {"role": "user", "content": beat_prompt},
        ]
        try:
            llm_response = await self.provider.call_model(messages, self.model_route)
        except Exception as exc:
            logger.exception("Beat %d LLM call failed", beat_index + 1)
            yield AgentEvent(
                type="error",
                data={"message": f"Beat {beat_index + 1} LLM call failed"},
            )
            yield self._beat_ready_event(beat_index, f"Beat {beat_index + 1} failed.")
            return
        # Parse the LLM response as event array
        events = self._parse_beat_events(llm_response)
        if not events:
            yield AgentEvent(
                type="error",
                data={"message": f"Beat {beat_index + 1}: could not parse events from LLM."},
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
        # Process each event — substitute real character responses for agent_speak
        beat_events_for_dossier: list[dict[str, Any]] = []
        # agent_speak event payloads collected during the loop; persisted
        # after the loop in a single short-lived DB session (Cycle 45 / H1).
        speak_events_to_persist: list[dict[str, Any]] = []
        for evt in events:
            evt_type = evt.get("type", "")
            evt_data = evt.get("data", {})
            if evt_type == "agent_speak":
                # Call the actual character agent for authentic dialogue.
                # Cycle 37 (Additional #2): use respond_structured so the
                # sub-agent returns emotion_state and gif_search_query
                # alongside the rewritten content from the SAME LLM call
                # (no extra token cost). This keeps the three fields in
                # sync — the UI shows emotion and GIF that match the final
                # displayed text, not the Director's original draft. If
                # the sub-agent response lacks structured metadata (plain
                # text fallback), keep the Director-provided values.
                character_id = evt_data.get("character_id", "")
                character_cls = CHARACTER_AGENTS.get(character_id)
                if character_cls is not None:
                    character_agent = character_cls(self.provider)
                    try:
                        sub_result = await character_agent.respond_structured(
                            context=[],
                            user_message=(
                                f"Scene: {scene_desc}\nContext: {task}\n"
                                "Respond in character."
                            ),
                            model_route=beat_model_route,
                            voice_example=voice_example,
                        )
                        evt_data = {
                            **evt_data,
                            "content": sub_result["reply_text"],
                            "emotion_state": sub_result["emotion_state"]
                            or evt_data.get("emotion_state"),
                            "gif_search_query": sub_result["gif_search_query"]
                            or evt_data.get("gif_search_query"),
                        }
                    except Exception:
                        logger.warning(
                            "Character sub-agent call failed for %s, using LLM dialogue fallback",
                            evt_data.get("character_id"),
                        )
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
            beat_events_for_dossier.append(evt)
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
        # Signal beat completion
        yield self._beat_ready_event(beat_index, scene_desc)

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
    def _beat_ready_event(beat_index: int, summary: str) -> AgentEvent:
        return AgentEvent(
            type="beat_ready",
            data={"beat_id": f"beat_{beat_index + 1}", "beat_summary": summary},
        )
    @staticmethod
    def _parse_beat_events(text: str) -> list[dict[str, Any]]:
        """Parse the LLM response as a JSON array of event objects.
        Tries in order:
        1. Fenced JSON (```json [...] ```)
        2. Raw JSON array ([...]) anywhere in text
        3. Single JSON object ({...}) wrapped in array
        """
        trimmed = text.strip()
        # Try fenced JSON first
        fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", trimmed, re.DOTALL)
        if fenced:
            try:
                return json.loads(fenced.group(1))
            except json.JSONDecodeError:
                pass
        # Try raw JSON array
        start = trimmed.find("[")
        end = trimmed.rfind("]")
        if start >= 0 and end > start:
            try:
                return json.loads(trimmed[start : end + 1])
            except json.JSONDecodeError:
                pass
        # Try single JSON object — wrap in array
        obj_start = trimmed.find("{")
        obj_end = trimmed.rfind("}")
        if obj_start >= 0 and obj_end > obj_start:
            try:
                obj = json.loads(trimmed[obj_start : obj_end + 1])
                if isinstance(obj, dict):
                    return [obj]
            except json.JSONDecodeError:
                pass
        return []
    # ------------------------------------------------------------------
    # Chat-mode handlers (direct + crew)
    # ------------------------------------------------------------------
    async def handle_chat_message(
        self,
        character_id: str,
        user_message: str,
        context: dict[str, Any],
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
        history: list[dict] = context.get("history", [])
        language: str = context.get("language", "en")
        relation: str = context.get("relation", "partner")
        if mode == "crew":
            return await self._handle_crew_chat(character_id, user_message, context)
        return await self._handle_direct_chat(character_id, user_message, context)
    async def _handle_direct_chat(
        self,
        character_id: str,
        user_message: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Direct-mode: call the character agent with structured output."""
        backend_id = FRONTEND_TO_BACKEND_ID.get(character_id, "Walter White")
        character_cls = CHARACTER_AGENTS.get(backend_id)
        if character_cls is None:
            character_cls = CHARACTER_AGENTS["Walter White"]
        relation: str = context.get("relation", "partner")
        language: str = context.get("language", "en")
        llm_provider: str = context.get("llmProvider", "stepfun")
        # Resolve model route
        scene_context = f"{backend_id} {relation} {user_message}".lower()
        model_route = self.provider.resolve_model_route(
            scene_context=scene_context,
            characters=list(CHARACTER_AGENTS.keys()),
        )
        # Override provider prefix from frontend selection
        if llm_provider == "minimax":
            model_route = "minimax/MiniMax-M3"
        elif llm_provider == "stepfun":
            model_route = "stepfun/step-3.7-flash"
        else:
            model_route = f"cliproxy/{self.provider.cli_proxy_default_model}"
        # Build context messages from history
        history: list[dict] = context.get("history", [])
        ctx_messages: list[dict] = []
        for turn in history:
            role = turn.get("sender", "user")
            if role == "user":
                ctx_messages.append({"role": "user", "content": turn.get("text", "")})
            else:
                ctx_messages.append({"role": "assistant", "content": turn.get("text", "")})
        # Build relationship context string for the prompt
        rel_label = relation
        voice_example: str | None = context.get("voiceExample")
        user_msg_with_context = user_message
        if voice_example:
            user_msg_with_context += f"\n\n[Reference speaking style: {voice_example}]"
        # Instantiate character and call structured respond
        agent = character_cls(self.provider)
        result = await agent.respond_structured(
            context=ctx_messages,
            user_message=user_msg_with_context,
            model_route=model_route,
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
    ) -> dict[str, Any]:
        """Crew mode: generate a multi-character debate turn."""
        llm_provider: str = context.get("llmProvider", "stepfun")
        provider_prefix = "minimax" if llm_provider == "minimax" else (
            "stepfun" if llm_provider == "stepfun" else "cliproxy"
        )
        # Determine participants — start with the active character, then add
        # characters that are contextually relevant.
        backend_primary = FRONTEND_TO_BACKEND_ID.get(character_id, "Walter White")
        participants_backend: list[str] = [backend_primary]
        text_lower = user_message.lower()
        for keyword, backend_name in [
            ("saul", "Saul Goodman"),
            ("mike", "Mike Ehrmantraut"),
            ("gus", "Gus Fring"),
            ("skyler", "Skyler White"),
            ("jesse", "Jesse Pinkman"),
        ]:
            if keyword in text_lower and backend_name not in participants_backend:
                participants_backend.append(backend_name)
        # Cap at 3 participants
        participants_backend = participants_backend[:3]
        participants_frontend = [
            BACKEND_TO_FRONTEND_ID.get(name, name.lower().split()[0])
            for name in participants_backend
        ]
        # Build the multi-turn prompt
        relation: str = context.get("relation", "partner")
        language: str = context.get("language", "en")
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
            f"Language: {language}\n\n"
        )
        if history_summary:
            crew_prompt += f"Recent conversation:\n{history_summary}\n\n"
        crew_prompt += (
            f"Generate a dialogue turn for each of these characters: "
            f"{', '.join(participants_backend)}. "
            f"Emit the JSON array as specified."
        )
        messages = [
            {"role": "system", "content": CREW_CHAT_SYSTEM_PROMPT},
            {"role": "user", "content": crew_prompt},
        ]
        # Use the primary character's preferred model route
        primary_context = f"{backend_primary} {user_message}".lower()
        model_route = self.provider.resolve_model_route(
            scene_context=primary_context,
            characters=participants_backend,
        )
        if provider_prefix == "cliproxy":
            model_route = f"cliproxy/{self.provider.cli_proxy_default_model}"
        elif provider_prefix == "stepfun":
            model_route = "stepfun/step-3.7-flash"
        elif provider_prefix == "minimax":
            model_route = "minimax/MiniMax-M3"
        else:
            _, model_name = model_route.split("/", 1)
            model_route = f"{provider_prefix}/{model_name}"
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
                "text": entry.get("content", ""),
                "emotion": entry.get("emotion_state"),
                "gifQuery": entry.get("gif_search_query"),
                "thinking": entry.get("thinking"),
                "tool_executed": entry.get("tool_executed"),
                "tool_log": entry.get("tool_log"),
            })
        return logs
