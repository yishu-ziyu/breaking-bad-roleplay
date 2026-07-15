"""Runtime layer: execute one plan beat as an event stream.

DEC-0004 seam A: BeatRuntime takes a typed StoryPlan slice and yields AgentEvents.
Character agents stay behind DirectorAgent._generate_beat; this module is the
orchestration entry for "one beat = plan → events → HITL/world writes".
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Protocol

from agents.plan_service import StoryPlan
from models.schemas import AgentEvent


class _BeatDirector(Protocol):
    """Minimal surface BeatRuntime needs from DirectorAgent."""

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
    ) -> AsyncIterator[AgentEvent]: ...

    def _short_scene_name(self, scene_desc: str) -> str: ...


class BeatRuntime:
    """Run a single StoryPlan beat through the director's beat generator.

    Deep interface: callers pass plan + index + session context; they do not
    re-parse outline prose or invent beat context.
    """

    def __init__(self, director: _BeatDirector):
        self._director = director

    def context_for(
        self,
        plan: StoryPlan,
        beat_index: int,
    ) -> dict[str, str]:
        """Build previous/current scene context from structured plan beats."""
        beat = plan.beat_at(beat_index)
        scene_desc = beat.text if beat else ""
        previous_scene = ""
        previous_scene_desc = ""
        if beat_index > 0:
            prev = plan.beat_at(beat_index - 1)
            if prev:
                previous_scene_desc = prev.text
                previous_scene = self._director._short_scene_name(prev.text)
        current_scene = (
            self._director._short_scene_name(scene_desc) if scene_desc else ""
        )
        return {
            "previous_scene": previous_scene,
            "previous_scene_desc": previous_scene_desc,
            "current_scene": current_scene,
        }

    async def run_beat(
        self,
        *,
        plan: StoryPlan,
        beat_index: int,
        task: str,
        language: str = "en",
        db: Any = None,
        session_factory: Any = None,
        session_id: str | None = None,
        active_character_id: str | None = None,
        voice_example: str | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Yield events for one beat. Raises IndexError if beat_index out of range."""
        beat = plan.beat_at(beat_index)
        if beat is None:
            raise IndexError(
                f"beat_index {beat_index} out of range (plan has {len(plan.beats)} beats)"
            )
        context = self.context_for(plan, beat_index)
        async for event in self._director._generate_beat(
            task=task,
            outline=plan.raw_outline,
            beat_index=beat_index,
            context=context,
            scene_desc=beat.text,
            db=db,
            session_factory=session_factory,
            session_id=session_id,
            active_character_id=active_character_id,
            voice_example=voice_example,
            language=language,
        ):
            yield event
