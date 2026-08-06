# 线上译制腔扩散检查埋点

> 范围：中文 Story 模式输出
> 目标：统计线上中文 Story 的译制腔漏网率，作为是否激活改写守卫的决策信号
> 关联：`docs/PRODUCT_SPEC.md`、`docs/BLIND_AB_RETROSPECTIVE.md`、`backend/agents/dubbing_guard_probe.py`、`backend/agents/dubbing_rewrite.py`

---

## 1. 目标与范围

一句话目标：统计线上中文 Story 输出的译制腔漏网率，漏网率上升时激活改写守卫（`backend/agents/dubbing_rewrite.py`）。

这是产品手册"回归测试 + A/B 盲测 + 线上扩散检查"三件套的最后一件。前两件已完成：
- 回归测试：`backend/tests/test_dubbing_rewrite.py`、`test_dubbing_guard_probe.py`、`test_story_language.py`。
- A/B 盲测：`scripts/blind_ab_runner.md`，结论是守则本身已把中文拉到 8 分档，守卫因此被下调优先级。

本埋点要补上的，是盲测覆盖不到的那一块：**真实线上、真实用户文案、真实模型输出**里的漏网率。盲测是抽样，埋点是普查；盲测能看见"有没有量"，埋点要给"有多大规模"一个数字。

**范围边界：**
- 只测 **中文 Story** 模式。Detection 挂在 `director._generate_beat`，该函数是 Story 专用路径（Direct/Crew 走 `handle_chat_message`），天然把范围框死。
- 只测 **中文**（`_norm_lang(language) == "zh"`）。英文用户零感知、零埋点。
- 只测 **最终输出**（用户真正看到的文本），不测中间态。
- 不测 Direct / Crew / 英文。它们的语言处理路径不同，不在本件范围内。

---

## 2. 方案概述

复用现有检测器 `backend/agents/dubbing_guard_probe.py` 的 `detect_dubbing_tone(text) -> {score, matches, verdict}`，verdict ∈ {clean, suspicious, dubbing}。

在中文 Story 每拍文本最终确定处，对每个叙事字段跑一次检测，把非 clean 的命中写一条结构化日志。**纯后端、纯规则、零成本**：
- 不产生额外 LLM 调用（检测器是正则/关键词/字符统计，本机跑）。
- 不改任何输出。检测只读，不写回事件。
- 不打扰用户。用户看到的文本、SSE 流、持久化消息，全部原样。

落点是**日志**，不引入新分析平台、不改数据库 schema、可随时回滚。命中日志带 `session_id`、`role`、`locale`、`verdict`、`matches`、`score` 等字段，供后续按 session 或按消息聚合。

设计原则：**先探针，后决策**。便宜拿到信号，再决定是否投入重资源（守卫）。这是本轮之前盲测复盘沉淀下来的做事方式——`BLIND_AB_RETROSPECTIVE.md` 第七节明确写了"守卫激活触发条件：明确一个阈值，作为激活改写守卫的决策点"。本埋点就是那个触发条件的信号源。

---

## 3. 埋点点

**位置：`backend/agents/director.py` 的 `_generate_beat` 方法内，dubbing rewrite 之后、Phase 2 yield 循环之前。**

具体地，在 `_generate_beat` 里：
- 当前结构：`_prepare_beat_events`（L1454）→ `_rewrite_english_fields_to_zh`（L1457）→ `normalize_zh_names_in_events`（L1460-1461）→ …角色子代理逐拍改写 `agent_speak`（L1539-1871）→ **dubbing rewrite**（L1879-1885，`if _norm_lang(language) == "zh"`）→ **Phase 2 yield 循环**（L1890）。

埋点代码插在 L1885 与 L1890 之间，即 dubbing rewrite 结束、`for evt in events:` 开始之前。

**为什么是这里：**
1. **文本已最终确定**。到这一行，`agent_speak.content`、`agent_think.thought_content`、`agent_act.action`、`scene_change.description` 都已经过角色子代理改写、英文字段转中、zh 名归一化、守卫改写（若命中）。接下来 yield 循环只是原样送出这些事件。在这里测量，测的就是用户最终看到的文本。
2. **语义正确**。埋点在守卫之后，意味着"被守卫成功改写掉的 dubbing 文本"不计入漏网——它们已被修复，用户没看到。漏网率应当只反映"最终仍带译制腔的文本"。这正是扩散检查想测的东西。
3. **天然是 Story + 中文**。`_generate_beat` 只被 Story 路径调用；外面再用 `_norm_lang(language) == "zh"` 包一层，英文直接跳过。

