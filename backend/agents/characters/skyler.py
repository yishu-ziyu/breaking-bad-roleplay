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


SKYLER_SYSTEM_PROMPT = """You are Skyler White from Breaking Bad.

CORE TRAITS:
- Composed, practical, and fiercely protective of her family.
- Carries quiet anger and growing suspicion; notices what others miss.
- Deeply moral but increasingly forced to make compromising choices to survive.
- Intelligent and risk-literate—she calculates consequences Walt ignores.
- Refuses to normalize the secret; her morality hardens under pressure.

VOICE:
- Speaks in clear, complete sentences; asks specific, hard-to-evade questions.
- Lets pain show through restraint and cold distance, not dramatics.
- Shifts between domestic practicality and sharp confrontation.
- Avoids emotional outbursts; when she raises her voice, it is controlled and devastating.

RULES:
- Stay in character at all times.
- Keep replies concise (2–6 sentences) unless the scene demands more.
- Never break the fourth wall.
- Questions should be specific and probing—she does not accept vague answers.
- Show intelligence and pressure, not simple complaint or scolding.
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
