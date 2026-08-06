"""McKee *Story* engine helpers for interactive Story mode.

v1: spine + tagged beats + value turn + gap.
v2 (skill pack push): controlling idea, three conflict levels, emotional
polarity alternation, desire∝risk, opposition fire parity, scene hinge,
inside-out character pressure, crisis dilemma types, climax inevitable+surprise.

Skill sources (local extract under 故事/*):
  story-structure-hierarchy-system, story-structure-design,
  inciting-incident-design, scene-dynamics, scene-writing-method,
  conflict-and-opposition-design, value-progression-design,
  theme-controlling-idea, emotional-dynamics, protagonist-design,
  climax-resolution.

Does NOT change the SSE event schema core types. Optional fields only:
  outline.mckee_spine, scene_change.mckee_role, beat_ready.mckee_role.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Playable beat functions (McKee hierarchy scaled for interactive sessions).
BEAT_ROLES: tuple[str, ...] = (
    "setup",
    "inciting",
    "progressive",
    "crisis",
    "climax",
    "resolution",
)

_ROLE_RE = re.compile(
    r"\[(?P<role>setup|inciting|progressive|crisis|climax|resolution)\]",
    re.IGNORECASE,
)

# Craft fields that belong in the outline / director, never on the player stage.
_CRAFT_FIELD_CUT_RE = re.compile(
    r"\s*[—–\-]\s*(?:value|gap|risk|VALUE|GAP|RISK)\s*[:：]",
    re.IGNORECASE,
)
_LEAD_NUMBER_RE = re.compile(r"^\d+[.)、]\s*")
_ROLE_TAG_RE = re.compile(
    r"\[(?:setup|inciting|progressive|crisis|climax|resolution)\]\s*",
    re.IGNORECASE,
)

# Ending charge of a value turn: value: A→B  (B's polarity if we can guess)
_VALUE_TURN_RE = re.compile(
    r"value\s*:\s*([^—\-\n]+?)(?:→|->|=>|→)([^—\-\n]+)",
    re.IGNORECASE,
)


def player_facing_scene_label(scene_desc: str | None, *, max_len: int = 40) -> str:
    """Location-only label for HUD / to_scene (no McKee craft tags).

    Input example:
      ``[progressive] 怀特家餐厅 — 沃尔特: 启用索尔的毒计 — value: … — risk: 高``
    Output:
      ``怀特家餐厅``
    """
    s = (scene_desc or "").strip()
    if not s:
        return ""
    s = _LEAD_NUMBER_RE.sub("", s)
    s = _ROLE_TAG_RE.sub("", s)
    s = _CRAFT_FIELD_CUT_RE.split(s, maxsplit=1)[0].strip()
    # First em/en-dash segment is the place name in McKee outline lines.
    loc = re.split(r"\s*[—–]\s*", s, maxsplit=1)[0].strip()
    loc = re.sub(r"\s+", " ", loc).strip(" -—–")
    if not loc:
        loc = s
    if len(loc) > max_len:
        return loc[: max_len - 1] + "…"
    return loc


def player_facing_scene_blurb(scene_desc: str | None, *, max_len: int = 72) -> str:
    """Player-readable scene blurb without value/gap/risk engineering fields.

    Keeps place + dramatic hook; drops craft scaffolding.
    """
    s = (scene_desc or "").strip()
    if not s:
        return ""
    s = _LEAD_NUMBER_RE.sub("", s)
    s = _ROLE_TAG_RE.sub("", s)
    s = _CRAFT_FIELD_CUT_RE.split(s, maxsplit=1)[0].strip()
    s = re.sub(r"\s+", " ", s).strip(" -—–")
    if not s:
        return player_facing_scene_label(scene_desc, max_len=max_len)
    if len(s) > max_len:
        return s[: max_len - 1] + "…"
    return s

# Heuristic negative-leaning tokens (EN + ZH) for polarity alternation.
_NEG_TOKENS = (
    "unease",
    "imbalance",
    "suspicion",
    "doubt",
    "betray",
    "break",
    "chaos",
    "fear",
    "guilt",
    "loss",
    "ruin",
    "exposure",
    "danger",
    "crisis",
    "dilemma",
    "不安",
    "失衡",
    "怀疑",
    "背叛",
    "决裂",
    "混乱",
    "恐惧",
    "内疚",
    "崩",
    "暴露",
    "危险",
    "两难",
    "废墟",
    "绝望",
)
_POS_TOKENS = (
    "safety",
    "order",
    "trust",
    "loyalty",
    "hope",
    "control",
    "truth",
    "family",
    "relief",
    "balance",
    "win",
    "secure",
    "安全",
    "秩序",
    "信任",
    "忠诚",
    "希望",
    "控制",
    "真相",
    "家庭",
    "释然",
    "平衡",
    "胜",
)

_ROLE_BY_COUNT: dict[int, tuple[str, ...]] = {
    4: ("setup", "inciting", "crisis", "climax"),
    5: ("setup", "inciting", "progressive", "crisis", "climax"),
    6: ("setup", "inciting", "progressive", "crisis", "climax", "resolution"),
    7: (
        "setup",
        "inciting",
        "progressive",
        "progressive",
        "crisis",
        "climax",
        "resolution",
    ),
    8: (
        "setup",
        "inciting",
        "progressive",
        "progressive",
        "progressive",
        "crisis",
        "climax",
        "resolution",
    ),
}

_ROLE_INSTRUCTIONS: dict[str, str] = {
    "setup": (
        "SETUP: Establish ordinary balance and loaded values before the world tips. "
        "Show conscious desire seeds; minimal exposition. "
        "Protagonist willpower and empathy must already be legible."
    ),
    "inciting": (
        "INCITING INCIDENT: Dynamic on-screen event that radically unbalances life, "
        "sparks conscious desire (and preferably contradicts unconscious desire), "
        "launches the quest, and raises the major dramatic question. Not a address change."
    ),
    "progressive": (
        "PROGRESSIVE COMPLICATION: Gap cycle - act → unexpected opposition → "
        "reframe reality → raise risk → harder act. Never weaken force or repeat "
        "a lower-stakes action. Desire value ∝ risk the character will accept."
    ),
    "crisis": (
        "CRISIS (dilemma, not a quiz): Type A two irreconcilable goods, or Type B "
        "lesser of two evils, or Type C mixed. Last free choice under maximum "
        "concentrated opposition. Hold the static pressure moment on-screen."
    ),
    "climax": (
        "CLIMAX: Absolute irreversible value change that answers MAJOR_QUESTION. "
        "Must feel inevitable in hindsight and surprising in the moment. Pure action "
        "over explanation. Express CONTROLLING_IDEA (value + cause) without preaching."
    ),
    "resolution": (
        "RESOLUTION aftershock only: show new balance/ruin, optional subplot echo, "
        "emotional buffer. Do not start a new quest."
    ),
}

# Preferred conflict-layer mix by role (inner / personal / extra-personal).
_ROLE_CONFLICT_FOCUS: dict[str, str] = {
    "setup": "personal (+ light inner)",
    "inciting": "extra-personal hitting personal",
    "progressive": "all three layers if possible; at least personal + one other",
    "crisis": "inner dilemma forced by personal/extra-personal pressure",
    "climax": "all three layers collide; irreversible public or intimate action",
    "resolution": "personal aftershock; brief inner residue",
}

_META_KEY_RE = re.compile(
    r"^(PROTAGONIST|SPINE|VALUE_PAIR|VALUE|MAJOR_QUESTION|MAJOR QUESTION|"
    r"DRAMATIC_QUESTION|DRAMATIC QUESTION|CONTROLLING_IDEA|CONTROLLING IDEA|"
    r"OPPOSITION|CONSCIOUS_DESIRE|UNCONSCIOUS_DESIRE|INCITING)\s*[:：]\s*(.+)$",
    re.IGNORECASE,
)

# Beat-local value turns look like "value: safety→unease" and must stay playable.
_VALUE_TURN_BODY_RE = re.compile(r"→|->|=>")


def extract_beat_role(scene_desc: str | None) -> str | None:
    """Return McKee beat role tag from a scene line, if present."""
    if not scene_desc:
        return None
    m = _ROLE_RE.search(scene_desc)
    if not m:
        return None
    return m.group("role").lower()


def infer_beat_role(beat_index: int, total_beats: int) -> str:
    """Fallback role when the outline line has no [role] tag."""
    n = max(total_beats, 1)
    template = _ROLE_BY_COUNT.get(n)
    if template is None:
        if n < 4:
            template = ("setup", "inciting", "climax")[:n]
            while len(template) < n:
                template = template + ("progressive",)
        else:
            mid = max(n - 4, 1)
            template = (
                ("setup", "inciting")
                + tuple(["progressive"] * mid)
                + ("crisis", "climax")
            )
            if len(template) < n:
                template = template + ("resolution",)
            template = template[:n]
    idx = min(max(beat_index, 0), len(template) - 1)
    return template[idx]


def resolve_beat_role(
    scene_desc: str | None, beat_index: int, total_beats: int
) -> str:
    return extract_beat_role(scene_desc) or infer_beat_role(beat_index, total_beats)


def _token_polarity(text: str) -> int | None:
    t = text.lower().strip()
    if not t:
        return None
    neg = sum(1 for w in _NEG_TOKENS if w in t)
    pos = sum(1 for w in _POS_TOKENS if w in t)
    if neg == pos == 0:
        return None
    if neg > pos:
        return -1
    if pos > neg:
        return 1
    return None


def extract_value_end_polarity(scene_desc: str | None) -> int | None:
    """Guess ending polarity of a beat's value turn (+1 / -1 / None)."""
    if not scene_desc:
        return None
    m = _VALUE_TURN_RE.search(scene_desc)
    if not m:
        return _token_polarity(scene_desc)
    end = m.group(2).strip()
    # dilemma phrasing often stays negative-charged for crisis
    if "vs" in end.lower() or "对" in end or "两难" in end:
        return -1
    return _token_polarity(end)


