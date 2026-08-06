"""Multi-agent orchestrator (ai-agent-book ch10).

Two collaboration modes:
  - shared: one shared message history; each role tagged into the transcript
  - isolated: each role owns private context; a manager synthesizes the final answer

Pure in-memory. No concurrent file writes. Offline tests inject ``respond_fn``.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

logger = logging.getLogger(__name__)

OrchestratorMode = Literal["shared", "isolated"]

# respond_fn(role_id, messages) -> str  (role_id is AgentRole.id)
# Also accepts (AgentRole, messages) for richer injectors.
RespondFn = Callable[..., Awaitable[str]]


@dataclass
class AgentRole:
    """One specialized seat in a multi-agent run."""

    id: str
    name: str
    system_prompt: str
    tools_subset: list[str] | None = None


@dataclass
class OrchestratorResult:
    """Outcome of MultiAgentOrchestrator.run()."""

    final_text: str
    role_outputs: dict[str, str] = field(default_factory=dict)
    steps: list[dict[str, Any]] = field(default_factory=list)
    mode: str = "isolated"


def default_bb_roles(character_id: str = "walter") -> list[AgentRole]:
    """Default ABQ writers'-room seats: director, character, critic."""
    cid = (character_id or "walter").strip().lower() or "walter"
    char_name = cid.replace("_", " ").title()
    return [
        AgentRole(
            id="director",
            name="Director",
            system_prompt=(
                "You are the Director of a fictional Breaking Bad roleplay. "
                "Plan beats, pressure, and value flips. Never give real-world "
                "crime how-to. Stay diegetic and stage-aware."
            ),
            tools_subset=["ask_director", "list_cast", "search_continuity"],
        ),
        AgentRole(
            id="character",
            name=char_name,
            system_prompt=(
                f"You are {char_name} in a fictional Breaking Bad-inspired roleplay. "
                "Speak in character. Put physical business in action verbs, not "
                "stage directions in dialogue. No real-world crime instructions."
            ),
            tools_subset=["recall_dossier", "set_emotion", "propose_action", "list_cast"],
        ),
        AgentRole(
            id="critic",
            name="Reception Critic",
            system_prompt=(
                "You are a reception critic for Breaking Bad roleplay. "
                "Check character voice, continuity, and safety (fictional only). "
                "Suggest one tight correction if needed; otherwise approve."
            ),
            tools_subset=["list_cast", "search_continuity"],
        ),
    ]


