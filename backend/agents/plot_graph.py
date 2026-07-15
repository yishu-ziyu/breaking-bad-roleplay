"""Personal plot graph builder - session-unique story net.

Research takeaway (what good plot nets do):
1. Spine first: time / beat order, not a spaghetti blob (iStoryline / XKCD narrative charts).
2. Dual layer: who-was-with-whom + what-changed / who-knows-what.
3. Personal: only this session's played facts, not full series canon.
4. Sparse edges: prefer irreversible costs, open tensions, spoken co-presence.
"""

from __future__ import annotations

import re
from typing import Any

from agents.continuity_board import (
    BOARD_OWNER_ID,
    BOARD_SUBJECT_ID,
    board_from_json,
    default_era_id,
    normalize_character_id,
)


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_一-鿿]+", "_", (text or "").strip())
    return (s.strip("_") or "node")[:48]


def parse_outline_beats(outline: str | None) -> list[dict[str, Any]]:
    """Turn numbered outline lines into ordered beat spine nodes.

    McKee spine meta (PROTAGONIST/SPINE/...) is stripped first so plot graphs
    only materialize playable beats.
    """
    if not outline:
        return []
    from agents.mckee_story import filter_playable_outline_lines

    playable = filter_playable_outline_lines(outline)
    if not playable:
        return []
    beats: list[dict[str, Any]] = []
    for raw in playable.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^(\d+)[\.\)、\s]+(.+)$", line)
        if m:
            idx = int(m.group(1)) - 1
            title = m.group(2).strip()
        else:
            idx = len(beats)
            title = line
        beats.append(
            {
                "id": f"beat_{idx}",
                "kind": "beat",
                "index": idx,
                "label": title[:120],
            }
        )
    return beats


def _char_node_id(name: str) -> str:
    """Stable id: prefer short era ids (walter) over display names."""
    cid = normalize_character_id(name) or _slug(name)
    return f"char_{_slug(cid)}"


def _char_label(name: str) -> str:
    return str(name).strip() or "unknown"


_CHAR_LABEL_ZH: dict[str, str] = {
    "walter": "沃尔特",
    "walter white": "沃尔特",
    "jesse": "杰西",
    "jesse pinkman": "杰西",
    "skyler": "斯凯勒",
    "skyler white": "斯凯勒",
    "saul": "索尔",
    "saul goodman": "索尔",
    "mike": "麦克",
    "mike ehrmantraut": "麦克",
    "gus": "古斯",
    "gus fring": "古斯",
    "hank": "汉克",
    "hank schrader": "汉克",
    "marie": "玛丽",
}


def _pick_localized_text(item: dict[str, Any] | str | None, language: str = "en") -> str:
    """Prefer text_zh when language is Chinese; never invent new prose."""
    lang = (language or "en").lower()
    if isinstance(item, str):
        return item
    if not isinstance(item, dict):
        return ""
    if lang.startswith("zh"):
        zh = item.get("text_zh") or item.get("label_zh")
        if zh:
            return str(zh)
    return str(item.get("text") or item.get("label") or "")


def _char_label_localized(name: str, language: str = "en") -> str:
    raw = str(name or "").strip()
    if not raw:
        return "unknown"
    if (language or "en").lower().startswith("zh"):
        key = raw.lower()
        if key in _CHAR_LABEL_ZH:
            return _CHAR_LABEL_ZH[key]
        # strip char_ prefix from node ids
        bare = key.replace("char_", "").replace("_", " ")
        if bare in _CHAR_LABEL_ZH:
            return _CHAR_LABEL_ZH[bare]
        # English full names still present
        for eng, zh in _CHAR_LABEL_ZH.items():
            if eng in key:
                return zh
        # last resort: run director normalizer if available
        try:
            from agents.director import normalize_zh_character_names
            return normalize_zh_character_names(raw)
        except Exception:
            return raw
    return raw



def characters_from_messages(
    messages: list[Any],
    language: str = "en",
) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for msg in messages or []:
        name = getattr(msg, "character_name", None) or (
            msg.get("character_name") if isinstance(msg, dict) else None
        )
        if not name:
            continue
        nid = _char_node_id(str(name))
        label = _char_label_localized(str(name), language)
        if nid not in seen:
            seen[nid] = {
                "id": nid,
                "kind": "character",
                "label": label,
                "speak_count": 0,
            }
        seen[nid]["speak_count"] += 1
    return list(seen.values())