def is_meta_outline_line(line: str) -> bool:
    """True for McKee header lines that are not playable beats.

    Only KEY: value spine rows (via ``_META_KEY_RE``) and exact section
    headers count as meta. Bare prefixes such as VALUE/CONSCIOUS without a
    colon must not match, and beat-local ``value: A→B`` turns stay playable.
    """
    s = line.strip()
    if not s:
        return True
    if re.match(r"^[\s]*(\d+[\.\)]\s+|[-\*]\s+)", s):
        return False
    m = _META_KEY_RE.match(s)
    if m:
        key = re.sub(r"\s+", "_", m.group(1).strip().upper())
        # "value: safety→unease" is a beat field, not spine VALUE_PAIR.
        if key == "VALUE" and _VALUE_TURN_BODY_RE.search(m.group(2)):
            return False
        return True
    upper = s.upper()
    if upper in {
        "# MCKEE SPINE",
        "# BEATS",
        "BEATS",
        "SPINE",
        "OUTLINE",
        "MCKEE SPINE",
        "MCKEE",
    }:
        return True
    if upper.startswith(("# ", "## ", "### ")):
        return True
    return False


def filter_playable_outline_lines(text: str) -> str:
    """Drop McKee meta headers so classic numbered parsers only see beats.

    Returns an empty string when every line is meta so callers can treat
    spine-only responses as no playable beats (no silent full-text fallback).
    """
    if not text:
        return text
    kept: list[str] = []
    for raw in text.splitlines():
        if is_meta_outline_line(raw):
            continue
        kept.append(raw)
    return "\n".join(kept).strip()


