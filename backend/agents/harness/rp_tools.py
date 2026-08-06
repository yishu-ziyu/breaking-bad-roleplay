"""RP-domain tools: perception / execution / collaboration (ai-agent-book ch4)."""

from __future__ import annotations

import json
import re
from typing import Any

from agents.harness.verify import (
    ALLOWED_EMOTIONS,
    check_user_input,
    validate_action_verb,
)
from agents.tools import Tool, ToolRegistry, ToolResult

PLAYABLE_CAST: list[dict[str, str]] = [
    {"id": "walter", "name_en": "Walter", "name_zh": "沃尔特", "role": "chemist / empire"},
    {"id": "jesse", "name_en": "Jesse", "name_zh": "杰西", "role": "partner / conscience"},
    {"id": "skyler", "name_en": "Skyler", "name_zh": "斯凯勒", "role": "family pressure"},
    {"id": "saul", "name_en": "Saul", "name_zh": "索尔", "role": "criminal lawyer comic"},
    {"id": "mike", "name_en": "Mike", "name_zh": "麦克", "role": "fixer / logistics"},
    {"id": "gus", "name_en": "Gus", "name_zh": "古斯", "role": "controlled threat"},
    {"id": "hank", "name_en": "Hank", "name_zh": "汉克", "role": "DEA / family"},
    {"id": "marie", "name_en": "Marie", "name_zh": "玛丽", "role": "family / minerals"},
]

_PLAYABLE_IDS = {c["id"] for c in PLAYABLE_CAST}

# Offline ABQ dossiers (fictional lore only)
_DOSSIERS: dict[str, dict[str, str]] = {
    "walter": {
        "jesse": "Former student; volatile loyalty; Walt manipulates via pride and fear.",
        "skyler": "Wife; increasingly aware; Walt frames control as protection.",
        "hank": "Brother-in-law DEA; Walt performs the mild schoolteacher.",
    },
    "jesse": {
        "walter": "Mr. White — mentor and abuser of trust; love/hate.",
        "mike": "Respects competence; fears becoming disposable.",
    },
    "hank": {
        "walter": "Family; does not yet see the full shadow (depends on arc).",
        "marie": "Wife; protective banter; minerals / beers life texture.",
    },
    "skyler": {
        "walter": "Husband; money and lies erode trust.",
        "marie": "Sister; complicated support.",
    },
    "saul": {"walter": "Client with leverage; comic distance."},
    "mike": {"walter": "Amateur risk; prefers clean ops."},
    "gus": {"walter": "Useful until not; polite threat."},
    "marie": {
        "hank": "Husband; fierce protectiveness.",
        "skyler": "Sister; opinionated support.",
    },
}

_DEFAULT_CONTINUITY = [
    "Pollos Hermanos is Gus's front.",
    "The superlab sits under the industrial laundry.",
    "Hank collects minerals; Marie prefers purple.",
    "Saul's office is beside a nail salon.",
]


def _refuse_if_unsafe(text: str) -> ToolResult | None:
    ok, reason = check_user_input(text or "")
    if not ok:
        return ToolResult(
            content=f"Refused: real-world crime how-to is blocked ({reason}). Stay fictional.",
            is_error=True,
        )
    return None