**要记录的结构化字段：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `session_id` | `_generate_beat` 的 `session_id` 参数 | 关联会话，用于按 session 聚合 |
| `beat_index` | `_generate_beat` 的 `beat_index` 参数 | 第几拍，便于定位 |
| `event_type` | 事件 `type` | agent_speak / agent_think / agent_act / scene_change |
| `role` | 事件 `data.character_id` | 说话角色（如 Walter White），agent_act/scene_change 可能为空 |
| `locale` | 固定 `"zh"` | 便于日志过滤 |
| `verdict` | `detect_dubbing_tone` 返回值 | clean / suspicious / dubbing |
| `score` | 检测器返回 | 累加匹配权重 |
| `matches` | 检测器返回 | 命中的特征描述列表（越长越可疑） |
| `msg_chars` | `len(text)` | 文本长度，便于归一化/过滤噪声 |

**记录判定**：只对 `verdict == "dubbing"` 或 `"suspicious"` 的字段写日志；`clean` 不写，避免日志爆炸。若想更省，可只写 `dubbing`——但 `suspicious` 是"逼近译制腔"的早期信号，建议保留，聚合时分开看。

**示意代码**（实现时，非完整实现）：

```python
# Phase 2 之前，dubbing rewrite 之后
if _norm_lang(language) == "zh":
    for evt in events:
        et = evt.get("type")
        field = {
            "agent_speak": "content",
            "agent_think": "thought_content",
            "agent_act": "action",
            "scene_change": "description",
        }.get(et)
        if not field:
            continue
        text = (evt.get("data") or {}).get(field)
        if not isinstance(text, str) or not text.strip():
            continue
        probe = detect_dubbing_tone(text)
        if probe["verdict"] != "clean":
            logger.warning(
                "diffusion_monitor "
                "session_id=%s beat=%s event=%s role=%s locale=zh "
                "verdict=%s score=%s matches=%s msg_chars=%d",
                session_id, beat_index, et, (evt.get("data") or {}).get("character_id"),
                probe["verdict"], probe["score"], probe["matches"], len(text),
            )
```

注意：`matches` 列表可能较长，若日志膨胀可只保留前 3 条或做截断。守卫 `_collect_dubbing_jobs` 目前只在 `dubbing` 时才收集并调用 `detect_dubbing_tone`，埋点需要**独立调用**检测器（因为要统计 clean/suspicious/dubbing 全部分布），不能复用守卫的收集结果。

---

## 4. 日志格式与聚合

**推荐日志行格式**：复用现有 logging 框架（`backend/main.py` L16-20 已配置 `%(asctime)s %(levelname)s %(name)s %(message)s`），在 `message` 里放结构化字段，前面加固定标记 `diffusion_monitor` 便于 grep。

```text
2026-08-05 14:32:01 WARNING agents.director diffusion_monitor session_id=a1b2... beat=2 event=agent_speak role=Walter White locale=zh verdict=dubbing score=3.0 matches=["直译骨架:一想到","翻译腔用词:内心深处"] msg_chars=42
```

- 用 `logging.getLogger("agents.director")` 现有 logger，或单独 `logging.getLogger("diffusion_monitor")`。建议单独 logger，级别 `WARNING`，这样生产日志默认会带出来，且集中在一个名字下便于 `grep diffusion_monitor` 聚合。
- 若未来要进分析平台，可无缝升级为 JSON 行（`json.dumps` 一个 dict），当前纯文本格式足够 grep 聚合。

**聚合方式**（两种口径，先用消息级）：

- **按消息统计漏网率**（主口径）：
  ```
  漏网率 = dubbing 命中的消息数 / 中文 Story 消息总数
  ```
  分子 = 本埋点日志里 verdict=dubbing 且 event=agent_speak 的条数（suspicious 单列，不进 dubbing 分子）。分母 = 中文 Story 产出的 agent_speak 消息总数——可从 `Message` 表按 `session_id` 关联 `Session.current_mode='story'` 且 `language='zh'` 统计，或按埋点统计的"所有中文 agent_speak 字段数"（即 clean 的也计入分母，需要埋点同时给 clean 计数，或另加一个只计数不落日志的 clean 累计）。

  关键点：**分母必须覆盖 clean**。若只记 dubbing 命中、不记 clean，分子分母就对不上。方案：埋点对每个被测字段都写一条 `diffusion_monitor` 日志（含 clean），或额外维护一个进程内计数器累计消息总数。推荐前者（简单、可审计），代价是日志量大，可用 `msg_chars` 和采样率控制。