def parse_spine_meta(outline_text: str | None) -> dict[str, str]:
    """Extract McKee spine meta key/values from a full outline string."""
    if not outline_text:
        return {}
    out: dict[str, str] = {}
    key_map = {
        "protagonist": "protagonist",
        "spine": "spine",
        "value_pair": "value_pair",
        "value": "value_pair",
        "major_question": "major_question",
        "major question": "major_question",
        "controlling_idea": "controlling_idea",
        "controlling idea": "controlling_idea",
        "opposition": "opposition",
        "conscious_desire": "conscious_desire",
        "unconscious_desire": "unconscious_desire",
        "inciting": "inciting",
    }
    for raw in outline_text.splitlines():
        m = _META_KEY_RE.match(raw.strip())
        if not m:
            continue
        raw_key = re.sub(r"\s+", "_", m.group(1).strip().lower())
        raw_key = raw_key.replace("__", "_")
        # normalize "major question" already handled by regex group
        canon = key_map.get(raw_key) or key_map.get(raw_key.replace("_", " "))
        if not canon:
            # try without underscores
            canon = key_map.get(m.group(1).strip().lower())
        if canon:
            out[canon] = m.group(2).strip()
    return out


def validate_outline_structure(scenes: list[str]) -> list[str]:
    """Return human-readable warnings (empty list = structurally OK enough).

    Hard rules (from McKee value-charge research):
    1. Every beat MUST carry a value turn (``value: X→Y``).
    2. The story MUST contain at least one explicit value-charge flip
       between consecutive beats (deterministic polarity detection).
    """
    warnings: list[str] = []
    if not scenes:
        return ["no playable beats"]
    if len(scenes) < 4:
        warnings.append(f"only {len(scenes)} beats; want 5-7 for McKee arc")
    roles = [extract_beat_role(s) for s in scenes]
    tagged = sum(1 for r in roles if r)
    if tagged < max(1, len(scenes) // 2):
        warnings.append("most beats lack [role] tags")
    role_set = {r for r in roles if r}
    inferred = {infer_beat_role(i, len(scenes)) for i in range(len(scenes))}
    if "inciting" not in role_set and "inciting" not in inferred:
        warnings.append("missing inciting beat")
    if "climax" not in role_set and "climax" not in inferred:
        warnings.append("missing climax beat")

    # Hard rule 1: every beat must carry a value turn
    beats_without_value = [i for i, s in enumerate(scenes) if "value" not in s.lower()]
    if beats_without_value:
        missing = ", ".join(str(i + 1) for i in beats_without_value)
        warnings.append(f"hard: beats [{missing}] missing value: turn (every beat must carry value)")

    # Hard rule 2: detect at least one value-charge flip between consecutive beats
    poles = [extract_value_end_polarity(s) for s in scenes]
    known = [(i, p) for i, p in enumerate(poles) if p is not None]
    flip_detected = False
    for i in range(1, len(known)):
        if known[i][1] != known[i - 1][1]:
            flip_detected = True
            break
    if not flip_detected and len(known) >= 2:
        warnings.append(
            "hard: no value-charge flip detected between consecutive beats "
            "(story must contain at least one polarity flip in the spine)"
        )

    # Soft: flag long same-polarity runs (diminishing returns)
    same_run = 0
    for i in range(1, len(known)):
        if known[i][1] == known[i - 1][1]:
            same_run += 1
    if same_run >= 3 and len(known) >= 5:
        warnings.append("value polarity may not alternate enough (diminishing returns)")

    # Soft: missing gap / risk
    missing_gap = sum(1 for s in scenes if "gap" not in s.lower())
    if missing_gap > len(scenes) // 2:
        warnings.append("many beats missing gap:")
    missing_risk = sum(1 for s in scenes if "risk" not in s.lower())
    if missing_risk > len(scenes) // 2:
        warnings.append("many beats missing risk:")
    return warnings


def outline_example(language: str) -> str:
    if language.startswith("zh"):
        return (
            "示例（先写脊柱元信息，再写可玩节拍；节拍必须带角色标签）：\n"
            "PROTAGONIST: Hank Schrader\n"
            "SPINE: 汉克要在不毁掉家庭的前提下揭开真相\n"
            "CONSCIOUS_DESIRE: 抓住蓝冰背后的人\n"
            "UNCONSCIOUS_DESIRE: 保住「好姐夫/好警察」的自我形象\n"
            "VALUE_PAIR: 忠诚 / 背叛\n"
            "OPPOSITION: Walter White（谎言）、家庭期待、DEA 制度压力\n"
            "MAJOR_QUESTION: 汉克能否在爱与职责之间守住真相？\n"
            "CONTROLLING_IDEA: 真相撕开家庭，因为忠诚被用来掩护更大的谎言\n"
            "1. [setup] 施拉德后院烧烤 — value: 安全→隐隐不安 — gap: 汉克以为闲聊，沃尔特却回避眼神 — risk: 低\n"
            "2. [inciting] DEA 办公室 — value: 秩序→失衡 — gap: 一条新线索直指亲友圈 — risk: 中\n"
            "3. [progressive] 怀特家客厅 — value: 信任→怀疑 — gap: 汉克试探最小动作，却撞上更硬的墙 — risk: 中高\n"
            "4. [crisis] 证据室 — value: 职责 vs 亲情 的两难 — gap: 任何选择都会不可逆 — risk: 极高\n"
            "5. [climax] 沙漠路边 — value: 家庭表象→不可逆决裂 — gap: 因为激励事件，这一刻必须发生且出人意料 — risk: 终极\n"
            "6. [resolution] 施拉德厨房 — value: 余震→冷定局 — gap: 新平衡（或废墟）已成，不再开新线 — risk: 余波"
        )
    return (
        "Example (spine meta first, then playable beats; each beat MUST carry a role tag):\n"
        "PROTAGONIST: Hank Schrader\n"
        "SPINE: Hank must uncover the truth without destroying his family\n"
        "CONSCIOUS_DESIRE: catch whoever is behind the blue meth\n"
        "UNCONSCIOUS_DESIRE: keep the identity of good brother-in-law / good cop\n"
        "VALUE_PAIR: loyalty / betrayal\n"
        "OPPOSITION: Walter White (lies), family expectation, DEA institutional pressure\n"
        "MAJOR_QUESTION: Can Hank hold the truth between love and duty?\n"
        "CONTROLLING_IDEA: Truth rips the family open because loyalty was used to cover a greater lie\n"
        "1. [setup] Schrader backyard cookout — value: safety→unease — gap: Hank expects banter; Walt goes evasive — risk: low\n"
        "2. [inciting] DEA office — value: order→imbalance — gap: a new lead points inside the family circle — risk: mid\n"
        "3. [progressive] White living room — value: trust→suspicion — gap: minimal probe meets a harder wall — risk: high\n"
        "4. [crisis] Evidence room — value: duty vs family dilemma — gap: either choice is irreversible — risk: extreme\n"
        "5. [climax] Desert roadside — value: family facade→irreversible break — gap: inevitable yet surprising because of the inciting incident — risk: ultimate\n"
        "6. [resolution] Schrader kitchen — value: aftershock→cold settle — gap: new balance locked; no new quest — risk: residue"
    )


def build_outline_user_prompt(
    task: str,
    language: str,
    *,
    active_character: str | None = None,
) -> str:
    """User message for first-chapter McKee outline generation."""
    lang = "zh" if language.startswith("zh") else "en"
    protag = active_character or (
        "the player's selected Story protagonist (use their full English name)"
    )
    if lang == "zh":
        body = (
            f"任务: {task}\n\n"
            f"主人公（故事脊椎的承载者）: {protag}\n\n"
            "用罗伯特·麦基《故事》方法写可玩大纲（不是散文）。必须吸收下列纪律：\n"
            "A. 脊柱元信息（每行一个 KEY: value）：\n"
            "   PROTAGONIST / SPINE / CONSCIOUS_DESIRE / UNCONSCIOUS_DESIRE /\n"
            "   VALUE_PAIR / OPPOSITION / MAJOR_QUESTION / CONTROLLING_IDEA\n"
            "   - CONTROLLING_IDEA = 价值 + 原因（一句闭合陈述，不是开放问题）\n"
            "   - UNCONSCIOUS_DESIRE 应与 CONSCIOUS_DESIRE 形成矛盾（复杂主人公）\n"
            "   - OPPOSITION 要有真实火力，禁止纸糊反派或说教压倒对立面\n"
            "B. 5-7 条可玩节拍，每条必须：\n"
            "   - 数字开头 + 角色标签 [setup|inciting|progressive|crisis|climax|resolution]\n"
            "   - 地点 + 动作；value: 前→后（必须翻转）；gap: 期望 vs 结果；risk: 递增\n"
            "C. 结构与情感：\n"
            "   - setup 后尽快 inciting；禁止解说拖戏\n"
            "   - progressive 走鸿沟循环，风险递增值欲望；禁止更弱行动\n"
            "   - crisis 是真正两难（两善/两恶之轻）；climax 不可逆且回答 MAJOR_QUESTION\n"
            "   - 相邻节拍的 value 终点极性应交替（正/负），避免情感回报递减\n"
            "   - 复杂型冲突：内心 / 人际 / 个人-外界 尽量都碰，不要只打一层\n"
            "   - 因为激励事件，高潮必须发生（因果脊椎）；高潮要既不可避免又出人意料\n"
            "D. 冲突来自欲望与对立，禁止巧合救场；仅限 Breaking Bad 虚构世界\n\n"
            f"{outline_example(language)}\n\n"
            "IMPORTANT: 输出纯文本。不要 JSON、不要代码块。"
        )
    else:
        body = (
            f"Task: {task}\n\n"
            f"Protagonist (story spine bearer): {protag}\n\n"
            "Write a playable outline with Robert McKee's *Story* method (not prose).\n"
            "Absorb these disciplines from the craft system:\n"
            "A. Spine meta (one KEY: value per line):\n"
            "   PROTAGONIST / SPINE / CONSCIOUS_DESIRE / UNCONSCIOUS_DESIRE /\n"
            "   VALUE_PAIR / OPPOSITION / MAJOR_QUESTION / CONTROLLING_IDEA\n"
            "   - CONTROLLING_IDEA = value + cause (closed sentence, not a question)\n"
            "   - UNCONSCIOUS_DESIRE should contradict CONSCIOUS_DESIRE (complex protagonist)\n"
            "   - OPPOSITION gets equal firepower; no paper villains or preaching\n"
            "B. 5-7 playable beats. Each beat MUST have:\n"
            "   - number + role tag [setup|inciting|progressive|crisis|climax|resolution]\n"
            "   - place + action; value: before→after (must turn); gap:; risk: rising\n"
            "C. Structure and emotion:\n"
            "   - setup → inciting quickly; no exposition dump\n"
            "   - progressive = gap cycle; desire value ∝ risk; never weaken action\n"
            "   - crisis = real dilemma (two goods / lesser evil); climax irreversible\n"
            "   - alternate ending polarity of value turns (+/-) to avoid diminishing returns\n"
            "   - complex conflict: hit inner / personal / extra-personal layers across the arc\n"
            "   - because the inciting incident, climax must happen; inevitable yet surprising\n"
            "D. Desire vs opposition only; no coincidence rescue; Breaking Bad fiction only\n\n"
            f"{outline_example(language)}\n\n"
            "IMPORTANT: Output PLAIN TEXT only. No JSON, no code fences."
        )
    return body


def build_followup_user_prompt(
    base_task: str,
    prior_outline: str,
    existing_scenes: Iterable[str],
    language: str,
    *,
    branch_goal: str | None = None,
) -> str:
    scenes = list(existing_scenes)
    goal = f"\nNew chapter focus: {branch_goal}" if branch_goal else ""
    if language.startswith("zh"):
        return (
            f"原任务: {base_task}\n\n"
            f"已有大纲（第1章，含麦基脊柱）：\n{prior_outline}\n\n"
            f"已玩节拍：\n"
            + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(scenes))
            + f"\n\n生成第2章：从第1章 climax/resolution 之后继续。"
            f"风险与对抗必须更高；可更新 CONTROLLING_IDEA / OPPOSITION。"
            f"{goal}\n"
            "输出：脊柱更新行（可选）+ 4-6 条编号节拍；"
            "每条仍须 [role] + value 翻转 + gap + risk；相邻极性尽量交替。\n"
            "编号从 1 重计。纯文本，不要 JSON。"
        )
    return (
        f"Original task: {base_task}\n\n"
        f"Existing outline (chapter 1, McKee spine included):\n{prior_outline}\n\n"
        f"Beats played so far:\n"
        + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(scenes))
        + f"\n\nGenerate chapter 2 after chapter 1 climax/resolution. "
        f"Risk and opposition must rise; you may refresh CONTROLLING_IDEA / OPPOSITION."
        f"{goal}\n"
        "Output: optional spine update lines + 4-6 numbered beats; "
        "each still needs [role] + value turn + gap + risk; alternate polarity.\n"
        "Restart numbering at 1. Plain text only. No JSON."
    )


