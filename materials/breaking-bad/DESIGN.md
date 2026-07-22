# 绝命毒师角色扮演素材库设计

## 目标

为角色扮演聊天应用建立可检索、可控、可扩展的底层素材库，让模型回复更接近角色语气、关系张力和剧情世界观。

## 合法性边界

- 不在本地保存整集剧本、完整字幕、长段台词或大规模受版权保护文本。
- 可以保存来源链接、集数定位、角色关系摘要、场景功能、短引用位置、主题标签和自写分析。
- 角色语气规则应从多源摘要中抽象，不直接复制大段对白。

## 分层素材结构

1. Canon Layer：官方/半官方事实层
   - AMC 页面、剧集介绍、角色介绍、官方视频、主创访谈。
   - 用于校准人物关系、剧情节点和世界观边界。

2. Dialogue Signal Layer：对白信号层
   - 只保存短片段位置、关键词、语气特征和自写摘要。
   - 用于提取“Walter 的控制式解释”“Jesse 的焦虑口语”“Saul 的法律销售话术”等可泛化模式。

3. Production Commentary Layer：主创解释层
   - Vince Gilligan、编剧、演员访谈、幕后评论。
   - 用于提取角色动机、道德弧线、戏剧设计原则。
   - 核心优先级：Breaking Bad Insider Podcast、Television Academy、WGF writers room、PaleyFest、AMC cast scene pages、No Half Measures。

4. Community/Critical Layer：社区和评论层
   - Wiki、影评、论坛高信号讨论、学术/文化评论。
   - 用于补充角色关系解读和观众共识，但标记可靠性。
   - **Reddit rewatch/live hubs:** 只存链接与认知时态标签，见 `community/REWATCH_HUBS.md` 与 `INGEST_POLICY.md`。
   - **不是 Continuity 真相**（DEC-0006）。默认不纳入 BCS/El Camino 知识图；不把高赞评论当角色台词。

## 推荐数据表

### `sources.jsonl`

```json
{
  "id": "src_amc_character_walter",
  "title": "Walter White character page",
  "url": "https://...",
  "source_type": "official_character_page",
  "reliability": "high",
  "copyright_policy": "link_and_summary_only",
  "notes": "Use for canonical traits and relationship facts."
}
```

### `character_voice_rules.jsonl`

```json
{
  "character": "Walter",
  "rule": "Uses calm technical framing to convert panic into control.",
  "evidence_sources": ["src_..."],
  "relationship_effect": {
    "former student": "pedagogical, superior, corrective",
    "family member": "protective but defensive"
  },
  "prompt_snippet": "Speak with controlled precision and moral self-justification."
}
```

### `scene_functions.jsonl`

```json
{
  "episode": "S01E01",
  "scene_label": "classroom authority fracture",
  "characters": ["Walter", "Jesse"],
  "dramatic_function": "Shows Walter's need for control and Jesse's outsider status.",
  "retrieval_tags": ["authority", "former student", "chemistry", "humiliation"],
  "source_refs": ["src_..."]
}
```

## 检索策略

用户发消息时，后端可以按以下字段检索：

- `character`
- `user_relation`
- `emotion_state`
- `episode_arc`
- `relationship_tension`
- `dialogue_style`

检索结果不要直接拼大段素材，而是拼：

- 3-5 条角色语气规则。
- 1-2 条关系动态规则。
- 1 条场景功能摘要。
- 1 条禁止事项，例如不要输出现实犯罪方法。

## 下一步

等待来源调研完成后，将来源目录填入 `sources/`，再决定是否写入项目内的轻量 JSONL 素材库。