- **按 session 统计**：`grep diffusion_monitor | awk '{print $N}' | sort | uniq -c` 按 session_id 分组，看"有多少会话至少出现一次 dubbing"。用于判断问题是否集中爆发在少数会话，还是普遍存在。

- **按角色统计**：`role` 字段分组，看漏网是否集中在某个角色（如某角色 prompt 更松）。

**聚合命令示意**（grep 即可，无需新平台）：

```bash
grep 'diffusion_monitor' /var/log/bb/backend.log | grep 'verdict=dubbing' | wc -l   # dubbing 命中数
grep 'diffusion_monitor' /var/log/bb/backend.log | grep 'event=agent_speak' | wc -l  # 中文 Story 消息总数（分母）
```

---

## 5. 命中阈值建议

激活守卫的触发条件，建议两条件**任一满足**即激活：

1. **消息级 dubbing 漏网率 > 5%**（dubbing 命中 agent_speak 数 / 中文 Story agent_speak 总数），连续 **7 天**均值跌破或超过该线。
2. **单日 dubbing 命中数 > 20 条**（防"平均线好看但单日尖峰"）。

**理由：**
- 盲测里实验组（跳过守则）分差是 +1.7，非灾难级，说明守则本身已把漏网压得较低。5% 是"明显恶化"的线，不是"偶发"的线——偶发个位百分比不值得为它付一次额外 LLM 调用的成本。
- 连续 7 天是为了过滤单日波动（模型版本、时段、用户样本偏差）。
- 单日 20 条是"异常尖峰"保护，防止漏网集中在某一天被 7 日均值稀释。
- 也可加一个**下界**：若样本量太小（如 7 天中文 Story 消息总数 < 200），阈值判定不成立，需继续积累——否则统计噪声会误触守卫。

**注意：以上是建议值，需产品确认后写入决策点。** 当前守卫代码已存在（`dubbing_rewrite.py`），激活只是把 `_generate_beat` 里已有但被调低优先级的守卫调用转正（或加开关），无需重写。

建议先跑 **2-4 周埋点**拿基线，再用基线校准阈值，而不是拍脑袋定 5%。

---

## 6. 上线步骤

| 步骤 | 动作 | 验证方式 |
|------|------|----------|
| 1 | 在 `_generate_beat` 实现检测调用（dubbing rewrite 之后、yield 之前），新增 `diffusion_monitor` logger | 单测：构造含 dubbing 文本的 beat，断言日志出现 verdict=dubbing 且字段齐全 |
| 2 | 加日志（含 session_id / role / locale / verdict / matches / score / msg_chars） | 单测：断言日志内容含 session_id、role、verdict |
| 3 | 跑全量后端测试 `cd backend && uv run pytest` | 全绿，确认不破坏现有行为（尤其 `test_dubbing_rewrite.py`、`test_story_language.py`） |
| 4 | 本地起服务 `uvicorn main:app --reload --port 8001` | 用 curl 或网页发一条中文 Story 消息，看日志出现 `diffusion_monitor` 行 |
| 5 | 部署到 VM（`docs/OPS_RUNBOOK.md` 的 Docker 流程） | 打开 60 秒 smoke：确认线上日志出现埋点行、用户无感知变化 |
| 6 | 观察 2-4 周，grep 聚合漏网率 | 每周记一次漏网率，攒基线 |
| 7 | 按第 5 节阈值决策是否激活守卫 | 达阈值 → 激活守卫（转正 `dubbing_rewrite` 调用）；未达 → 继续观察 |

**部署要点**：本次只改后端检测 + 日志，属于"动 API"范畴，按 `OPS_RUNBOOK.md` 需重建 VM 容器；纯日志不涉及 quota/TTS/迁移，但仍走 VM 重建路径。前端无需改动。

---

## 7. 回滚方案

埋点是**纯增量、零副作用**的检测日志，回滚极简单：

