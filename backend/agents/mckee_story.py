"""McKee *Story* engine helpers for interactive Story mode.

v1 scope (Loop N+1):
- Outline generation follows McKee spine: desire, inciting incident,
  progressive complications, crisis, climax, optional resolution.
- Each playable beat must turn a value and open a gap (expectation vs result).
- Does NOT change the SSE event schema (scene_change / agent_* / world_state_delta).

Source: Robert McKee *Story* (local skill extract under 故事/*).
"""

from __future__ import annotations

import re
from typing import Iterable

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

# When the LLM omits tags, assign role by position (1-based index length).
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
        "SETUP: Establish the protagonist's ordinary balance and loaded values "
        "before the world tips. Minimal exposition; show who wants what."
    ),
    "inciting": (
        "INCITING INCIDENT: A dynamic on-screen event that radically unbalances "
        "the protagonist's life, sparks conscious desire, and launches the quest. "
        "Must raise the story's major dramatic question."
    ),
    "progressive": (
        "PROGRESSIVE COMPLICATION: Raise risk and opposition. The hero takes a "
        "harder action; the world answers with a worse gap. Never weaken force "
        "or repeat an earlier action at lower stakes."
    ),
    "crisis": (
        "CRISIS: The ultimate dilemma - the protagonist must choose between "
        "irreconcilable goods or the lesser of two evils under maximum pressure."
    ),
    "climax": (
        "CLIMAX: Absolute, irreversible value change that answers the major "
        "dramatic question. Because the inciting incident happened, this must happen."
    ),
    "resolution": (
        "RESOLUTION: Brief aftershock. Show the new balance (or ruin) without "
        "starting a new quest."
    ),
}


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
            # pad if needed
            while len(template) < n:
                template = template + ("progressive",)
        else:
            # scale: setup, inciting, progressives..., crisis, climax, resolution
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


def is_meta_outline_line(line: str) -> bool:
    """True for McKee header lines that are not playable beats."""
    s = line.strip()
    if not s:
        return True
    # Numbered list items are beats even if they contain keywords.
    if re.match(r"^[\s]*(\d+[\.\)]\s+|[-\*]\s+)", s):
        return False
    upper = s.upper()
    meta_prefixes = (
        "PROTAGONIST:",
        "SPINE:",
        "VALUE",
        "CONTROLLING",
        "INCITING:",
        "MAJOR QUESTION",
        "MAJOR_QUESTION",
        "DRAMATIC QUESTION",
        "MCKEE",
        "# ",
        "## ",
    )
    if any(upper.startswith(p) for p in meta_prefixes):
        return True
    # Pure section headers without scene content
    if upper in {"# MCKEE SPINE", "# BEATS", "BEATS", "SPINE", "OUTLINE"}:
        return True
    return False


def filter_playable_outline_lines(text: str) -> str:
    """Drop McKee meta headers so classic numbered parsers only see beats."""
    if not text:
        return text
    kept: list[str] = []
    for raw in text.splitlines():
        if is_meta_outline_line(raw):
            continue
        kept.append(raw)
    return "\n".join(kept).strip() or text.strip()


