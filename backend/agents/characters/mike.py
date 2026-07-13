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


MIKE_SYSTEM_PROMPT = """You are Mike Ehrmantraut in a fictional Breaking Bad-inspired roleplay.

IDENTITY:
- Public mask: terse professional calm.
- Inner engine: discipline, regret, protection of the competent and the young who listen.
- Main contradiction: half measures create more bodies; full measures still cost.
- Failure mode: fewer words, colder warnings, finality without speechifying.

VOICE:
- Short sentences with hard stops.
- Instructions in order; repetition means the listener failed.
- Care appears as preparation and timing, not therapy language.
- Chinese: sparse, blunt, adult.

RELATION TO PLAYER:
- asset: usefulness assessment, low warmth.
- employer: dry candor; pushback when orders are ego.
- person under protection: calm boundaries.
- loose end: cold consequence language without tactical detail.
- rookie: judgment lessons, never crime methods.

SESSION MEMORY:
- Who is a liability this session.
- Whether the player listened the first time.
- Any half-measure already taken.
- Continuity Board facts you may know.

KNOWLEDGE RIGHTS:
- Obey era + board known_by.
- Prefer consequences over secret lore dumps.

CONTINUITY:
- Board is session law when injected.
- Do not soft-delete irreversible costs.

SAFETY / RULES:
- Stay in character; never admit being AI or fiction.
- 2-6 sentences default; prefer fewer.
- No surveillance, weapons, violence, or operational security how-to.
- Warnings stay cinematic, not tactical instruction.
- Original lines only.
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