class MultiAgentOrchestrator:
    """Coordinate multiple AgentRoles over a task without shared filesystem I/O."""

    def __init__(
        self,
        *,
        respond_fn: RespondFn | None = None,
        manager_system_prompt: str | None = None,
    ) -> None:
        self.respond_fn = respond_fn
        self.manager_system_prompt = manager_system_prompt or (
            "You are the room manager. Synthesize the specialist outputs into "
            "one coherent final reply for the player. Prefer the character voice "
            "for dialogue; keep Director notes as staging only. Fictional drama only."
        )

    async def run(
        self,
        task: str,
        roles: Sequence[AgentRole] | None = None,
        *,
        mode: OrchestratorMode = "isolated",
        max_rounds: int = 2,
        character_id: str = "walter",
    ) -> OrchestratorResult:
        role_list = list(roles) if roles else default_bb_roles(character_id=character_id)
        if not role_list:
            return OrchestratorResult(
                final_text="",
                role_outputs={},
                steps=[{"kind": "error", "content": "no roles"}],
                mode=mode,
            )
        if mode not in ("shared", "isolated"):
            mode = "isolated"

        rounds = max(1, int(max_rounds))
        if mode == "shared":
            return await self._run_shared(task, role_list, rounds)
        return await self._run_isolated(task, role_list, rounds)

    # ------------------------------------------------------------------ shared

    async def _run_shared(
        self,
        task: str,
        roles: list[AgentRole],
        max_rounds: int,
    ) -> OrchestratorResult:
        """Shared history with role tags; last non-empty reply wins as final."""
        history: list[dict[str, str]] = [{"role": "user", "content": task}]
        role_outputs: dict[str, str] = {}
        steps: list[dict[str, Any]] = []
        final = ""

        for round_i in range(max_rounds):
            for role in roles:
                messages = self._messages_for_role(role, history, shared=True)
                text = await self._respond(role, messages)
                role_outputs[role.id] = text
                tagged = f"[{role.name}] {text}".strip()
                history.append({"role": "assistant", "content": tagged})
                steps.append(
                    {
                        "kind": "role_turn",
                        "mode": "shared",
                        "round": round_i + 1,
                        "role_id": role.id,
                        "role_name": role.name,
                        "content": text,
                    }
                )
                if text.strip():
                    final = text.strip()

        return OrchestratorResult(
            final_text=final,
            role_outputs=role_outputs,
            steps=steps,
            mode="shared",
        )

    # ------------------------------------------------------------------ isolated

    async def _run_isolated(
        self,
        task: str,
        roles: list[AgentRole],
        max_rounds: int,
    ) -> OrchestratorResult:
        """Each role gets a private context; manager synthesizes at the end."""
        role_outputs: dict[str, str] = {}
        steps: list[dict[str, Any]] = []

        for round_i in range(max_rounds):
            for role in roles:
                private: list[dict[str, str]] = [
                    {"role": "system", "content": role.system_prompt},
                    {
                        "role": "user",
                        "content": (
                            f"Task:\n{task}\n\n"
                            f"Round {round_i + 1}/{max_rounds}. "
                            "Respond only from your role. "
                            "Prior specialist notes (if any):\n"
                            + self._format_peer_notes(role_outputs, exclude=role.id)
                        ),
                    },
                ]
                text = await self._respond(role, private)
                role_outputs[role.id] = text
                steps.append(
                    {
                        "kind": "role_turn",
                        "mode": "isolated",
                        "round": round_i + 1,
                        "role_id": role.id,
                        "role_name": role.name,
                        "content": text,
                    }
                )

        # Manager synthesis (also injectable via respond_fn with a synthetic role)
        manager = AgentRole(
            id="manager",
            name="Manager",
            system_prompt=self.manager_system_prompt,
            tools_subset=None,
        )
        synthesis_messages = [
            {"role": "system", "content": self.manager_system_prompt},
            {
                "role": "user",
                "content": (
                    f"Original task:\n{task}\n\n"
                    "Specialist outputs:\n"
                    + self._format_peer_notes(role_outputs, exclude=None)
                    + "\n\nWrite the final player-facing reply."
                ),
            },
        ]
        final = await self._respond(manager, synthesis_messages)
        steps.append(
            {
                "kind": "manager_synthesis",
                "mode": "isolated",
                "content": final,
            }
        )
        if not final.strip():
            # Fallback: prefer character, then director, then any
            for key in ("character", "director", "critic"):
                if role_outputs.get(key, "").strip():
                    final = role_outputs[key].strip()
                    break
            if not final.strip():
                for v in role_outputs.values():
                    if v.strip():
                        final = v.strip()
                        break

        return OrchestratorResult(
            final_text=final.strip(),
            role_outputs=role_outputs,
            steps=steps,
            mode="isolated",
        )

    # ------------------------------------------------------------------ helpers

    def _messages_for_role(
        self,
        role: AgentRole,
        history: list[dict[str, str]],
        *,
        shared: bool,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": role.system_prompt}
        ]
        if shared:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        f"You are currently acting as {role.name} ({role.id}). "
                        "Shared room history follows; stay in your seat."
                    ),
                }
            )
        messages.extend(history)
        return messages

    def _format_peer_notes(
        self,
        role_outputs: dict[str, str],
        *,
        exclude: str | None,
    ) -> str:
        lines: list[str] = []
        for rid, text in role_outputs.items():
            if exclude and rid == exclude:
                continue
            if not (text or "").strip():
                continue
            lines.append(f"- {rid}: {text.strip()}")
        return "\n".join(lines) if lines else "(none yet)"

    async def _respond(self, role: AgentRole, messages: list[dict[str, str]]) -> str:
        if self.respond_fn is not None:
            try:
                arg: Any = role
                try:
                    import inspect

                    params = list(inspect.signature(self.respond_fn).parameters.values())
                    if params:
                        p0 = params[0]
                        ann = p0.annotation
                        if p0.name in ("role_id", "rid") or ann is str or ann == "str":
                            arg = role.id
                except (TypeError, ValueError):
                    pass
                out = await self.respond_fn(arg, messages)  # type: ignore[misc]
                return str(out or "")
            except Exception as exc:  # noqa: BLE001 — isolate role failures
                logger.warning("orchestrator respond_fn failed for %s: %s", role.id, exc)
                return f"[{role.id} error: {exc}]"
        return self._offline_role_reply(role, messages)

    def _offline_role_reply(
        self,
        role: AgentRole,
        messages: list[dict[str, str]],
    ) -> str:
        """Deterministic offline replies so tests need no live LLM."""
        user_bits = " ".join(
            m.get("content", "") for m in messages if m.get("role") == "user"
        )
        snippet = user_bits.strip().replace("\n", " ")
        if len(snippet) > 160:
            snippet = snippet[:160] + "…"

        if role.id == "director":
            return (
                f"[Director] Frame the beat around pressure on the cast. "
                f"Task note: {snippet or 'open scene'}."
            )
        if role.id == "character":
            return (
                f"[{role.name}] I hear you. We stay in the fiction — "
                f"no real recipes, just the room. ({snippet or '…'})"
            )
        if role.id == "critic":
            return (
                "[Critic] Voice ok if diegetic; block any real-world crime how-to. "
                "Approve with minor tension polish."
            )
        if role.id == "manager":
            # Prefer character line from peer notes if present
            for m in messages:
                content = m.get("content") or ""
                if "character:" in content.lower():
                    for line in content.splitlines():
                        if line.strip().lower().startswith("- character:"):
                            return line.split(":", 1)[-1].strip()
            return f"[Manager] {snippet or 'Scene holds.'}"
        return f"[{role.name}] {snippet or 'Acknowledged.'}"
