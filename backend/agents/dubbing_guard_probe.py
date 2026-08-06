"""译制腔（dubbing-tone）漏网率探针 / 检测守卫哨兵。

这是一个**便宜、确定性、纯本地**的规则检测器。它不调用任何 LLM API，
只用正则/关键词/字符统计判断一段中文文本是否带"译制腔"特征。

它的定位是**探针 + 哨兵**，不是改写器：
- 探针：验证"中文母语者表达守则"注入 prompt 后，漏网文本能被规则层识别。
- 哨兵：对任意中文文本给出 译制腔风险评分，供未来"改写守卫"决策。

局限（它能验证什么 / 不能验证什么）：
- 能：确定性区分"手工构造的译制腔样本"与"正常中文"。
- 不能：无法测量真实 LLM 在线输出的真实漏网率（那需要网络 + 真实采样）。
- 不能：无法覆盖全部译制腔形态——规则是封闭词表，漏掉未列出的表达。
- 不能：无法做语义改写，只能打分与定位命中片段。
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------
# 特征 1：英文直译骨架（英文思维构句）
# 命中 +2 分
# ---------------------------------------------------------------
SARCOPHAGUS_SKELETONS: list[tuple[str, str]] = [
    ("一想到", r"一想到"),
    ("当…的时候", r"当.{0,8}的时候"),
    ("对…来说", r"对.{0,8}(来说|来讲)"),
    ("在…之中", r"在.{0,8}的(过程|之中|背后)"),
    ("被…所", r"被.{0,8}所"),
]

# 特征 2：书面翻译腔 / 套话 / 英文思维用词（+1 分）
TRANSLATIONESE_MARKERS: list[str] = [
    "每一个",
    "事实上",
    "本质上",
    "某种程度上",
    "意识到",
    "某个",
    "某种",
    "自己",
    "仿佛",
    "像是",
    "宛如",
    "那一刻",
    "就这样",
    "注定",
    "永恒",
    "命运",
    "虚无",
    "深渊",
    "内心深处",
]

# 特征 3：抽象名词 + 具体名词 的硬拼意象（如「秩序的玻璃」）
# 命中 +3 分。只放已知的高风险组合词表，避免误伤正常"N的"。
ABSTRACT_NOUNS = ["秩序", "沉默", "恐惧", "绝望", "空洞", "虚无", "静谧", "孤独", "威胁", "冰冷"]
CONCRETE_NOUNS = ["玻璃", "墙", "刀", "手", "门", "窗", "骨", "血", "嘴唇", "影子", "面具"]
_ABSTRACT_CONCRETE_RE = re.compile(
    "(" + "|".join(ABSTRACT_NOUNS) + ")的(" + "|".join(CONCRETE_NOUNS) + ")"
)

# 特征 4：英文舞台指示残留 / 英文对白泄漏
# 拉丁字母占比 > 20% 记 +3 分；命中已知舞台指示短语额外 +2 分
STAGE_DIRECTION_PHRASES = [
    "leans back",
    "fingers steepled",
    "he is",
    "she is",
    "and ",
    "the ",
    "looks at",
    "takes a",
]

# 特征 5：中文角色名音译乱写（对照 director.py zh 守则的禁止译名）
# 命中 +3 分
FORBIDDEN_NAMES = ["米克", "托霍", "杰克·托霍"]

# 长句启发：单句 > 34 字且含 >= 3 个逗号 → 书面长句套话，+1 分
LONG_SENTENCE_MIN_CHARS = 34
LONG_SENTENCE_MIN_COMMAS = 3

# 判定阈值
# 单一结构骨架（一想到 / 当…的时候，+2）即判 dubbing；翻译腔用词（+1）判 suspicious。
DUBBING_THRESHOLD = 2.0
SUSPICIOUS_THRESHOLD = 1.0


def _latin_ratio(text: str) -> float:
    latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    if not text:
        return 0.0
    return latin / len(text)


def detect_dubbing_tone(text: str) -> dict:
    """对一段中文文本给出译制腔风险评分。

    返回 {
        "score": float,   # 累加匹配权重
        "matches": [str], # 命中的特征描述
        "verdict": str,   # clean / suspicious / dubbing
    }
    """
    score = 0.0
    matches: list[str] = []

    # 1) 英文直译骨架
    for label, pattern in SARCOPHAGUS_SKELETONS:
        if re.search(pattern, text):
            score += 2.0
            matches.append(f"直译骨架:{label}")

    # 2) 翻译腔用词
    for marker in TRANSLATIONESE_MARKERS:
        if marker in text:
            score += 1.0
            matches.append(f"翻译腔用词:{marker}")

    # 3) 抽象+具体名词硬拼
    for m in _ABSTRACT_CONCRETE_RE.finditer(text):
        score += 3.0
        matches.append(f"抽象+具体硬拼:{m.group(0)}")

    # 4) 英文泄漏
    if _latin_ratio(text) > 0.20:
        score += 3.0
        matches.append("英文残留:拉丁字母占比过高")
    low = text.lower()
    for phrase in STAGE_DIRECTION_PHRASES:
        if phrase in low:
            score += 2.0
            matches.append(f"英文舞台指示:{phrase.strip()}")

    # 5) 音译乱写
    for name in FORBIDDEN_NAMES:
        if name in text:
            score += 3.0
            matches.append(f"音译乱写:{name}")

    # 6) 长句套话启发
    sentence = re.split(r"[。！？；\n]", text)[0]
    if len(sentence) > LONG_SENTENCE_MIN_CHARS and sentence.count("，") >= LONG_SENTENCE_MIN_COMMAS:
        score += 1.0
        matches.append("书面长句:首句过长且逗号密集")

    if score >= DUBBING_THRESHOLD:
        verdict = "dubbing"
    elif score >= SUSPICIOUS_THRESHOLD:
        verdict = "suspicious"
    else:
        verdict = "clean"

    return {"score": round(score, 2), "matches": matches, "verdict": verdict}