"""轻量"译制腔"改写守卫（detect→rewrite 完整链路）。

它站在探针 ``dubbing_guard_probe.detect_dubbing_tone`` 之上，补上
"检测到译制腔 → 触发一次 LLM 自然中文改写"这一环。与探针的定位不同：

- 探针只打分、不改写（便宜、确定性、纯本地）。
- 本守卫是**便宜优先的兜底**：只有当 verdict == "dubbing" 时才调用一次
  LLM 重写；clean / suspicious 一律不触发，避免额外成本。

能力边界（它能做什么 / 不能做什么）：
- 能：对中文对白（agent_speak.content）与内心独白（agent_think.
  thought_content），以及动作（agent_act.action）与场景描述
  （scene_change.description）做译制腔改写。
- 不能：改写结果本身未经二次检测——单次重写 + 尽力替换就是全部，
  不循环直到 clean（避免无限成本）。
- 不能：重写质量取决于 LLM；若 LLM 返回仍带译制腔，本守卫不会再次拦截。
- 不能：覆盖探针词表之外的"未知译制腔形态"（封闭词表的固有局限）。
- 只对中文（language 归一化为 zh）生效；英文用户不触发。

降级策略：任何异常（provider 不可用、返回非 JSON、JSON 缺 id/text）都
**静默**保留原文本，绝不因守卫让正常对话崩溃。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from agents.dubbing_guard_probe import detect_dubbing_tone

logger = logging.getLogger(__name__)

# 事件类型 → 需要守卫的叙事字段（与 director 的英文残留守卫口径一致）。
_NARRATIVE_FIELDS: dict[str, str] = {
    "agent_think": "thought_content",
    "agent_speak": "content",
    "agent_act": "action",
    "scene_change": "description",
}

# 重写 prompt：聚焦"把译制腔改写成自然中文"，复用 zh 守则要点。
REWRITE_SYSTEM_PROMPT = (
    "你是中文母语者编辑，把《绝命毒师》角色扮演里的译制腔文本改写为自然中文。"
    "只改写，不新增内容、不改变角色本意与情绪。"
    "要求：\n"
    "- 起句用中文母语者习惯，消除「一想到X就Y」「当X的时候」这类英文直译骨架；\n"
    "- 消除「抽象名词+具体名词」硬拼意象（如「秩序的玻璃」）；\n"
    "- 消除书面翻译腔用词（事实上/本质上/内心深处/仿佛 等套话）；\n"
    "- 短句、直接、带停顿，像中文母语者在说话；\n"
    "- 角色中文名固定：Mike→麦克（禁米克）、Walter→沃尔特、Jesse→杰西、"
    "Skyler→斯凯勒、Saul→索尔、Gus→古斯、Hank→汉克、Todd→托德（禁托霍）、"
    "Jack Welker→杰克·维尔克（禁杰克·托霍）。\n"
    "返回 ONLY 一个 JSON 数组：[{\"id\":0,\"text\":\"自然中文\"}, ...]。"
    "不要 markdown 围栏，不要任何解释。"
)


def _norm_lang(lang: str | None) -> str:
    """与 director 一致的 UI 语言归一化。"""
    if not lang:
        return "en"
    return "zh" if str(lang).lower().startswith("zh") else "en"


def _collect_dubbing_jobs(
    events: list[dict[str, Any]],
) -> list[tuple[int, str, str]]:
    """返回 [(event_index, field, text)]，仅收集被探针判为 dubbing 的字段。

    clean / suspicious 一律不收集——这是"便宜原则"的实现点。
    """
    jobs: list[tuple[int, str, str]] = []
    for i, evt in enumerate(events):
        data = evt.get("data")
        if not isinstance(data, dict):
            continue
        field = _NARRATIVE_FIELDS.get(evt.get("type", ""))
        if not field:
            continue
        text = data.get(field)
        if not isinstance(text, str) or not text.strip():
            continue
        if detect_dubbing_tone(text)["verdict"] == "dubbing":
            jobs.append((i, field, text))
    return jobs


async def rewrite_dubbing_in_events(
    events: list[dict[str, Any]],
    provider: Any,
    model_route: str,
    language: str = "zh",
) -> list[dict[str, Any]]:
    """对事件列表中的中文文本做译制腔改写（仅 dubbing 触发）。

    Args:
        events: 事件 dict 列表（含 ``type`` / ``data``）。
        provider: 具备 ``call_model(messages, model_route) -> str`` 的对象
            （通常是 ``ProviderFacade``）
        model_route: 如 ``"stepfun/step-3.7-flash"``。
        language: UI 语言；仅 zh 触发，其余原样返回。

    Returns:
        改写后的事件列表。任何失败场景都返回**原事件**（优雅降级）。
    """
    if _norm_lang(language) != "zh" or not events:
        return events

    jobs = _collect_dubbing_jobs(events)
    if not jobs:
        return events

    # 一次 LLM 往返批量重写所有命中字段（保持一个守卫 = 一次调用）。
    payload = [{"id": n, "text": t} for n, (_i, _f, t) in enumerate(jobs)]
    messages = [
        {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    try:
        raw = await provider.call_model(messages, model_route)
        if not raw:
            return events
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = __import__("re").sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = __import__("re").sub(r"\s*```$", "", cleaned)
        rewritten = json.loads(cleaned)
        if not isinstance(rewritten, list):
            return events
        by_id = {
            int(item["id"]): str(item["text"])
            for item in rewritten
            if isinstance(item, dict) and "id" in item and "text" in item
        }
    except Exception:
        logger.exception("dubbing rewrite failed; keeping original text")
        return events

    # 应用改写：缺 id 或空文本时保留原文本。
    out = [dict(e) for e in events]
    for n, (i, field, _orig) in enumerate(jobs):
        new_text = by_id.get(n, "").strip()
        if not new_text:
            continue
        data = dict(out[i].get("data") or {})
        data[field] = new_text
        out[i] = {**out[i], "data": data}
    return out