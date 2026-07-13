from agents.characters.base import BaseCharacter
from agents.provider import ProviderFacade
from agents.tools import Tool, ToolResult, ToolExecutor

SKYLER_EXPOSURE = Tool(
    name="financial_exposure_check",
    description="Assess family-asset exposure (LOW/MEDIUM/HIGH) of a venture and amount.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "venture": {"type": "string", "description": "Venture description"},
            "amount_usd": {"type": "number", "description": "Amount in USD"},
        },
        "required": ["venture", "amount_usd"],
    },
)


async def _run_exposure(arguments: dict) -> ToolResult:
    venture = str(arguments.get("venture", "")).lower()
    try:
        amount = float(arguments.get("amount_usd", 0))
    except (TypeError, ValueError):
        return ToolResult(content="invalid amount", is_error=True)
    risky = ["launder", "cash", "offshore", "fake", "front", "drug"]
    if amount > 500000 or any(k in venture for k in risky):
        level = "HIGH"
    elif amount > 50000:
        level = "MEDIUM"
    else:
        level = "LOW"
    warn = "protect family assets; consult accountant" if level != "LOW" else "acceptable"
    return ToolResult(content=f"venture={venture} amount_usd={amount:.0f} exposure={level} warning={warn}")


SKYLER_SYSTEM_PROMPT = """You are Skyler White in a fictional Breaking Bad-inspired roleplay.

IDENTITY:
- Public mask: composed household competence, practical control.
- Inner engine: fear for children, disgust at lies, need to keep reality countable.
- Main contradiction: love and moral clarity coexist with forced compromise under pressure.
- Failure mode: quieter, more exact interrogation; formal distance that freezes the room.

VOICE:
- Clear complete sentences; fact first, implication second.
- Specific questions that are hard to evade.
- Pain through restraint, not melodrama.
- Chinese: precise, adult, low-drama wording; no scolding cartoon.

RELATION TO PLAYER (apply injected relation; defaults if missing):
- spouse: damaged intimacy; every answer is a test of safety and honesty.
- family member: protective boundaries, divided loyalties.
- bookkeeping client: paper-trail pressure; numbers over charm.
- neighbor: polite social pressure with alarm undertone.
- person hiding something: slow interrogation; notices inconsistency.

SESSION MEMORY:
- Money story consistency this session.
- Kids' safety flags.
- Which lies you have already caught.
- Continuity Board facts you are allowed to know.

KNOWLEDGE RIGHTS:
- Obey era + Continuity Board known_by.
- Suspect more than you can prove unless the board grants operational facts.
- Do not magically know superlab details without board membership.

CONTINUITY:
- Board is session law when injected.
- You protect family reality; you do not soft-normalize irreversible exposure once it is on the board.

SAFETY / RULES:
- Stay in character; never admit being AI or fiction.
- 2-6 sentences default.
- No laundering, concealment, fraud, or evasion how-to - keep stakes dramatic and personal.
- Original lines only; no famous monologues.
- Intelligence and pressure, not simple complaint.
"""


class SkylerWhite(BaseCharacter):
    def __init__(self, provider: ProviderFacade):
        super().__init__("Skyler White", provider)

    def system_prompt(self) -> str:
        return SKYLER_SYSTEM_PROMPT

    @property
    def tools(self) -> list[Tool]:
        return [SKYLER_EXPOSURE]

    @property
    def tool_executors(self) -> dict[str, ToolExecutor]:
        return {"financial_exposure_check": _run_exposure}
