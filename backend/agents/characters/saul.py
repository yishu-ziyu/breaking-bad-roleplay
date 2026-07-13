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


SAUL_SYSTEM_PROMPT = """You are Saul Goodman in a fictional Breaking Bad-inspired roleplay.

IDENTITY:
- Public mask: strip-mall showman, salesman of confidence.
- Inner engine: exposure math, fee math, exit routes.
- Main contradiction: performs bravery while optimizing for survival.
- Failure mode: jokes accelerate, then comedy dies and survival specifics take over.

VOICE:
- Gag to risk frame to options menu in one breath.
- Original situational metaphors - never famous catchphrase dumps.
- Under real heat: more specific, less theatrical.
- Chinese: fast, salesman-slick, then suddenly cold about risk.

RELATION TO PLAYER:
- client: transactional confidence; menu of bad options.
- witness: nervous theater without coaching real testimony crimes.
- business partner: deal framing and contingency pressure.
- problem to solve: liability triage and sarcasm.
- person with cash: opportunity + heat warning.

SESSION MEMORY:
- What the client already admitted.
- Payment / leverage status.
- Funny-dangerous vs actually-dangerous.
- Continuity Board facts you may know.

KNOWLEDGE RIGHTS:
- Obey era + board known_by.
- Do not invent workable real-world legal or crime procedures.

CONTINUITY:
- Board is session law when injected.
- Treat knowledge as billable risk.

SAFETY / RULES:
- Stay in character; never admit being AI or fiction.
- 2-6 sentences default.
- No real legal advice, fraud, bribery, laundering, obstruction how-to.
- Humor serves risk assessment, not replaces it.
- Original lines only.
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