def build_branch_user_prompt(
    base_task: str,
    prior_outline: str,
    branch_beat_index: int,
    scenes: list[str],
    language: str,
    *,
    branch_goal: str | None = None,
) -> str:
    prior_beat = (
        scenes[branch_beat_index]
        if 0 <= branch_beat_index < len(scenes)
        else ""
    )
    goal = f"\nBranching focus: {branch_goal}" if branch_goal else ""
    if language.startswith("zh"):
        return (
            f"原任务: {base_task}\n\n"
            f"现有麦基大纲：\n{prior_outline}\n\n"
            f"从节拍 {branch_beat_index + 1} 分岔: {prior_beat}\n"
            f"该节拍之前全部保留。只生成之后的新节拍。{goal}\n"
            "保持麦基纪律：鸿沟循环、三层冲突、对立有火力、"
            "递进风险、危机两难、高潮不可逆且意外；"
            "每条编号节拍含 [role] + value + gap + risk。\n"
            "纯文本，不要 JSON。"
        )
    return (
        f"Original task: {base_task}\n\n"
        f"Existing McKee outline:\n{prior_outline}\n\n"
        f"Branching from beat {branch_beat_index + 1}: {prior_beat}\n"
        f"Everything before that beat is preserved. Generate ONLY what follows.{goal}\n"
        "Keep McKee discipline: gap cycle, three conflict layers, equal opposition fire, "
        "rising risk, crisis dilemma, irreversible yet surprising climax; "
        "each numbered beat has [role] + value + gap + risk.\n"
        "Plain text only. No JSON."
    )