- **回滚检测调用**：删除 `_generate_beat` 里新增的检测循环（或用一个环境变量开关 `DIFFUSION_MONITOR_ENABLED` 控制，默认关/开都行）。删除后线上行为字节级不变——因为检测只读、不写回事件、不碰 SSE、不碰持久化。
- **不影响线上行为**：检测器是纯函数，不调用 LLM、不连库、不写库。移除后，用户看到的输出、`Message` 表、dossier 全部不受影响。
- **回滚验证**：删除后跑 `cd backend && uv run pytest` 确认全绿，重建 VM，smoke 确认无 `diffusion_monitor` 日志、其余行为不变。

无需数据库迁移、无需前端改动、无需改 `.vercelignore`。这是"日志优先"方案的最大好处。

---

## 8. 验证

验证埋点本身工作，分两层：

**单元测试（RED→GREEN）**：
- 给 `_generate_beat` 注入含 dubbing 文本（如 `DUBBING_TEXT = "一想到你，我就觉得内心深处的恐惧。"`，见 `test_dubbing_rewrite.py` L19）的 LLM 返回，捕获 `caplog` 或 mock logger，断言出现 `diffusion_monitor` 且 `verdict=dubbing`、`session_id` 正确。
- 注入 clean 文本，断言不落 dubbing 日志（或按设计落 clean 计数）。
- 注入英文文本，断言零埋点（`_norm_lang` 非 zh 分支）。

**本地实证**：
1. `cd backend && uvicorn main:app --reload --port 8001`
2. 用中文 UI 进 Story 模式，发一条消息。
3. 终端日志出现 `diffusion_monitor ... verdict=...` 行。
4. 确认 SSE 流、前端渲染、`Message` 持久化与埋点前完全一致（无感知变化）。

**线上实证**：部署后跑 `docs/OPS_RUNBOOK.md` 的 60 秒 smoke，`grep diffusion_monitor` 见埋点，同时确认无任何多余 LLM 调用（埋点不产生）。

---

## 9. 局限

诚实列出，不粉饰：

1. **只覆盖规则层可识别的译制腔**。检测器是封闭词表（`dubbing_guard_probe.py` 的六类特征），漏掉未列出的表达。漏网率是"规则层查到的漏网率"，不是"真实译制腔总量"。真实总量只能靠抽样盲测（已做）或 LLM 评审（贵）补。
2. **不测真实 LLM 质量**。埋点只测"规则是否命中"，不测语义、自然度、角色一致性。一个文本完全没命中词表、但读起来很别扭，会被计为 clean。这是工具固有边界，不是实现缺陷。
3. **纠缠守卫与埋点的时序**。埋点在守卫之后，若守卫未来激活，dubbing 文本会被改写、不再计入漏网——这会让漏网率"塌陷"，不能据此误判"毒排掉了"。届时需把埋点移到守卫之前，或记录守卫改写前后的双 verdict。
4. **误报/漏报**。词表偏保守（避免误伤正常"N的"），可能漏报；个别正常表达（如角色故意说"仿佛"）会被误判为 suspicious。统计口径上建议只认 dubbing 为漏网，suspicious 作参考。
5. **样本偏差**。只测进 Story 且用中文的用户，不代表全量用户的中文质量。且日志采样与否会影响分母完整性，需保证分母覆盖 clean。
6. **不测 Direct/Crew/英文**。这三个路径的语言处理不同，本件不覆盖，若后续要测需另起埋点。

---

## 附：关键文件速查

| 文件 | 作用 |
|------|------|
| `backend/agents/dubbing_guard_probe.py` | 检测器 `detect_dubbing_tone(text) -> {score, matches, verdict}` |
| `backend/agents/dubbing_rewrite.py` | 守卫原型 `rewrite_dubbing_in_events`（detect→rewrite，仅 dubbing 触发） |
| `backend/agents/director.py` | `_generate_beat` 埋点目标；`_norm_lang`、`language` 参数 |
| `backend/main.py` | logging 配置（L16-20） |
| `backend/tests/test_dubbing_rewrite.py` | 测试风格参考（pytest + `director`/`mock_provider` fixtures） |
| `docs/BLIND_AB_RETROSPECTIVE.md` | 三件套背景、守卫阈值决策点 |
| `docs/PRODUCT_SPEC.md` | 三件套表述（L24） |