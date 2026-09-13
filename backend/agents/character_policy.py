"""Compiled character policy + per-turn ActorView.

One source: the existing Character Policy Card (system prompt) plus optional
era overlay from Character Intelligence. Play mode (direct/crew/story) must
not fork a second personality definition — only the compiled version hash
is compared across adapters.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from agents.character_intelligence import format_intelligence_prompt_block
from agents.characters.gus import GUS_SYSTEM_PROMPT
from agents.characters.hank import HANK_SYSTEM_PROMPT
from agents.characters.jesse import JESSE_SYSTEM_PROMPT
from agents.characters.marie import MARIE_SYSTEM_PROMPT
from agents.characters.mike import MIKE_SYSTEM_PROMPT
from agents.characters.saul import SAUL_SYSTEM_PROMPT
from agents.characters.skyler import SKYLER_SYSTEM_PROMPT
from agents.characters.walter import WALTER_SYSTEM_PROMPT
from agents.continuity_board import filter_board_for_character, normalize_character_id
from agents.narrative_contracts import backend_to_actor_id

_CORE_PROMPTS: dict[str, str] = {
    "walter": WALTER_SYSTEM_PROMPT,
    "jesse": JESSE_SYSTEM_PROMPT,
    "skyler": SKYLER_SYSTEM_PROMPT,
    "saul": SAUL_SYSTEM_PROMPT,
    "mike": MIKE_SYSTEM_PROMPT,
    "gus": GUS_SYSTEM_PROMPT,
    "hank": HANK_SYSTEM_PROMPT,
    "marie": MARIE_SYSTEM_PROMPT,
}


def _hash_parts(*parts: str) -> str:
    h = hashlib.sha256()
    for part in parts:
        h.update((part or "").encode("utf-8"))
        h.update(b"\x1e")
    return h.hexdigest()[:16]


@dataclass(frozen=True)
class CharacterPolicy:
    actor_id: str
    core_prompt: str
    era: str
    era_overlay: str
    version: str
    play_mode: str = ""


@dataclass
class ActorView:
    policy: CharacterPolicy
    relation: str = ""
    session_id: str = ""
    play_mode: str = "direct"
    audience_ids: list[str] = field(default_factory=list)
    visible_facts: list[str] = field(default_factory=list)
    world_mode: str = "alternate"

    def prompt_block(self) -> str:
        """Player-facing policy + this turn's relation and known facts.

        Session id is routing metadata and is intentionally omitted.
        """
        chunks = [self.policy.core_prompt.strip()]
        if self.policy.era_overlay:
            chunks.append(self.policy.era_overlay.strip())
        rel = (self.relation or "").strip()
        if rel:
            chunks.append(
                "PLAYER RELATION (this turn — apply the matching RELATION TO PLAYER "
                f"tactic from the policy card): {rel}"
            )
        if self.audience_ids:
            chunks.append(
                "AUDIENCE (who can hear this line): "
                + ", ".join(self.audience_ids)
            )
        if self.visible_facts:
            fact_lines = "\n".join(f"- {f}" for f in self.visible_facts if f)
            chunks.append(
                "VISIBLE FACTS (this character may use these; do not invent "
                f"contradicting public facts):\n{fact_lines}"
            )
        return "\n\n".join(chunks)


def compile_character_policy(
    character_id: str | None,
    *,
    era: str = "",
    play_mode: str = "",
) -> CharacterPolicy:
    actor = backend_to_actor_id(character_id) or normalize_character_id(character_id)
    core = _CORE_PROMPTS.get(actor) or WALTER_SYSTEM_PROMPT
    overlay = format_intelligence_prompt_block(actor, era or None) or ""
    # Play mode is an adapter, not a personality fork — omit from the hash.
    version = _hash_parts(actor, core, overlay)
    return CharacterPolicy(
        actor_id=actor or "walter",
        core_prompt=core,
        era=era or "",
        era_overlay=overlay,
        version=version,
        play_mode=play_mode,
    )


def compile_actor_view(
    character_id: str | None,
    *,
    relation: str = "",
    session_id: str = "",
    play_mode: str = "direct",
    era: str = "",
    audience_ids: list[str] | None = None,
    visible_facts: list[str] | None = None,
    world_mode: str = "alternate",
    board: dict[str, Any] | None = None,
) -> ActorView:
    policy = compile_character_policy(character_id, era=era, play_mode=play_mode)
    facts = list(visible_facts or [])
    if board is not None and not facts:
        view = filter_board_for_character(board, policy.actor_id)
        for fact in view.get("shared_facts") or []:
            if isinstance(fact, dict):
                text = str(fact.get("text") or "").strip()
                if text:
                    facts.append(text)
    return ActorView(
        policy=policy,
        relation=relation,
        session_id=session_id or "",
        play_mode=play_mode,
        audience_ids=list(audience_ids or []),
        visible_facts=facts,
        world_mode=world_mode,
    )