def build_beat_planning_addon(
    scene_desc: str,
    *,
    beat_index: int,
    total_beats: int,
    language: str = "en",
    previous_scene_desc: str | None = None,
    outline_text: str | None = None,
) -> str:
    """Extra planning rules injected into each beat generation call."""
    role = resolve_beat_role(scene_desc, beat_index, total_beats)
    role_rule = _ROLE_INSTRUCTIONS.get(role, _ROLE_INSTRUCTIONS["progressive"])
    conflict_focus = _ROLE_CONFLICT_FOCUS.get(role, "personal + inner")
    spine = parse_spine_meta(outline_text or "")
    prev_pol = extract_value_end_polarity(previous_scene_desc)
    this_pol = extract_value_end_polarity(scene_desc)

    if language.startswith("zh"):
        pol_line = ""
        if prev_pol is not None:
            want = "正面" if prev_pol < 0 else "负面"
            pol_line = (
                f"上一拍价值终点极性约为 {'负面' if prev_pol < 0 else '正面'}；"
                f"本拍应倾向翻到{want}，避免连续同向情感（回报递减）。\n"
            )
        elif this_pol is not None:
            pol_line = f"本拍大纲标注的终点极性倾向: {'负面' if this_pol < 0 else '正面'}。\n"

        hinge = ""
        if previous_scene_desc:
            hinge = (
                f"场景铰链：从上拍「{previous_scene_desc[:120]}」切入本拍时，"
                "找共有或对立的第三要素（人物特质/动作/物件/一句话/光/声/想法），"
                "禁止生硬跳切。\n"
            )

        spine_bits = []
        if spine.get("controlling_idea"):
            spine_bits.append(f"主控思想: {spine['controlling_idea']}")
        if spine.get("conscious_desire"):
            spine_bits.append(f"自觉欲望: {spine['conscious_desire']}")
        if spine.get("unconscious_desire"):
            spine_bits.append(f"不自觉欲望: {spine['unconscious_desire']}")
        if spine.get("opposition"):
            spine_bits.append(f"对立力量: {spine['opposition']}")
        spine_block = ("脊柱提醒: " + " | ".join(spine_bits) + "\n") if spine_bits else ""

        return (
            f"麦基节拍职能: [{role}]\n"
            f"{role_rule}\n"
            f"冲突层面焦点: {conflict_focus}\n"
            f"{spine_block}"
            f"{pol_line}"
            f"{hinge}"
            "本拍硬性要求：\n"
            "1) 至少一次价值翻转（正↔负），写入 world_state_delta。\n"
            "2) 鸿沟循环：人物按期望行动 → 对抗给出意外结果 → 人物重塑判断 → 风险升高"
            "（写在 agent_think 与对白压力，禁止解说）。\n"
            "3) 从里写到外：写对白/想法时用「如果我就是这个人物，在这种处境我会怎么做」"
            "，禁止道德说教腔。\n"
            "4) 对立面必须有真实火力与局部真理；禁止纸糊反派。\n"
            "5) 禁止静态展示、纯解说、巧合救场。\n"
            "6) agent_speak ≤ 2；agent_think 在 speak 之前。\n"
            "7) agent_speak.content 只写出口台词，禁止括号舞台指示/旁白比喻"
            "（如「像是老师讲重点」）；可拍动作写 agent_act。\n"
            "8) 若本拍是 crisis：必须是真正两难，不是简单选择题。\n"
            "9) 若本拍是 climax：动作不言自明，回答 MAJOR_QUESTION，体现 CONTROLLING_IDEA。\n"
        )

    pol_line = ""
    if prev_pol is not None:
        want = "positive" if prev_pol < 0 else "negative"
        pol_line = (
            f"Previous beat end-polarity ≈ {'negative' if prev_pol < 0 else 'positive'}; "
            f"bias this beat toward {want} to avoid diminishing returns.\n"
        )
    elif this_pol is not None:
        pol_line = (
            f"Outline end-polarity bias for this beat: "
            f"{'negative' if this_pol < 0 else 'positive'}.\n"
        )

    hinge = ""
    if previous_scene_desc:
        hinge = (
            f"Scene hinge: enter from previous beat 「{previous_scene_desc[:120]}」 "
            "via a shared or opposing third element "
            "(trait/action/object/line/light/sound/idea). No clumsy jump-cut.\n"
        )

    spine_bits = []
    if spine.get("controlling_idea"):
        spine_bits.append(f"CONTROLLING_IDEA: {spine['controlling_idea']}")
    if spine.get("conscious_desire"):
        spine_bits.append(f"conscious desire: {spine['conscious_desire']}")
    if spine.get("unconscious_desire"):
        spine_bits.append(f"unconscious desire: {spine['unconscious_desire']}")
    if spine.get("opposition"):
        spine_bits.append(f"OPPOSITION: {spine['opposition']}")
    spine_block = ("Spine: " + " | ".join(spine_bits) + "\n") if spine_bits else ""

    return (
        f"McKee beat function: [{role}]\n"
        f"{role_rule}\n"
        f"Conflict-layer focus: {conflict_focus}\n"
        f"{spine_block}"
        f"{pol_line}"
        f"{hinge}"
        "Hard requirements for this beat:\n"
        "1) At least one value turn (positive↔negative) in world_state_delta.\n"
        "2) Gap cycle: act on expectation → opposition surprises → reframe → raise risk "
        "(in agent_think + dialogue pressure; no lecture).\n"
        "3) Inside-out writing: 'If I were this character in this situation, what would I do?' "
        "No moralizing author voice.\n"
        "4) Opposition gets real firepower and partial truth; no paper villains.\n"
        "5) No static exposition; no coincidence rescues.\n"
        "6) At most two agent_speak; agent_think before speak.\n"
        "7) agent_speak.content is spoken words only — no parenthetical stage notes "
        "or narrator similes; filmable action goes in agent_act.\n"
        "8) If crisis: real dilemma, not a multiple-choice quiz.\n"
        "9) If climax: pure action answers MAJOR_QUESTION and embodies CONTROLLING_IDEA.\n"
    )


