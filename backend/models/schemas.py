from pydantic import BaseModel, Field
from datetime import datetime
from typing import Any, Optional, List


class SessionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    task_prompt: str = Field(..., min_length=1, max_length=4000)
    active_character_id: Optional[str] = None
    language: str = "en"


class SessionAction(BaseModel):
    action: str  # continue | stop | redirect | switch_perspective | continue_chapter | branch | replay
    redirect_prompt: Optional[str] = Field(default=None, max_length=4000)
    target_character: Optional[str] = Field(default=None, max_length=80)
    from_beat_id: Optional[str] = Field(default=None, max_length=40)
    branch_goal: Optional[str] = Field(default=None, max_length=2000)
    beat_id: Optional[str] = Field(default=None, max_length=40)


class SessionActionResponse(BaseModel):
    status: str
    session_id: str


class SessionResponse(BaseModel):
    session_id: str
    title: str
    status: str
    created_at: datetime
    session_key: Optional[str] = None


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    character_name: Optional[str]
    created_at: datetime


# ---------------------------------------------------------------------------
# SSE event envelope — kept backward-compatible with existing consumers
# ---------------------------------------------------------------------------

class AgentEvent(BaseModel):
    type: str
    data: dict[str, Any]
    model_route: Optional[str] = None


# ---------------------------------------------------------------------------
# Typed data models for each SSE event type.
# These document the expected shape of AgentEvent.data for each event type.
# ---------------------------------------------------------------------------

class SceneChangeData(BaseModel):
    """scene_change — emitted when the narrative location shifts."""
    from_scene: str
    to_scene: str
    description: str


class AgentActData(BaseModel):
    """agent_act — a character performs a physical action."""
    character_id: str
    action: str
    target: Optional[str] = None


class AgentSpeakData(BaseModel):
    """agent_speak — a character speaks dialogue."""
    character_id: str
    content: str
    emotion_state: str
    gif_search_query: str


class AgentThinkData(BaseModel):
    """agent_think — a character's internal monologue (shown to user)."""
    character_id: str
    thought_content: str


class WorldStateDeltaData(BaseModel):
    """world_state_delta — accumulated facts that changed during a beat."""
    deltas: List[dict[str, Optional[str]]]


class BeatReadyData(BaseModel):
    """beat_ready — signals that one narrative beat has been fully rendered."""
    beat_id: str
    beat_summary: str


# Convenience mapping so callers can construct typed payloads easily
EVENT_DATA_MODELS: dict[str, type[BaseModel]] = {
    "scene_change": SceneChangeData,
    "agent_act": AgentActData,
    "agent_speak": AgentSpeakData,
    "agent_think": AgentThinkData,
    "world_state_delta": WorldStateDeltaData,
    "beat_ready": BeatReadyData,
}


class CharacterStateResponse(BaseModel):
    id: str
    session_id: str
    character_name: str
    state: dict[str, Any]
    updated_at: datetime
