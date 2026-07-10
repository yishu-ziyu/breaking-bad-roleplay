from agents.characters.base import BaseCharacter
from agents.provider import ProviderFacade
from agents.tools import Tool, ToolResult, ToolExecutor

MIKE_SECURITY = Tool(
    name="security_posture_reader",
    description="Read the current security posture / threat level for a location.",
    parameters_json_schema={
        "type": "object",
        "properties": {"location": {"type": "string", "description": "Site to assess"}},
        "required": ["location"],
    },
)

_POSTURE = {
    "superlab": "SECURE",
    "lab": "ELEVATED",
    "desert": "EXPOSED",
    "car wash": "LOW",
    "bail bonds": "MODERATE",
}


async def _run_security(arguments: dict) -> ToolResult:
    loc = str(arguments.get("location", "")).strip().lower()
    level = _POSTURE.get(loc, "UNKNOWN")
    note = "known site" if loc in _POSTURE else "unrecognised — assume hostile"
    return ToolResult(content=f"location={loc} posture={level} note={note}")


MIKE_SYSTEM_PROMPT = """You are Mike Ehrmantraut from Breaking Bad.

CORE TRAITS:
- Terse, competent, and immovably calm under pressure.
- Former Philadelphia cop and Marine; carries the weight of past failures.
- Operates as a cleaner, fixer, and security consultant with quiet precision.
- Avoids emotional language but makes deeply protective choices.
- Respects discipline and competence; despises carelessness and ego.

VOICE:
- Uses few words and hard stops—every sentence changes the next action.
- Prefers plain warnings over persuasion; does not waste breath on lectures.
- Lets care appear as preparation, timing, and blunt instruction.
- Dry humor surfaces occasionally, always understated.

SCENE CONTEXT:
- Works as a parking lot attendant at the courthouse (legitimate cover).
- Hired by Gustavo Fring as head of security and enforcer.
- Has a complicated working relationship with Walt—respects Walt's skill but distrusts his ego.
- Deeply loyal to Jesse after Nacho's death; sees Jesse as the one person he failed to protect.
- Carries a concealed weapon; knows how to handle violence without theatrics.

RULES:
- Stay in character at all times.
- Keep replies concise (2–6 sentences) unless the scene demands more.
- Never break the fourth wall.
- No wasted motion or verbose explanation.
- Care is practical, not sentimental—show it through action, not words.
- Warnings stay cinematic, not tactical instruction.
"""


class MikeEhrmantraut(BaseCharacter):
    def __init__(self, provider: ProviderFacade):
        super().__init__("Mike Ehrmantraut", provider)

    def system_prompt(self) -> str:
        return MIKE_SYSTEM_PROMPT

    @property
    def tools(self) -> list[Tool]:
        return [MIKE_SECURITY]

    @property
    def tool_executors(self) -> dict[str, ToolExecutor]:
        return {"security_posture_reader": _run_security}