def co_presence_edges(messages: list[Any]) -> list[dict[str, Any]]:
    """Connect characters who spoke in the same beat_id."""
    by_beat: dict[str, set[str]] = {}
    for msg in messages or []:
        if isinstance(msg, dict):
            name = msg.get("character_name")
            beat = msg.get("beat_id") or "default"
        else:
            name = getattr(msg, "character_name", None)
            beat = getattr(msg, "beat_id", None) or "default"
        if not name:
            continue
        by_beat.setdefault(str(beat), set()).add(str(name))

    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for names in by_beat.values():
        ordered = sorted(names)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1 :]:
                key = (a, b)
                if key in seen:
                    continue
                seen.add(key)
                edges.append(
                    {
                        "id": f"copres_{_slug(a)}_{_slug(b)}",
                        "source": _char_node_id(a),
                        "target": _char_node_id(b),
                        "kind": "co_presence",
                        "label": "shared scene",
                    }
                )
    return edges



def enrich_board_locale(board: dict[str, Any] | None, language: str = "en") -> dict[str, Any] | None:
    """For Chinese UI, fill missing text_zh from era pack by id (covers old sessions)."""
    if not board or not str(language).lower().startswith("zh"):
        return board
    try:
        from agents.continuity_board import load_era_pack
        pack = load_era_pack(str(board.get("era") or "s3_mid"))
    except Exception:
        return board
    out = dict(board)
    if not out.get("label_zh") and pack.get("label_zh"):
        out["label_zh"] = pack.get("label_zh")
    if not out.get("label") and pack.get("label"):
        out["label"] = pack.get("label")
    fact_zh = {
        str(f.get("id")): f.get("text_zh")
        for f in (pack.get("shared_facts") or [])
        if isinstance(f, dict) and f.get("id") and f.get("text_zh")
    }
    ten_zh = {
        str(t.get("id")): t.get("text_zh")
        for t in (pack.get("open_tensions") or [])
        if isinstance(t, dict) and t.get("id") and t.get("text_zh")
    }
    facts = []
    for f in out.get("shared_facts") or []:
        if not isinstance(f, dict):
            facts.append(f)
            continue
        nf = dict(f)
        if not nf.get("text_zh"):
            zh = fact_zh.get(str(nf.get("id") or ""))
            if zh:
                nf["text_zh"] = zh
        facts.append(nf)
    out["shared_facts"] = facts
    tensions = []
    for t in out.get("open_tensions") or []:
        if not isinstance(t, dict):
            tensions.append(t)
            continue
        nt = dict(t)
        if not nt.get("text_zh"):
            zh = ten_zh.get(str(nt.get("id") or ""))
            if zh:
                nt["text_zh"] = zh
        tensions.append(nt)
    out["open_tensions"] = tensions
    return out