def build_default_registry(
    session_state: dict[str, Any] | None = None,
) -> tuple[list[Tool], ToolRegistry]:
    state = session_state if session_state is not None else {}
    state.setdefault("notes", [])
    state.setdefault("handoffs", [])
    state.setdefault("emotions", {})
    state.setdefault("proposed_actions", [])
    # Seed canon continuity if missing OR empty (setdefault alone won't fill [])
    if not state.get("continuity"):
        state["continuity"] = list(_DEFAULT_CONTINUITY)

    tools: list[Tool] = []
    reg = ToolRegistry()

    # --- Perception ---
    t_recall = Tool(
        name="recall_dossier",
        description="Recall relationship knowledge about a character (fictional ABQ lore).",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "character_id": {"type": "string"},
                "about": {"type": "string"},
            },
            "required": ["character_id"],
        },
    )

    async def _recall(args: dict) -> ToolResult:
        cid = str(args.get("character_id") or "").lower().strip()
        about = str(args.get("about") or "").lower().strip()
        blocked = _refuse_if_unsafe(f"{cid} {about}")
        if blocked:
            return blocked
        if cid not in _PLAYABLE_IDS:
            return ToolResult(content=f"unknown character: {cid}", is_error=True)
        relations = dict(_DOSSIERS.get(cid) or {})
        if about:
            if about in relations:
                relations = {about: relations[about]}
            else:
                relations = {
                    k: v
                    for k, v in relations.items()
                    if about in k or about in v.lower()
                }
        return ToolResult(
            content=json.dumps(
                {"character_id": cid, "relations": relations},
                ensure_ascii=False,
            )
        )

    tools.append(t_recall)
    reg.register_tool(t_recall, _recall)

    t_search = Tool(
        name="search_continuity",
        description="Search session continuity notes by keyword.",
        parameters_json_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    )

    async def _search(args: dict) -> ToolResult:
        q = str(args.get("query") or "")
        blocked = _refuse_if_unsafe(q)
        if blocked:
            return blocked
        ql = q.lower()
        # Tokenize: match if any contentful token hits (not only full-string containment)
        tokens = [t for t in re.findall(r"[a-zA-Z0-9_\u4e00-\u9fff]+", ql) if len(t) >= 3]
        stop = {"search", "continuity", "query", "the", "and", "for", "with", "查", "搜索"}
        tokens = [t for t in tokens if t not in stop]
        notes = list(state.get("continuity") or []) + list(state.get("notes") or [])
        matches: list[str] = []
        for n in notes:
            hay = str(n).lower()
            if ql and ql in hay:
                matches.append(str(n))
                continue
            if tokens and any(t in hay for t in tokens):
                matches.append(str(n))
        return ToolResult(
            content=json.dumps(
                {
                    "query": q,
                    "tokens": tokens,
                    "match_count": len(matches),
                    "matches": matches[:20],
                },
                ensure_ascii=False,
            )
        )

    tools.append(t_search)
    reg.register_tool(t_search, _search)

    t_cast = Tool(
        name="list_cast",
        description="List playable cast ids and display names.",
        parameters_json_schema={"type": "object", "properties": {}},
    )

    async def _cast(_args: dict) -> ToolResult:
        return ToolResult(
            content=json.dumps({"cast": PLAYABLE_CAST}, ensure_ascii=False)
        )

    tools.append(t_cast)
    reg.register_tool(t_cast, _cast)

    # --- Execution ---
    t_action = Tool(
        name="propose_action",
        description="Propose a stage action using the closed action ontology.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "verb": {"type": "string"},
                "target_id": {"type": "string"},
                "destination_anchor": {"type": "string"},
            },
            "required": ["verb"],
        },
    )

    async def _action(args: dict) -> ToolResult:
        verb = str(args.get("verb") or "").lower()
        if not validate_action_verb(verb):
            return ToolResult(content=f"invalid verb: {verb}", is_error=True)
        payload = {
            "verb": verb,
            "target_id": args.get("target_id"),
            "destination_anchor": args.get("destination_anchor"),
            "status": "accepted",
        }
        state["proposed_actions"].append(payload)
        return ToolResult(content=json.dumps(payload))

    tools.append(t_action)
    reg.register_tool(t_action, _action)

    t_note = Tool(
        name="update_working_note",
        description="Append a short working note to session state.",
        parameters_json_schema={
            "type": "object",
            "properties": {"note": {"type": "string"}},
            "required": ["note"],
        },
    )

    async def _note(args: dict) -> ToolResult:
        note = str(args.get("note") or "").strip()
        if not note:
            return ToolResult(content="empty note", is_error=True)
        blocked = _refuse_if_unsafe(note)
        if blocked:
            return blocked
        state["notes"].append(note)
        state["continuity"].append(note)
        return ToolResult(
            content=json.dumps({"stored": True, "count": len(state["notes"])})
        )

    tools.append(t_note)
    reg.register_tool(t_note, _note)

    t_emo = Tool(
        name="set_emotion",
        description="Set character emotion to an allowed enum value.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "character_id": {"type": "string"},
                "emotion": {"type": "string"},
            },
            "required": ["emotion"],
        },
    )

    async def _emo(args: dict) -> ToolResult:
        emo = str(args.get("emotion") or "").lower()
        cid = str(args.get("character_id") or "current").lower()
        if emo not in ALLOWED_EMOTIONS:
            return ToolResult(
                content=f"invalid emotion; allowed={sorted(ALLOWED_EMOTIONS)}",
                is_error=True,
            )
        state["emotions"][cid] = emo
        state["emotions"]["current"] = emo
        return ToolResult(content=json.dumps({"character_id": cid, "emotion": emo}))

    tools.append(t_emo)
    reg.register_tool(t_emo, _emo)

    # --- Collaboration ---
    t_dir = Tool(
        name="ask_director",
        description="Ask the story director for beat-level advice (offline stub).",
        parameters_json_schema={
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "required": ["question"],
        },
    )

    async def _dir(args: dict) -> ToolResult:
        q = str(args.get("question") or "")
        blocked = _refuse_if_unsafe(q)
        if blocked:
            return blocked
        brief = {
            "type": "director_brief",
            "offline": True,
            "advice": "Raise pressure via a value gap; force a choice that costs pride or family.",
            "beat_hint": "progressive_complication",
            "question": q[:200],
        }
        return ToolResult(content=json.dumps(brief, ensure_ascii=False))

    tools.append(t_dir)
    reg.register_tool(t_dir, _dir)

    t_hand = Tool(
        name="handoff_to_character",
        description="Record an intent to hand the scene to another character.",
        parameters_json_schema={
            "type": "object",
            "properties": {
                "character_id": {"type": "string"},
                "brief": {"type": "string"},
            },
            "required": ["character_id"],
        },
    )

    async def _hand(args: dict) -> ToolResult:
        cid = str(args.get("character_id") or "").lower()
        if cid not in _PLAYABLE_IDS:
            return ToolResult(content=f"unknown character: {cid}", is_error=True)
        item = {"character_id": cid, "brief": str(args.get("brief") or "")[:300]}
        state["handoffs"].append(item)
        return ToolResult(content=json.dumps({"handoff": item}))

    tools.append(t_hand)
    reg.register_tool(t_hand, _hand)

    return tools, reg
