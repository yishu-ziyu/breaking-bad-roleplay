"""Context engineering (ch2) — budget, status bar, KV-cache friendly assembly.

Stable prefix order for assembly:
  system (rules) → status (dynamic, isolated) → skills → memory → history → user
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence


@dataclass
class ContextBudget:
    """Hard caps for assembled context size."""

    max_chars: int = 12000
    keep_recent_messages: int = 12


@dataclass
class AgentStatusBar:
    """Per-turn agent telemetry rendered as an isolated status block."""

    turn: int = 0
    mode: str = "direct"
    character_id: str = ""
    language: str = "zh"
    tools_available: int = 0
    memory_hits: int = 0
    token_estimate: int = 0
    elapsed_s: float = 0.0
    flags: list[str] = field(default_factory=list)

    def format_block(self) -> str:
        flags_str = ",".join(self.flags) if self.flags else "-"
        return (
            "[AGENT STATUS]\n"
            f"turn={self.turn} mode={self.mode} character={self.character_id} "
            f"lang={self.language} tools={self.tools_available} "
            f"memory_hits={self.memory_hits} tokens≈{self.token_estimate} "
            f"elapsed={self.elapsed_s}s\n"
            f"flags={flags_str}"
        )


class ContextAssembler:
    """Assemble messages in KV-cache friendly stable prefix order."""

    def __init__(self, budget: ContextBudget | None = None) -> None:
        self.budget = budget or ContextBudget()

    def estimate_chars(self, messages: Sequence[dict[str, Any]]) -> int:
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if content is None:
                content = ""
            total += len(str(content))
            # small overhead for role tags
            total += len(str(msg.get("role", ""))) + 4
        return total

    def compress_history(
        self,
        messages: Sequence[dict[str, Any]],
        budget: ContextBudget | None = None,
    ) -> list[dict[str, Any]]:
        """Compress history under budget.

        Policy:
          - keep system messages (stable prefix)
          - keep last N user/assistant turns
          - summarize dropped middle as one synthetic user message
            ``[CONTEXT COMPRESSED] earlier turns: ...`` with bullet summaries
            (first 80 chars of each dropped msg)
        """
        b = budget or self.budget
        msgs = [dict(m) for m in messages]

        if self.estimate_chars(msgs) <= b.max_chars:
            return msgs

        system_msgs = [m for m in msgs if m.get("role") == "system"]
        non_system = [m for m in msgs if m.get("role") != "system"]

        keep_n = max(0, b.keep_recent_messages)
        if len(non_system) <= keep_n:
            # Still over budget: truncate contents of oldest first
            return self._truncate_to_budget(system_msgs + non_system, b.max_chars)

        # Prefer keeping last N; shrink keep window / summary if still over budget.
        for n in range(min(keep_n, len(non_system)), -1, -1):
            dropped = non_system[:-n] if n else non_system[:]
            kept = non_system[-n:] if n else []
            # Reserve roughly half budget for the summary when keep window is full
            kept_est = self.estimate_chars(kept) + self.estimate_chars(system_msgs)
            summary_cap = max(200, b.max_chars - kept_est - 32)
            # Also allow generous room so 80-char bullets are not starved
            summary_cap = max(summary_cap, 200)
            summary = self._build_compression_summary(
                dropped, max_summary_chars=summary_cap
            )
            compressed = [{"role": "user", "content": summary}] if dropped else []
            result = system_msgs + compressed + kept
            if self.estimate_chars(result) <= b.max_chars:
                return result

        # Last resort: system + summary of everything (may still need truncate)
        summary = self._build_compression_summary(
            non_system, max_summary_chars=max(200, b.max_chars // 2)
        )
        result = system_msgs + [{"role": "user", "content": summary}]
        if self.estimate_chars(result) <= b.max_chars:
            return result
        return self._truncate_to_budget(result, b.max_chars)

    def _build_compression_summary(
        self,
        dropped: Sequence[dict[str, Any]],
        max_summary_chars: int = 1500,
    ) -> str:
        if not dropped:
            return "[CONTEXT COMPRESSED] earlier turns: (empty)"
        bullets: list[str] = []
        header = "[CONTEXT COMPRESSED] earlier turns:\n"
        used = len(header)
        # Always emit at least one 80-char bullet so callers can rely on the
        # "first 80 chars of each dropped msg" contract for visible drops.
        min_bullets = 1
        for i, m in enumerate(dropped):
            role = m.get("role", "?")
            content = str(m.get("content") or "").replace("\n", " ").strip()
            snippet = content[:80]
            if len(content) > 80:
                snippet += "…"
            line = f"- ({role}) {snippet}"
            would = used + len(line) + 1
            if would > max_summary_chars and len(bullets) >= min_bullets:
                remaining = len(dropped) - len(bullets)
                if remaining > 0:
                    bullets.append(f"- …(+{remaining} more turns)")
                break
            bullets.append(line)
            used += len(line) + 1
        return header + "\n".join(bullets)

    def _truncate_to_budget(
        self,
        messages: list[dict[str, Any]],
        max_chars: int,
    ) -> list[dict[str, Any]]:
        """Hard-trim message contents from the end of the list backwards."""
        if self.estimate_chars(messages) <= max_chars:
            return messages
        out = [dict(m) for m in messages]
        # Drop non-system from the front until under budget (keep last msgs)
        while len(out) > 1 and self.estimate_chars(out) > max_chars:
            # never drop pure leading system block entirely if possible
            drop_idx = next(
                (i for i, m in enumerate(out) if m.get("role") != "system"),
                0,
            )
            if drop_idx == len(out) - 1 and len(out) > 1:
                # would drop last message — truncate its content instead
                break
            if out[drop_idx].get("role") != "system" or len(out) > 1:
                out.pop(drop_idx if out[drop_idx].get("role") != "system" else 0)
            else:
                break
        if self.estimate_chars(out) > max_chars and out:
            # Truncate largest content fields
            for m in out:
                content = str(m.get("content") or "")
                if len(content) > 64:
                    # binary-ish shrink
                    while self.estimate_chars(out) > max_chars and len(str(m.get("content") or "")) > 32:
                        c = str(m["content"])
                        m["content"] = c[: max(32, len(c) // 2)] + "…"
        return out

    def assemble(
        self,
        system_prompt: str,
        status_bar: AgentStatusBar | None,
        skill_snippets: Sequence[str] | None,
        memory_blocks: Sequence[str] | None,
        history_messages: Sequence[dict[str, Any]] | None,
        user_message: str,
    ) -> list[dict[str, Any]]:
        """Build message list: system → status → skills → memory → history → user."""
        messages: list[dict[str, Any]] = []

        # 1) system rules (stable prefix)
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        # 2) status bar (dynamic but isolated block)
        if status_bar is not None:
            messages.append(
                {"role": "system", "content": status_bar.format_block()}
            )

        # 3) skills (progressive disclosure snippets)
        skill_parts = [s.strip() for s in (skill_snippets or []) if s and str(s).strip()]
        if skill_parts:
            body = "[SKILLS]\n" + "\n\n".join(skill_parts)
            messages.append({"role": "system", "content": body})

        # 4) memory blocks
        mem_parts = [m.strip() for m in (memory_blocks or []) if m and str(m).strip()]
        if mem_parts:
            body = "[MEMORY]\n" + "\n\n".join(mem_parts)
            messages.append({"role": "system", "content": body})

        # 5) history (compressed if needed)
        history = [dict(m) for m in (history_messages or [])]
        # strip any system from history to avoid polluting stable prefix
        history = [m for m in history if m.get("role") != "system"]
        if history:
            # reserve room for user message + already assembled prefix
            prefix_chars = self.estimate_chars(messages)
            user_chars = len(user_message or "") + 8
            remaining = max(500, self.budget.max_chars - prefix_chars - user_chars)
            hist_budget = ContextBudget(
                max_chars=remaining,
                keep_recent_messages=self.budget.keep_recent_messages,
            )
            history = self.compress_history(history, hist_budget)
            messages.extend(history)

        # 6) current user message
        messages.append({"role": "user", "content": user_message or ""})

        # Final safety compress if still over budget (never drop the last user msg)
        if self.estimate_chars(messages) > self.budget.max_chars:
            last = messages[-1]
            head = messages[:-1]
            compressed_head = self.compress_history(head, self.budget)
            messages = compressed_head + [last]

        return messages