def board_layers(
    board: dict[str, Any] | None,
    language: str = "en",
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (fact_nodes, tension_edges, cost_nodes) from continuity board."""
    if not board:
        return [], [], []
    facts: list[dict[str, Any]] = []
    for f in board.get("shared_facts") or []:
        if not isinstance(f, dict):
            continue
        fid = str(f.get("id") or _slug(str(f.get("text") or "fact")))
        label = _pick_localized_text(f, language) or fid
        facts.append(
            {
                "id": f"fact_{_slug(fid)}",
                "kind": "fact",
                "label": label[:160],
                "known_by": list(f.get("known_by") or []),
                "irreversible": bool(f.get("irreversible")),
            }
        )
    tensions: list[dict[str, Any]] = []
    for t in board.get("open_tensions") or []:
        if not isinstance(t, dict):
            continue
        parties = [str(p) for p in (t.get("parties") or [])]
        label = _pick_localized_text(t, language) or "tension"
        if len(parties) < 2:
            # still keep as node-like edge stub to primary party if any
            if parties:
                tensions.append(
                    {
                        "id": f"ten_{_slug(str(t.get('id') or t.get('text')))}",
                        "source": _char_node_id(parties[0]),
                        "target": _char_node_id(parties[0]),
                        "kind": "tension",
                        "label": label[:120],
                    }
                )
            continue
        # connect sequential party pairs so multi-party tension is visible
        for i in range(len(parties) - 1):
            a, b = parties[i], parties[i + 1]
            tensions.append(
                {
                    "id": f"ten_{_slug(str(t.get('id') or t.get('text')))}_{i}",
                    "source": _char_node_id(a),
                    "target": _char_node_id(b),
                    "kind": "tension",
                    "label": label[:120],
                }
            )
    costs: list[dict[str, Any]] = []
    for i, c in enumerate(board.get("irreversible_costs") or []):
        if isinstance(c, str):
            cost_text = c
        else:
            cost_text = _pick_localized_text(c, language) or str((c or {}).get("text") or c)
        if not cost_text:
            continue
        costs.append(
            {
                "id": f"cost_{i}",
                "kind": "cost",
                "label": cost_text[:160],
            }
        )
    return facts, tensions, costs


def knowledge_edges(fact_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for fact in fact_nodes:
        for who in fact.get("known_by") or []:
            edges.append(
                {
                    "id": f"knows_{_slug(who)}_{fact['id']}",
                    "source": _char_node_id(str(who)),
                    "target": fact["id"],
                    "kind": "knows",
                    "label": "knows",
                }
            )
    return edges


def spine_edges(beats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    ordered = sorted(beats, key=lambda b: b.get("index", 0))
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        edges.append(
            {
                "id": f"spine_{a['id']}_{b['id']}",
                "source": a["id"],
                "target": b["id"],
                "kind": "spine",
                "label": "then",
            }
        )
    return edges


def to_mermaid(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> str:
    """Readable export; UI can also render nodes/edges directly."""
    lines = ["flowchart LR"]
    for n in nodes:
        nid = _slug(n["id"])
        label = str(n.get("label") or n["id"]).replace('"', "'")[:60]
        kind = n.get("kind")
        if kind == "character":
            lines.append(f'  {nid}(["{label}"])')
        elif kind == "beat":
            lines.append(f'  {nid}["{label}"]')
        elif kind == "cost":
            lines.append(f'  {nid}{{{{{label}}}}}')
        else:
            lines.append(f'  {nid}("{label}")')
    for e in edges:
        s = _slug(e["source"])
        t = _slug(e["target"])
        kind = e.get("kind") or "link"
        lab = str(e.get("label") or kind).replace('"', "'")[:40]
        if kind == "spine":
            lines.append(f"  {s} --> {t}")
        elif kind == "tension":
            lines.append(f'  {s} -. "{lab}" .-> {t}')
        else:
            lines.append(f'  {s} -- "{lab}" --- {t}')
    return "\n".join(lines)


def build_plot_graph(
    *,
    session_id: str,
    title: str | None = None,
    task_prompt: str | None = None,
    outline: str | None = None,
    messages: list[Any] | None = None,
    board: dict[str, Any] | None = None,
    language: str = "en",
) -> dict[str, Any]:
    """Assemble the personal plot graph for one session."""
    messages = messages or []
    board = enrich_board_locale(board, language)
    beats = parse_outline_beats(outline)
    chars = characters_from_messages(messages, language=language)
    facts, tensions, costs = board_layers(board, language=language)
    # Ensure character nodes exist for board known_by even if they never spoke
    char_ids = {c["id"] for c in chars}
    for fact in facts:
        for who in fact.get("known_by") or []:
            cid = _char_node_id(str(who))
            if cid not in char_ids:
                chars.append(
                    {
                        "id": cid,
                        "kind": "character",
                        "label": _char_label_localized(str(who), language),
                        "speak_count": 0,
                    }
                )
                char_ids.add(cid)
    for ten in tensions:
        for key in ("source", "target"):
            cid = ten.get(key)
            if cid and cid not in char_ids and str(cid).startswith("char_"):
                label = str(cid).replace("char_", "")
                chars.append(
                    {
                        "id": cid,
                        "kind": "character",
                        "label": _char_label_localized(label, language),
                        "speak_count": 0,
                    }
                )
                char_ids.add(cid)

    nodes = [*beats, *chars, *facts, *costs]
    edges = [
        *spine_edges(beats),
        *co_presence_edges(messages),
        *tensions,
        *knowledge_edges(facts),
    ]
    # Cap spaghetti: prefer spine + tension + co_presence; trim excess knows
    knows = [e for e in edges if e.get("kind") == "knows"]
    other = [e for e in edges if e.get("kind") != "knows"]
    if len(knows) > 24:
        knows = knows[:24]
    edges = other + knows

    return {
        "session_id": session_id,
        "title": title or "Untitled session",
        "task_prompt": task_prompt or "",
        "era": (
            ((board or {}).get("label_zh") if str(language).lower().startswith("zh") else None)
            or (board or {}).get("label")
            or (board or {}).get("era")
            or default_era_id()
        ),
        "summary": {
            "beat_count": len(beats),
            "character_count": len(chars),
            "fact_count": len(facts),
            "tension_count": len([e for e in edges if e.get("kind") == "tension"]),
            "cost_count": len(costs),
            "spoken_lines": len(messages),
        },
        "nodes": nodes,
        "edges": edges,
        "mermaid": to_mermaid(nodes, edges),
    }


async def load_board_for_session(session_factory: Any, session_id: str) -> dict[str, Any] | None:
    if session_factory is None or not session_id:
        return None
    from sqlalchemy import select
    from db.models import CharacterDossier

    async with session_factory() as sess:
        stmt = select(CharacterDossier).where(
            CharacterDossier.session_id == session_id,
            CharacterDossier.owner_id == BOARD_OWNER_ID,
            CharacterDossier.subject_id == BOARD_SUBJECT_ID,
        )
        result = await sess.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return board_from_json(row.knowledge)