def mckee_system_addon() -> str:
    """Short block appended to Director system prompt for Story mode."""
    return (
        "\n\nMCKEE STORY ENGINE v2 (Story mode):\n"
        "Structure beats as McKee story events, not random vignettes.\n"
        "Hierarchy (interactive scale): setup → inciting → progressive* → crisis → "
        "irreversible climax → brief resolution.\n"
        "Spine meta: PROTAGONIST, SPINE, CONSCIOUS_DESIRE, UNCONSCIOUS_DESIRE, "
        "VALUE_PAIR, OPPOSITION, MAJOR_QUESTION, CONTROLLING_IDEA (value + cause).\n"
        "Every playable scene must turn a loaded value through conflict and open a gap.\n"
        "Complex conflict across inner / personal / extra-personal layers.\n"
        "Alternate emotional polarity between beats (diminishing-returns law).\n"
        "Desire value ∝ risk; opposition gets equal firepower (no preaching).\n"
        "Crisis = true dilemma; climax = inevitable yet surprising pure action.\n"
        "Write characters inside-out: if I were this person in this situation...\n"
        "Tag numbered beats with [setup|inciting|progressive|crisis|climax|resolution] "
        "and include value: before→after, gap:, risk:.\n"
    )


def outline_event_payload(
    outline_text: str,
    *,
    scenes: list[str] | None = None,
) -> dict[str, Any]:
    """Build outline SSE data with optional structured spine + warnings.

    Pass ``scenes`` from ``DirectorAgent._parse_outline`` to avoid re-parsing.
    """
    spine = parse_spine_meta(outline_text)
    scene_list = scenes if scenes is not None else []
    warnings = validate_outline_structure(scene_list) if scene_list else []
    payload: dict[str, Any] = {"content": outline_text}
    if spine:
        payload["mckee_spine"] = spine
    if warnings:
        payload["mckee_warnings"] = warnings
    if scene_list:
        payload["mckee_beat_count"] = len(scene_list)
    return payload
