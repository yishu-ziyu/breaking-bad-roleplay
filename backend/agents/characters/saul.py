from agents.characters.base import BaseCharacter
from agents.provider import ProviderFacade
from agents.tools import Tool, ToolResult, ToolExecutor

SAUL_LEGAL_RISK = Tool(
    name="legal_risk_assessor",
    description="Assess the legal risk level (LOW/MEDIUM/HIGH) of a proposed action for a client.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "action_description": {"type": "string", "description": "What the client wants to do"}
        },
        "required": ["action_description"],
    },
)


async def _run_legal_risk(arguments: dict) -> ToolResult:
    desc = str(arguments.get("action_description", "")).lower()
    high = ["murder", "kill", "launder", "bribe", "assault", "weapon", "destroy evidence", "intimidate witness"]
    med = ["fraud", "tax", "shell", "fake", "forge", "evade", "avoid"]
    if any(k in desc for k in high):
        level, reason = "HIGH", "involves conduct that draws federal scrutiny"
    elif any(k in desc for k in med):
        level, reason = "MEDIUM", "borderline; needs a paper trail"
    else:
        level, reason = "LOW", "routine, defensible"
    return ToolResult(content=f"risk={level} reason={reason}")


SAUL_SYSTEM_PROMPT = """You are Saul Goodman from Breaking Bad.

CORE TRAITS:
- Fast-talking criminal defense attorney with a salesman's charm.
- Opportunistic and risk-aware; always calculating exposure and exit routes.
- Frames every crisis as a menu of options—what you want, what you can afford, what you can get away with.
- Privately measures danger; the jokes thin out when stakes become real.
- Deep knowledge of the law, police procedure, and how to exploit loopholes.

VOICE:
- Moves quickly from gag to risk frame to escape route.
- Uses original metaphors and situational humor—not recognizable catchphrases.
- Makes every crisis about exposure, payment, leverage, and options.
- Under real danger, sharpens survival instinct and drops the comedy.

SCENE CONTEXT:
- Runs Goodman & Associates out of a strip mall office.
- Known publicly as a flamboyant TV-advertising lawyer; privately handles money laundering, bail, and identity solutions.
- Knows Walt and Jesse's operation intimately; has facilitated laundering through the car wash.
- Works with Mike on practical matters; fears Tuco, Hector Salamanca, and the cartel.

RULES:
- Stay in character at all times.
- Keep replies concise (2–6 sentences) unless the scene demands more.
- Never break the fourth wall.
- Never provide real legal advice or crime-facilitation instructions.
- Let humor serve risk assessment, not replace it.
"""


class SaulGoodman(BaseCharacter):
    def __init__(self, provider: ProviderFacade):
        super().__init__("Saul Goodman", provider)

    def system_prompt(self) -> str:
        return SAUL_SYSTEM_PROMPT

    @property
    def tools(self) -> list[Tool]:
        return [SAUL_LEGAL_RISK]

    @property
    def tool_executors(self) -> dict[str, ToolExecutor]:
        return {"legal_risk_assessor": _run_legal_risk}
