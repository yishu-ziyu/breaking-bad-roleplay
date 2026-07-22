# Breaking Bad 素材库来源目录

> 目标：为角色扮演提示词和检索增强层提供来源索引。不要在本地保存整集剧本、完整字幕或长段受版权保护文本。
>
> **Active path:** `materials/breaking-bad/SOURCES.md` (restored 2026-07-22 from archive + community hubs).  
> **Community policy:** `community/INGEST_POLICY.md` · **Hub index:** `community/REWATCH_HUBS.md` · **ADR:** `docs/decisions/DEC-0006-community-signal-not-canon.md`

## 剧本 / 对白定位层

| 来源 | 类型 | 可用方式 | 风险 |
| --- | --- | --- | --- |
| [Sony Pictures - Breaking Bad](https://www.sonypictures.com/tv/breakingbad) | 官方权利方页面 | 保存官方系列身份、观看入口、频道链接 | 不复制媒体或官方正文；只保存事实元数据 |
| [Sony Clip & Still Image Licensing](https://www.sonypicturesstudios.com/filmclipandstilllicensing.php) | 官方授权入口 | 如果需要对白、剧本片段、剧照、片段，走授权路径 | 这是商业/公开使用对白和剧本摘录的正当路径 |
| [Script Slug - Breaking Bad](https://www.scriptslug.com/scripts/series/breaking-bad-2008) | 剧本索引 | 保存链接、集数、剧本是否存在、发现状态 | 不能授权商业使用；不要下载/向量化全文 |
| [8FLiX Breaking Bad transcripts](https://8flix.com/transcripts/breaking-bad-season-1-dialogue/) | transcript 索引 | 保存集数页面和元数据 | 不保存全文 transcript 或登录下载内容 |
| [Breaking Bad Wiki - Category: Transcripts](https://breakingbad.fandom.com/wiki/Category%3ATranscripts) | 粉丝整理剧集 transcript 索引 | 保存链接、集数、场景标签、角色出场、对白风格摘要 | 不复制长段 transcript；只做定位和自写分析 |
| [Wikiquote - Breaking Bad](https://en.wikiquote.org/wiki/Breaking_Bad) | 台词发现索引 | 保存 quote locator，不保存批量台词 | CC BY-SA 不等于清除了剧集对白版权 |
| [IMDb Quotes - Breaking Bad](https://www.imdb.com/title/tt0903747/quotes/) | 用户提交 quote 数据库 | 保存 IMDb URL/ID | IMDb 条款限制下载和修改；不要复制 quote 库 |
| [Breaking Bad Wiki - Walter White](https://breakingbad.fandom.com/wiki/Walter_White) | 角色百科 | 保存角色关系、别名、剧情节点摘要 | Fandom 非官方，需标记可靠性为 medium |
| [Breaking Bad Wiki - Jesse Pinkman](https://breakingbad.fandom.com/wiki/Jesse_Pinkman) | 角色百科 | 保存人物关系、背景、转折事件摘要 | Fandom 非官方，需交叉验证 |
| [Wikipedia - List of Breaking Bad episodes](https://en.wikipedia.org/wiki/List_of_Breaking_Bad_episodes) | 剧集元数据索引 | 保存集数、标题、播出时间、编剧、导演等事实字段 | 若复制表格/文字需 CC BY-SA 归属；优先规范化事实 |

## 主创 / 幕后解释层

| 来源 | 类型 | 可用方式 | 价值 |
| --- | --- | --- | --- |
| [Harvard Gazette - Breaking down Bad](https://news.harvard.edu/gazette/story/2014/04/breaking-down-bad/) | Vince Gilligan 访谈/活动报道 | 提取 Walter 作为反英雄/道德滑坡案例的创作原则 | 用于系统提示词的道德边界和角色弧线 |
| [GQ - Vince Gilligan: The Man Who Made Us Watch](https://www.gq.com/story/vince-gilligan-breaking-bad-interview) | 长访谈 | 提取 showrunner 创作意图、人物复杂性和叙事设计 | 用于角色长期动机层 |
| [Los Angeles Times - Vince Gilligan finale interview](https://www.latimes.com/entertainment/tv/showtracker/la-et-st-breaking-bad-vince-gilligan-interview-story.html) | 主创终局访谈 | 提取结局、审判、代价主题 | 用于最终季弧线和道德后果 |
| [TV Insider - Breaking Bad 10th Anniversary interview](https://www.tvinsider.com/660444/breaking-bad-anniversary-interview-vince-gilligan/) | 周年访谈 | 提取剧集遗产、角色回看 | 用于总体世界观 |
| [Breaking Bad Insider Podcast](https://metacast.app/podcast/breaking-bad-insider-podcast/uosRIkMD) | 主创/剪辑/演员播客索引 | 保存单集链接、嘉宾、主题摘要，不保存完整转录 | 用于编剧室决策、场景功能、表演语气 |
| [Breaking Bad Insider Podcast - Apple Podcasts](https://podcasts.apple.com/us/podcast/breaking-bad-insider-podcast/id311058181) | 官方 AMC 播客 | 保存 podcast episode、嘉宾、时间戳、自写笔记 | 不转录/再发布完整音频或全文转写 |
| [The Guardian - Vince Gilligan interview](https://www.theguardian.com/media/2013/aug/18/breaking-bad-vince-gilligan-walter-white) | 主创访谈 | 提取观众同情、Walter 道德滑坡、终局意图 | 访谈摘要可用，不长引 |
| [AMC Central Europe - Breaking Bad](https://ce.amc.com/series/breaking-bad) | 官方系列页 | 保存官方 synopsis、创作者、演员、年份 | 高层事实，不够细 |
| [Television Academy - Breaking Bad](https://interviews.televisionacademy.com/shows/breaking-bad) | 视频档案 | 保存 speaker、clip title、topic、craft axis | 高价值 primary archive，适合提取 casting、editing、pacing |
| [Writers Guild Foundation - Inside the Writers Room with Breaking Bad](https://www.wgfoundation.org/blog/inside-writers-room-breaking-bad) | 编剧室 panel | 保存 writers、room process、plot rule、character logic | 提取“角色驱动剧情”的底层规则 |
| [PaleyFest 2010 - Breaking Bad](https://www.paleycenter.org/collection/item?item=101056&p=51&q=actors) | 主创/演员 panel | 保存日期、cast、season context、early character read | 适合早期角色定位，不被后期神话覆盖 |
| [AMC - Aaron Paul favorite Jesse scenes](https://www.amc.com/blogs/aaron-paul-shares-five-of-his-favorite-jesse-pinkman-scenes-from-breaking-bad--1004397) | AMC 演员场景解读 | 保存 scene refs、emotional state、voice guardrails | Jesse 情绪、愧疚、被操控感 |
| [AMC - Cast favorite scenes](https://www.amc.com/blogs/the-breaking-bad-cast-recounts-their-favorite-scenes--1004385) | AMC cast 场景索引 | 保存 actor、character、turning point、performance note | 快速定位各角色定义性场景 |
| [AMC - Comic-Con Panel Highlights](https://www.amc.com/blogs/breaking-bad-comic-con-panel-highlights--1004381) | AMC panel highlight | 保存 topic、tone rule、series rule | 暴力/后果/角色工作方式 |
| [Backstage - Giancarlo Esposito Finds Strength in Silence](https://www.backstage.com/magazine/article/giancarlo-esposito-finds-strength-silence-breaking-bad-55202/) | 演员访谈 | 保存 Gus 的 silence rule、voice density、threat style | Gus 的克制威胁和少言风格 |
| [TIME - Aaron Paul on El Camino](https://time.com/5690489/aaron-paul-breaking-bad-el-camino-interview/) | 演员回访 | 保存 post-finale Jesse trauma state | 用于 Jesse 后期/后传边界 |
| [Guardian - Inside the Breaking Bad Writers' Room](https://www.theguardian.com/tv-and-radio/2013/sep/20/breaking-bad-writers-room-vince-gilligan) | 编剧室报道 | 保存 act structure、decision trace、room process | secondary source，用于补足 WGF panel |
| [No Half Measures](https://www.imdb.com/title/tt3088036/) | 最终季纪录片 | 保存 final-season production notes、character closure | 需通过官方 home media 获取，不保存片段 |
| [Blu-ray.com - Complete Series details](https://www.blu-ray.com/news/?id=12096) | home media 信息 | 保存 bonus feature、commentary tracks、availability | 获取 commentaries/featurettes 的采购索引 |

## 社区 / 评论 / 学术层

| 来源 | 类型 | 可用方式 | 可靠性 |
| --- | --- | --- | --- |
| [Wikipedia - Breaking Bad](https://en.wikipedia.org/wiki/Breaking_Bad) | 二级百科 | 保存制作背景、获奖、剧集定位 | medium，高层背景可用 |
| [Wikipedia - Walter White](https://en.wikipedia.org/wiki/Walter_White_%28Breaking_Bad%29) | 二级百科 | 保存角色创作背景和人物弧线摘要 | medium |
| [Wikipedia - Jesse Pinkman](https://en.wikipedia.org/wiki/Jesse_Pinkman) | 二级百科 | 保存角色定位和创作背景 | medium |
| [Harvard DASH - What's the Matter with Walter?](https://dash.harvard.edu/bitstreams/7312037e-734a-6bd4-e053-0100007fdf3b/download) | 学术论文/PDF | 提取 Walter 的道德心理分析 | high for analysis, not canon |
| [Alan Sepinwall - Phoenix review](https://www.whatsalanwatching.com/breaking-bad-phoenix-theres-no-real-way/) | 专业剧评 | 提取 Walt/Jesse 关系和转折标签 | 不复制剧评里的台词片段 |
| [AV Club - Cornered review](https://www.avclub.com/breaking-bad-cornered-1798169338) | 专业剧评 | 提取 Walt/Skyler 权力转移、自我神话化 | 批评解读，不是 canon |
| [New Yorker - Child's Play](https://www.newyorker.com/magazine/2012/08/27/childs-play-5) | 评论文章 | 提取观众共谋、家庭/儿童道德轴 | 解读性强，需标注 |
| [Cambridge Core - Television from the Superlab](https://www.cambridge.org/core/journals/journal-of-american-studies/article/abs/television-from-the-superlab-the-postmodern-serial-drama-and-the-new-petty-bourgeoisie-in-breaking-bad/88068C78E8830A365747A76E6F4CD230) | 学术论文 | 提取阶层、科学、现代性框架 | 可能 paywall，只用可访问摘要或合法访问 |
| [Springer - Philosophy and Breaking Bad](https://link.springer.com/book/10.1007/978-3-319-40343-4) | 学术书 | 提取伦理、法律、责任框架 | 需要合法访问 |
| [Reddit discussion - relationship between Walt and Jesse](https://www.reddit.com/r/breakingbad/comments/sj43qx) | 社区讨论 | 只保存讨论主题、观点聚类、链接 | low/medium；不引用长段评论 |
| [Reddit discussion - Gilligan writing method](https://www.reddit.com/r/breakingbad/comments/boyusr) | 社区转述 | 只作为线索，不作为事实依据 | low，需找原访谈交叉验证 |

### Reddit rewatch / live hubs (index only — no comment dumps)

Full field table: [`community/REWATCH_HUBS.md`](./community/REWATCH_HUBS.md).  
Ingestion rules: [`community/INGEST_POLICY.md`](./community/INGEST_POLICY.md).  
Horizon crosswalk: [`continuity/KNOWLEDGE_HORIZONS.md`](./continuity/KNOWLEDGE_HORIZONS.md).

| Hub | URL | Horizon | Usable for |
| --- | --- | --- | --- |
| Subreddit home | https://www.reddit.com/r/breakingbad/ | mixed | locator only |
| 2016 Official Rewatch S01E01 (no future spoilers) | https://www.reddit.com/r/breakingbad/comments/4rif5u/official_2016_rewatch_breaking_bad_episode/ | `episode_t` | eval, craft |
| 2014–15 Re-Watch S01E01 (spoilers through Felina allowed) | https://www.reddit.com/r/breakingbad/comments/1svss0/breaking_bad_episode_discussion_s01e01_pilot/ | `full_series` | craft only |
| Live discussion archive (≈S03E02→S05) | https://www.reddit.com/r/breakingbad/comments/1kf8g8/breaking_bad_episode_discussion_archive/ | `incomplete_live` | eval (misreads) |
| S05E01 Live Free or Die (air-date live) | https://www.reddit.com/r/breakingbad/comments/wmc5d/breaking_bad_episode_discussion_s05e01_live_free/ | `incomplete_live` | eval sample |
| S05E16 Felina (finale live) | https://www.reddit.com/r/breakingbad/comments/1neqth/breaking_bad_episode_discussion_s05e16_felina/ | end-of-journey | eval, craft |
| El Camino 2019 series rewatch mega | https://www.reddit.com/r/breakingbad/comments/d4scr1/countdown_to_el_camino_the_brba_series_rewatch/ | `cross_series` (default graph OFF) | craft only |
| 2019 S01E01 / S01E02 threads | [Pilot](https://www.reddit.com/r/breakingbad/comments/d4sagi/series_rewatch_thread_s01_e01_pilot/) · [E02](https://www.reddit.com/r/breakingbad/comments/d4siij/series_rewatch_thread_s01_e02_cats_in_the_bag/) | same as mega | craft |

**Product defaults (2026-07-22):** community signal never writes Continuity without a human Continuity PR; BCS/El Camino off default knowledge graph; no-spoiler per-episode mode not default UX (eval/craft first).

## 本地素材库字段建议

### `sources.jsonl`

```json
{
  "id": "src_fandom_transcripts",
  "title": "Breaking Bad Wiki - Category: Transcripts",
  "url": "https://breakingbad.fandom.com/wiki/Category%3ATranscripts",
  "source_type": "transcript_index",
  "reliability": "medium",
  "copyright_policy": "link_and_summary_only"
}
```

### `voice_rules.jsonl`

```json
{
  "character": "Walter",
  "rule": "Frames emotional conflict as a problem of discipline, competence, and control.",
  "relationship_context": ["former student", "family member", "lab partner"],
  "source_refs": ["src_fandom_walter", "src_harvard_gazette_gilligan"],
  "confidence": "medium"
}
```

### `relationship_dynamics.jsonl`

```json
{
  "pair": ["Walter", "Jesse"],
  "dynamic": "A teacher-student hierarchy mutates into dependence, coercion, guilt, and intermittent care.",
  "usable_prompt_rule": "Walter should sound corrective and paternal, but the subtext should carry leverage and defensive pride.",
  "source_refs": ["src_fandom_walter", "src_fandom_jesse", "src_reddit_walt_jesse_relationship"],
  "confidence": "medium"
}
```

## 下一步处理原则

1. 先建 `sources.jsonl`，只保存链接和元数据。
2. 对每个角色写 10-20 条自写 `voice_rules`，每条规则绑定来源。
3. 对核心关系写 `relationship_dynamics`。
4. 再把检索结果注入当前应用的 `buildContextPrompt`，而不是把剧本文本直接塞给模型。

## 版权红线

- 不下载、抓取或保存整集 scripts、transcripts、subtitles、SRT。
- 不用完整对白、字幕或剧本生成 embedding 或 fine-tuning 数据。
- 不保存 “某角色全部台词” 或大规模 quote collection。
- 不把 Fandom/Wikiquote 的 CC BY-SA 当成底层剧集对白版权授权。
- 不声称应用或输出是 Sony/AMC 官方产品。
- 若需要真实对白、剧本片段、剧照、音频或视频片段，走 Sony 官方授权路径。