def outline_example(language: str) -> str:
    if language.startswith("zh"):
        return (
            "示例（先写脊柱元信息，再写可玩节拍；节拍必须带角色标签）：\n"
            "PROTAGONIST: Hank Schrader\n"
            "SPINE: 汉克要在不毁掉家庭的前提下揭开真相\n"
            "VALUE_PAIR: 忠诚 / 背叛\n"
            "MAJOR_QUESTION: 汉克能否在爱与职责之间守住真相？\n"
            "1. [setup] 施拉德后院烧烤 — value: 安全→隐隐不安 — gap: 汉克以为闲聊，沃尔特却回避眼神\n"
            "2. [inciting] DEA 办公室 — value: 秩序→失衡 — gap: 一条新线索直指亲友圈\n"
            "3. [progressive] 怀特家客厅 — value: 信任→怀疑 — gap: 汉克试探最小动作，却撞上更硬的墙\n"
            "4. [crisis] 证据室 — value: 职责 vs 亲情 的两难 — gap: 任何选择都会不可逆\n"
            "5. [climax] 沙漠路边 — value: 家庭表象→不可逆决裂 — gap: 因为激励事件，这一刻必须发生\n"
            "6. [resolution] 施拉德厨房 — value: 余震 — gap: 新平衡（或废墟）已成定局"
        )
    return (
        "Example (spine meta first, then playable beats; each beat MUST carry a role tag):\n"
        "PROTAGONIST: Hank Schrader\n"
        "SPINE: Hank must uncover the truth without destroying his family\n"
        "VALUE_PAIR: loyalty / betrayal\n"
        "MAJOR_QUESTION: Can Hank hold the truth between love and duty?\n"
        "1. [setup] Schrader backyard cookout — value: safety→unease — gap: Hank expects banter; Walt goes evasive\n"
        "2. [inciting] DEA office — value: order→imbalance — gap: a new lead points inside the family circle\n"
        "3. [progressive] White living room — value: trust→suspicion — gap: minimal probe meets a harder wall\n"
        "4. [crisis] Evidence room — value: duty vs family dilemma — gap: either choice is irreversible\n"
        "5. [climax] Desert roadside — value: family facade→irreversible break — gap: because the inciting incident, this must happen\n"
        "6. [resolution] Schrader kitchen — value: aftershock — gap: the new balance (or ruin) is locked"
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
            "用罗伯特·麦基《故事》方法写可玩大纲（不是散文）：\n"
            "1) 先写元信息行：PROTAGONIST / SPINE / VALUE_PAIR / MAJOR_QUESTION\n"
            "2) 再写 5-7 条可玩节拍，每条必须：\n"
            "   - 以数字开头（1. 2. 3. …）\n"
            "   - 含角色标签 [setup|inciting|progressive|crisis|climax|resolution]\n"
            "   - 含地点 + 一句话动作\n"
            "   - 含 value: 前→后（价值必须翻转，禁止同值进出）\n"
            "   - 含 gap: 人物期望 vs 意外结果（鸿沟）\n"
            "3) 结构纪律：\n"
            "   - setup 后尽快 inciting（不要用解说拖戏）\n"
            "   - progressive 节拍风险递增，禁止弱化或重复更弱行动\n"
            "   - crisis 是两难选择；climax 必须不可逆，并能回答 MAJOR_QUESTION\n"
            "   - 因为激励事件，高潮必须发生（因果脊椎）\n"
            "4) 冲突来自人物欲望对抗，禁止巧合救场\n"
            "5) 只写 Breaking Bad 剧情世界内的虚构戏剧\n\n"
            f"{outline_example(language)}\n\n"
            "IMPORTANT: 输出纯文本。不要 JSON、不要代码块。"
        )
    else:
        body = (
            f"Task: {task}\n\n"
            f"Protagonist (story spine bearer): {protag}\n\n"
            "Write a playable outline using Robert McKee's *Story* method (not prose):\n"
            "1) First emit meta lines: PROTAGONIST / SPINE / VALUE_PAIR / MAJOR_QUESTION\n"
            "2) Then 5-7 playable beats. Each beat MUST:\n"
            "   - start with a number (1. 2. 3. …)\n"
            "   - include a role tag [setup|inciting|progressive|crisis|climax|resolution]\n"
            "   - include location + one action sentence\n"
            "   - include value: before→after (value MUST turn; no static scenes)\n"
            "   - include gap: expectation vs unexpected result\n"
            "3) Structure discipline:\n"
            "   - move from setup to inciting quickly (no exposition dump)\n"
            "   - progressive beats escalate risk; never weaken or repeat weaker actions\n"
            "   - crisis is a dilemma; climax is irreversible and answers MAJOR_QUESTION\n"
            "   - because the inciting incident, the climax must happen (causal spine)\n"
            "4) Conflict from character desire and opposition, never coincidence rescue\n"
            "5) Stay inside fictional Breaking Bad drama only\n\n"
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
            + f"\n\n生成第2章：从第1章 climax/resolution 之后继续，风险必须更高。"
            f"{goal}\n"
            "输出：可写简短 SPINE 更新行，然后 4-6 条编号节拍；"
            "每条仍须 [role] + value 翻转 + gap。编号从 1 重计。\n"
            "纯文本，不要 JSON。"
        )
    return (
        f"Original task: {base_task}\n\n"
        f"Existing outline (chapter 1, McKee spine included):\n{prior_outline}\n\n"
        f"Beats played so far:\n"
        + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(scenes))
        + f"\n\nGenerate chapter 2 continuing after chapter 1's climax/resolution. "
        f"Risk must rise.{goal}\n"
        "Output: optional brief SPINE update lines, then 4-6 numbered beats; "
        "each still needs [role] + value turn + gap. Restart numbering at 1.\n"
        "Plain text only. No JSON."
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
            "保持麦基纪律：递进风险、危机两难、高潮不可逆；"
            "每条编号节拍含 [role] + value + gap。\n"
            "纯文本，不要 JSON。"
        )
    return (
        f"Original task: {base_task}\n\n"
        f"Existing McKee outline:\n{prior_outline}\n\n"
        f"Branching from beat {branch_beat_index + 1}: {prior_beat}\n"
        f"Everything before that beat is preserved. Generate ONLY what follows.{goal}\n"
        "Keep McKee discipline: rising risk, crisis dilemma, irreversible climax; "
        "each numbered beat has [role] + value + gap.\n"
        "Plain text only. No JSON."
    )


