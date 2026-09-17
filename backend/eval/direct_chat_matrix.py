#!/usr/bin/env python3
"""Live Direct chat matrix: characters × relations × forward-ask regression.

Run: cd backend && uv run python eval/direct_chat_matrix.py
Exit 0 only when all cases pass.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

BASE = "http://127.0.0.1:8001/api/chat"

# Coarse anchors actually offered in App (trimmed lists).
MATRIX: list[tuple[str, str]] = [
    ("walter", "former student"),
    ("walter", "family member"),
    ("walter", "DEA liability"),
    ("walter", "lab partner"),
    ("jesse", "partner"),
    ("jesse", "old friend"),
    ("jesse", "person he disappointed"),
    ("jesse", "dealer contact"),
    ("skyler", "spouse"),
    ("skyler", "neighbor"),
    ("skyler", "person hiding something"),
    ("skyler", "family member"),
    ("mike", "asset"),
    ("mike", "employer"),
    ("mike", "loose end"),
    ("mike", "person under protection"),
    ("saul", "client"),
    ("saul", "business partner"),
    ("saul", "problem to solve"),
    ("saul", "witness"),
    ("gus", "employee"),
    ("gus", "guest"),
    ("gus", "person being evaluated"),
    ("gus", "supplier"),
    ("hank", "family member"),
    ("hank", "suspect under watch"),
    ("hank", "DEA partner"),
    ("hank", "friend of the family"),
    ("marie", "Skyler sister-in-law"),
    ("marie", "Hank spouse"),
    ("marie", "neighbor"),
]

ASSISTANT_MARKERS = [
    "总的来说",
    "如果你愿意",
    "我理解你的感受",
    "how can i help",
    "if you'd like",
    "1.",
    "2.",
    "- ",
]

LOOP_MARKERS = [
    r"昨天.*(才|现在).*(说|告诉)",
    r"今天才跟我",
    r"怎么现在才",
    r"被揍了.*今天",
    r"才告诉我",
]

FORWARD_MARKERS = [
    r"现金|货|钱|车|报警|条子|医院|躲|走|去|电话|打给|先|别|门|车里|地址|谁干的|名字|证据",
    r"怎么办|怎么做",  # reflecting plan ok if paired with move
    r"\?|？",
]

# Character must not vocatively address the player as itself.
SELF_NAME_BY_CHAR = {
    "walter": ("沃尔特", "怀特", "Walter", "Heisenberg", "海森堡"),
    "jesse": ("杰西", "Jesse", "Pinkman"),
    "skyler": ("天际", "斯凯勒", "Skyler"),
    "saul": ("索尔", "Saul", "Goodman"),
    "mike": ("迈克", "麦克", "Mike"),
    "gus": ("古斯", "Gus", "Fring"),
    "hank": ("汉克", "Hank"),
    "marie": ("玛丽", "Marie"),
}


@dataclass
class CaseResult:
    character: str
    relation: str
    ok: bool
    reply: str
    reasons: list[str]


def post_chat(character_id: str, relation: str, user_input: str, history: list[dict]) -> dict:
    body = {
        "characterId": character_id,
        "userInput": user_input,
        "relation": relation,
        "mode": "direct",
        "language": "zh",
        "llmProvider": "minimax",
        "history": history,
        "memoryOpening": [],
        "memoryDigest": "",
        "durableMemory": (
            "Relationship memory (background only):\n"
            "The player's latest message has priority. Do not reopen these beats unless they do.\n"
            "- [open_thread] user: 昨天被人抢了"
        ),
    }
    req = urllib.request.Request(
        BASE,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def score_forward_reply(reply: str, character_id: str = "") -> list[str]:
    reasons: list[str] = []
    text = (reply or "").strip()
    if not text:
        return ["empty_reply"]
    if text.startswith("{") or '"reply_text"' in text or '"emotion_state"' in text:
        reasons.append("json_leak")
    lower = text.lower()
    for m in ASSISTANT_MARKERS:
        if m.lower() in lower or m in text:
            # allow "?" alone; bare "- " in dialogue is rare — only flag list-like
            if m in ("1.", "2.", "- ") and not re.search(r"(^|\n)\s*([1-9]\.|- )\s+\S", text):
                continue
            reasons.append(f"assistant_marker:{m}")
    latin = sum(1 for c in text if c.isalpha() and ord(c) < 128)
    letters = sum(1 for c in text if c.isalpha())
    if letters and latin / letters > 0.55:
        reasons.append("english_leak")
    loop_hit = any(re.search(p, text) for p in LOOP_MARKERS)
    forward_hit = any(re.search(p, text) for p in FORWARD_MARKERS)
    if loop_hit and not forward_hit:
        reasons.append("loop_without_forward")
    if loop_hit and len(text) < 40 and not forward_hit:
        reasons.append("short_loop_only")
    # Must not ignore 怎么办 with pure yesterday scold
    if re.search(r"昨天", text) and re.search(r"才", text) and not forward_hit:
        reasons.append("yesterday_scold_only")
    # Pure echo of the ask with no move
    if re.fullmatch(r"那你说怎么办[？?]?", text):
        reasons.append("echo_only")
    for name in SELF_NAME_BY_CHAR.get(character_id, ()):
        if re.search(rf"(^|[，,。！？!?\s]){re.escape(name)}([，,。！？!?\s]|$)", text) or text.startswith(name):
            reasons.append(f"self_address:{name}")
            break
    return reasons


def build_crisis_history(character_id: str) -> list[dict]:
    """Fixed mid-crisis thread ending right before 怎么办."""
    return [
        {"sender": character_id, "text": "你来了就说。别兜圈子。"},
        {"sender": "user", "text": "昨天被人抢了"},
        {"sender": character_id, "text": "什么时候的事。在哪。人呢。"},
        {"sender": "user", "text": "在外面，东西没了，人跑了"},
        {"sender": character_id, "text": "你怎么现在才说。伤着没有。"},
    ]


def run_case(character_id: str, relation: str) -> CaseResult:
    history = build_crisis_history(character_id)
    try:
        data = post_chat(character_id, relation, "那你说怎么办？", history)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return CaseResult(character_id, relation, False, body[:300], [f"http_{e.code}"])
    except Exception as e:  # noqa: BLE001 — matrix harness
        return CaseResult(character_id, relation, False, "", [f"exc:{type(e).__name__}:{e}"])

    reply = str(data.get("reply_text") or "")
    reasons = score_forward_reply(reply, character_id=character_id)
    if data.get("error"):
        reasons.append(f"api_error:{data.get('error')}")
    # Soft signal: structured emotion missing too often means envelope drift.
    if not data.get("emotion_state"):
        reasons.append("missing_emotion")
    return CaseResult(character_id, relation, not reasons, reply, reasons)


def main() -> int:
    results: list[CaseResult] = []
    for character_id, relation in MATRIX:
        r = run_case(character_id, relation)
        results.append(r)
        status = "PASS" if r.ok else "FAIL"
        preview = r.reply.replace("\n", " / ")[:120]
        print(f"[{status}] {character_id}/{relation}: {preview}")
        if r.reasons:
            print(f"       reasons={r.reasons}")

    failed = [r for r in results if not r.ok]
    print("---")
    print(f"total={len(results)} pass={len(results) - len(failed)} fail={len(failed)}")
    if failed:
        print("FAILED_CASES:")
        for r in failed:
            print(f"  - {r.character}/{r.relation}: {r.reasons}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