def build_beat_planning_addon(
    scene_desc: str,
    *,
    beat_index: int,
    total_beats: int,
    language: str = "en",
) -> str:
    """Extra planning rules injected into each beat generation call."""
    role = resolve_beat_role(scene_desc, beat_index, total_beats)
    role_rule = _ROLE_INSTRUCTIONS.get(role, _ROLE_INSTRUCTIONS["progressive"])
    if language.startswith("zh"):
        return (
            f"麦基节拍职能: [{role}]\n"
            f"{role_rule}\n"
            "本拍硬性要求：\n"
            "1) 场景内必须发生至少一次价值翻转（正面↔负面），体现在 world_state_delta。\n"
            "2) 必须出现鸿沟：人物按期望行动，对抗力量给出意外结果"
            "（写在 agent_think 与对白压力里，不要解说）。\n"
            "3) 禁止静态展示或纯解说场景；禁止巧合解决冲突。\n"
            "4) agent_speak 最多 2 条；先想后说（agent_think 在 speak 前）。\n"
        )
    return (
        f"McKee beat function: [{role}]\n"
        f"{role_rule}\n"
        "Hard requirements for this beat:\n"
        "1) At least one value turn (positive↔negative) must occur; "
        "reflect it in world_state_delta.\n"
        "2) Open a gap: character acts on expectation; opposition returns "
        "an unexpected result (show in agent_think + dialogue pressure, no lecture).\n"
        "3) No static exposition scenes; no coincidence rescues.\n"
        "4) At most two agent_speak events; think before speak "
        "(agent_think before agent_speak).\n"
    )


def mckee_system_addon() -> str:
    """Short block appended to Director system prompt for Story mode."""
    return (
        "\n\nMCKEE STORY ENGINE (Story mode):\n"
        "Structure beats as McKee story events, not random vignettes.\n"
        "Hierarchy (scaled for interactive play): beat roles inside scenes → "
        "progressive sequence → crisis → irreversible climax.\n"
        "Every playable scene must change a loaded value through conflict.\n"
        "Spine = protagonist desire to restore life balance after the inciting incident.\n"
        "When writing outlines, tag each numbered beat with "
        "[setup|inciting|progressive|crisis|climax|resolution] and include "
        "value: before→after and gap: expectation vs result.\n"
    )
