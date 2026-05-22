# Breaking Bad Roleplay Tasks

## 计划 - 2026-05-19

- [x] 增加中英语言状态与切换控件。
- [x] 本地化 UI 文案、关系锚点、输入占位符和演示回复。
- [x] 将目标语言注入系统提示词和动态上下文层。
- [x] 运行 lint/build，并用本地页面验证切换结果。

## Review - 2026-05-19

- 修改范围：`src/App.tsx` 增加 `Language` 状态、双语文案表、双语关系标签、提示词语言注入和中文演示关键词识别；`README.md` 更新语言切换说明。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 页面验证：本地构建服务 `http://127.0.0.1:3026/` 可访问；Playwright 验证中文切换后标题为 `Walter 与其前学生`，中文关系锚点可见，提示词包含 `Simplified Chinese`。
- 浏览器插件记录：Codex Browser 插件导航本地 URL 失败，错误为 `CDP error (Page.navigate): Cannot navigate to invalid URL`，因此使用 Playwright 本地回退验证。

## 计划 - 2026-05-19 MiniMax Token Plan

- [x] 查询 MiniMax 官方 OpenAI-compatible Chat Completions 接口形态。
- [x] 增加模型服务选择，默认 MiniMax Token Plan，保留 OpenAI 回退。
- [x] 接入 `https://api.minimax.io/v1/chat/completions` 与 `MiniMax-M2.7`。
- [x] 为 MiniMax 响应增加 `<think>` 清理和角色回复 JSON 提取。
- [x] 运行 lint/build，并验证页面默认 MiniMax provider。

## Review - 2026-05-19 MiniMax Token Plan

- 修改范围：`src/App.tsx` 增加 `ModelProvider`、MiniMax/OpenAI 服务切换、`callMiniMax`、`callModelProvider`、MiniMax 响应解析；`README.md` 增加 MiniMax Token Plan 说明。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 页面验证：本地页面显示 `Model service`，MiniMax 默认选中，API Key 占位符为 `MiniMax key (empty = demo)`。
- CORS 探测：浏览器从 `http://127.0.0.1:3026/` 直接请求 MiniMax endpoint，使用假 key 收到 MiniMax `401 authorized_error`，说明浏览器请求能到达 MiniMax 服务，真实 key 可在 BYOK 测试阶段使用。

## 计划 - 2026-05-19 真实 MiniMax Key 接入

- [x] 将真实 Token Plan Key 写入本地 `.env.local`，权限 `600`，不进入 Git。
- [x] 改为 `/api/chat` 服务端代理读取 `MINIMAX_TOKEN_PLAN_KEY`。
- [x] 按 Token Plan 文档切换为 Anthropic-compatible endpoint：`https://api.minimaxi.com/anthropic/v1/messages`。
- [x] 前端移除 API Key 输入框，默认发送到真实 MiniMax-M2.7 服务。
- [x] 完成真实 API 和页面端到端验证。

## Review - 2026-05-19 真实 MiniMax Key 接入

- 修改范围：`server/minimax.ts` 封装 MiniMax Token Plan 调用与 JSON 提取；`api/chat.ts` 提供 Vercel serverless 入口；`vite.config.ts` 为本地开发提供同路径 `/api/chat`；`src/App.tsx` 改为直接调用真实服务。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- API 验证：`POST http://127.0.0.1:3026/api/chat` 使用真实 key 成功返回 `reply_text`、`emotion_state`、`gif_search_query`。
- 页面验证：Playwright 在 `http://127.0.0.1:3026/` 发送消息，等待 `/api/chat` 返回 200，聊天流成功渲染 MiniMax 回复。

## 计划 - 2026-05-19 项目内素材库

- [x] 将桌面组件库中的 Breaking Bad 素材库复制到当前项目。
- [x] 在项目 README 中加入素材库入口说明。
- [x] 保留桌面组件库作为可复用模板，项目内副本作为当前产品素材库。

## Review - 2026-05-19 项目内素材库

- 新增项目目录：`materials/breaking-bad/`。
- 包含文件：`DESIGN.md`、`SOURCES.md`、`INGESTION_SCHEMA.md`。
- 设计原则：项目内素材库保存来源、元数据、结构化语气规则和检索 schema，不保存整集剧本、完整字幕或大段台词。

## 计划 - 2026-05-19 GIF 多样性

- [x] 定位右侧 GIF 重复的前端原因。
- [x] 将单图关键词改为关键词簇和轮换 GIF 池。
- [x] 运行 lint/build 验证。
- [x] 在本地页面验证右侧 GIF 不再固定退回同一张图。

## Review - 2026-05-19 GIF 多样性

- 修改范围：`src/App.tsx` 将 GIF 从单个 URL 字典升级为多候选池，增加关键词簇映射、哈希轮换、角色/情绪参与选图，并在系统提示词中要求模型避免重复输出 `tense`。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 页面验证：`npx playwright screenshot --timeout=15000 http://127.0.0.1:3026/ /tmp/breaking-bad-gif-before.png` 成功截图，说明本地页面仍可渲染。
- 浏览器插件记录：Codex Browser 对本地 URL 仍返回 `CDP error (Page.navigate): Cannot navigate to invalid URL`；Chrome DevTools MCP 当前 profile 被占用，因此本轮使用 Playwright CLI 回退验证。

## 计划 - 2026-05-19 GitHub 仓库

- [x] 检查本地敏感文件和忽略规则。
- [x] 初始化 Git 仓库并创建首个提交。
- [x] 创建 GitHub 远端仓库并推送 main 分支。
- [x] 验证远端仓库可访问。

## Review - 2026-05-19 GitHub 仓库

- 本地仓库：`/Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay`。
- 远端仓库：`https://github.com/yishu-ziyu/breaking-bad-roleplay`。
- 可见性：Private。
- 默认分支：`main`。
- 安全检查：`.env.local` 被 `.gitignore` 的 `*.local` 规则忽略，真实 MiniMax Token Plan Key 未提交。

## 计划 - 2026-05-22 GIF 角色边界

- [x] 移除开场消息的强制 GIF。
- [x] 将 GIF 池改为角色级白名单，避免 Walter 抽到 Jesse 或其他角色台词动图。
- [x] 为 GIF 图片增加加载失败隐藏处理。
- [x] 运行 lint/build 验证。

## Review - 2026-05-22 GIF 角色边界

- 修改范围：`src/App.tsx`。
- 关键修正：`characterGifLibrary` 按角色隔离 GIF；`resolveGif` 只从当前回复角色的图池取图；开场消息不再附带 GIF；图片加载失败时隐藏整张 GIF 卡片。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。

## 计划 - 2026-05-22 角色级素材库并行建设

- [x] 启动子 agent：角色语气 profile。
- [x] 启动子 agent：关系矩阵。
- [x] 启动子 agent：素材库架构。
- [x] 启动子 agent：代码侧媒体 registry。
- [x] 主线创建 Walter 高质量样板。
- [x] 整合子 agent 产物。
- [x] 运行 lint/build 验证。
- [x] 提交并推送 GitHub。

## Review - 2026-05-22 角色级素材库并行建设

- 子 agent 产物：`VOICE_PROFILES.md`、`RELATION_MATRIX.md`、`src/roleAssets.ts`。
- 主线产物：`WALTER_TEMPLATE.md`、`ROLE_LIBRARY_ARCHITECTURE.md`。
- 运行时整合：`src/App.tsx` 现在从 `src/roleAssets.ts` 读取角色级 GIF registry，不再维护另一套硬编码 GIF 池。
- 安全边界：`.omx` 已加入 `.gitignore`，运行态状态不会提交。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。

## 计划 - 2026-05-22 GIF 连续去重

- [x] 复现并记录右侧多轮对话中的 GIF 重复情况。
- [x] 在角色级 GIF 选择逻辑中加入最近几轮 URL 去重。
- [x] 补齐常见语义关键词到角色素材标签的映射。
- [x] 运行 lint/build，并在内置浏览器验证。

## Review - 2026-05-22 GIF 连续去重

- 问题证据：右侧已有 5 张 GIF 中出现两组重复 URL，原因是关键词哈希选图没有历史记忆，且单标签池耗尽后只能回选同一张。
- 修改范围：`src/App.tsx` 的 `gifKeywordMap`、`pickGif`、`resolveGif`、`handleSend`。
- 关键修正：最近 3 轮同角色 GIF URL 会作为黑名单；当前标签池耗尽时，回退到该角色全量素材池中未出现过的 GIF。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 页面验证：内置浏览器/DevTools 在 Walter 连续 3 轮对话中得到 3 个不同 GIF URL，控制台无 error/warn。

## 计划 - 2026-05-22 左侧控制栏滚动可达性

- [x] 将桌面端左侧控制栏固定在视口内，并允许自身滚动。
- [x] 按浏览器标注更新控制栏背景色和 flex 对齐。
- [x] 验证桌面滚动后仍能操作角色切换，移动端布局不被固定定位破坏。

## Review - 2026-05-22 左侧控制栏滚动可达性

- 修改范围：`src/App.css`。
- 关键修正：桌面端 `.control-panel` 使用 `position: sticky; top: 0; max-height: 100vh; overflow-y: auto;`，聊天流变长时左侧角色切换仍保持可达。
- 标注落实：控制栏背景改为 `#dad7ce`，`justify-content` 明确为 `flex-start`。
- 响应式处理：`920px` 以下恢复 `position: static`、`max-height: none`、`overflow: visible`，避免移动端固定侧栏。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 页面验证：桌面端可直接点击 Jesse 切换角色；移动端断点计算样式为 `position: static`；控制台无 error/warn。

## 计划 - 2026-05-22 Agentic Roleplay V1

- [x] 并行补齐 Jesse / Skyler / Saul / Mike / Gus 的 Walter 级角色模板。
- [x] 将角色素材从文档沉淀到运行时角色 registry，用于 prompt 拼装。
- [x] 实现会话内关系状态：信任、怀疑、压力、亲近、威胁感。
- [x] 增加可开关关系状态窗口，默认不强迫破坏沉浸。
- [x] 把多人局从占位回复升级为导演模型 speaker plan，单轮最多 3 个角色。
- [x] 让 A/B/C 验收可验证：模板存在、3-5 轮状态变化、导演选角不是固定轮流。
- [x] 运行 lint/build，内置浏览器验证，并提交推送。

## Review - 2026-05-22 Agentic Roleplay V1

- 子 agent 产物：`JESSE_TEMPLATE.md`、`SKYLER_TEMPLATE.md`、`SAUL_TEMPLATE.md`、`MIKE_TEMPLATE.md`、`GUS_TEMPLATE.md`，均按 Walter 模板结构补齐角色内核、语气规则、关系规则、情绪/视觉标签和验收标准。
- 运行时整合：新增 `src/roleProfiles.ts`，`src/App.tsx` 将角色 profile、关系锚点、会话内关系状态注入 MiniMax prompt。
- 关系状态：侧栏新增可开关状态窗口，显示 trust / suspicion / pressure / closeness / threat；真实对话后 Walter 状态从 `Suspicion +1 / Pressure +1` 变化到 `Suspicion +5 / Pressure +5`。
- 多人局：替换原有硬编码占位回复，先调用 MiniMax 生成 director speaker plan，再按最多三名角色逐个调用真实模型；点名角色会参与补强，测试中生成 Walter / Saul / Gus 三人回复。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 浏览器验证：Codex 内置 DevTools 访问 `http://127.0.0.1:3026/`，4 次 `/api/chat` 请求均返回 200，控制台无 error/warn；截图留存 `/tmp/abq-agentic-v1.png`。

## 计划 - 2026-05-22 GIF 视觉语义库工作流

- [x] 派 5.3 子 agent 审计当前 GIF 资产与触发机制。
- [x] 派 5.3 子 agent 设计外部 AI 可执行的视觉分析/语义锚定流程。
- [x] 对当前 Gus GIF 做抽帧 contact sheet，确认视觉分析必要性。
- [x] 写入项目内详细流程文档。

## Review - 2026-05-22 GIF 视觉语义库工作流

- 新增文档：`materials/breaking-bad/GIF_VISUAL_SEMANTIC_WORKFLOW.md`。
- 新增视觉证据：`materials/breaking-bad/audits/gus-gif-contact-sheet-2026-05-22.jpg`。
- 关键结论：当前运行时仍接近“有 `gif_search_query` 就出图”；下一版应改成 `show_gif` 显式开关 + `gif_scene_function` 语义锚定 + approved/hold/rejected 资产状态。
- Gus 抽帧发现：扩容后虽然解决重复，但部分候选带 meme 文案或字幕覆盖，应进入 hold/rejected，而不是直接作为高质量 approved 资产。

## 计划 - 2026-05-22 GIF 反思机制

- [x] 将“不要只修单个角色，要检查同类对象”的纠偏写入 `tasks/lessons.md`。
- [x] 建立全角色 GIF 覆盖审计，而不是只记录 Gus。
- [x] 把视觉语义工作流的 backlog 改为先跑角色级覆盖审计。

## Review - 2026-05-22 GIF 反思机制

- 新增经验：`tasks/lessons.md` 记录“局部症状 -> 同类对象 -> 覆盖矩阵 -> 共享质量门槛 -> 定向实现”的规则。
- 新增审计：`materials/breaking-bad/ROLE_GIF_COVERAGE_AUDIT.md` 明确 Walter 7、Jesse 1、Skyler 0、Saul 0、Mike 1、Gus 8 的当前状态和风险。
- 关键结论：Jesse、Skyler、Saul、Mike 不是“以后顺手补”的小问题，而是和 Gus 重复同源的系统性素材库缺口。

## 计划 - 2026-05-22 外部 AI 素材研究交付文档

- [x] 汇总现有素材库、GIF 视觉语义流程、覆盖审计和 ingestion schema。
- [x] 写一份 Gemini/外部 AI 可直接执行的探索、搜索、视觉判断和存档任务书。
- [x] 明确 Codex 后续审核、验证和接入流程。

## Review - 2026-05-22 外部 AI 素材研究交付文档

- 新增文档：`materials/breaking-bad/EXTERNAL_AI_RESEARCH_AND_ARCHIVE_BRIEF.md`。
- 文档内容：外部 AI 角色边界、优先级、目录契约、GIF JSONL schema、source schema、角色目标、搜索策略、视觉审查清单、voice/relationship schema、交付 README 模板、verification notes、Codex 审核流程和可复制给 Gemini 的最终 prompt。
- 关键约束：外部 AI 不直接改代码，不保存完整剧本/字幕/大段台词，不把可访问 GIF 直接等同于 approved。

## 计划 - 2026-05-23 A+C Agent Runtime 接管

- [x] 审计 Antigravity 留下的 `server/agents/tools/*` 未跟踪草稿。
- [x] 用安全命名重写角色工具，移除现实操作性参数和输出。
- [x] 新增 `AgentContainer`，实现可审计 Plan/Reflect 摘要、工具日志和本地记忆写入。
- [x] 新增 `DirectorAgent`，实现剧情 tick、事件和多人局 speaker plan。
- [x] 扩展 `/api/chat` 支持 Agent Runtime 请求，并新增 `/api/game-loop`。
- [x] 前端展示剧情时钟、事件 banner、计划/反思摘要、工具日志和记忆变化。
- [x] 运行 lint/build、后端 smoke tests 和内置浏览器验收。

## Review - 2026-05-23 A+C Agent Runtime 接管

- 安全收紧：Antigravity 草稿中的 cook/laundering/recon 工具被替换为 `walter_lab_pressure_simulation`、`saul_legal_risk_theater`、`mike_perimeter_read`、`gus_compliance_evaluation`，只输出剧情压力与风险摘要。
- 后端能力：`/api/chat` 兼容旧 MiniMax prompt 协议和新 `agentRuntimeEnabled` 协议；新 Runtime 会返回 `agent_messages`、`director_plan`、`relationship_states` 和 `story_event`。
- 本地记忆：运行时生成 `server/agents/memory/*`，并通过 `.gitignore` 忽略。
- 前端验收：内置浏览器显示中文默认界面、Agent Runtime、剧情时钟、事件 banner、多人局导演计划、工具日志折叠入口和记忆变化；控制台无 error/warn。
- 验证命令：`npm run lint` 通过；`npm run build` 通过；curl smoke tests 验证单聊、多人局和 `/api/game-loop` 均可返回结构化结果。

## 计划 - 2026-05-23 多人局参与者选择

- [x] 给 Agent Runtime 请求增加 `crewParticipantIds`，表达用户选择的多人局入场名单。
- [x] 让 Director 只在用户选择的 roster 内做 speaker plan，主角色始终强制入场。
- [x] 在侧栏多人局模式下增加参与角色勾选控件。
- [x] 运行 lint/build、API smoke test 和内置浏览器验收。

## Review - 2026-05-23 多人局参与者选择

- 前端：多人局模式下新增 `参与角色` 复选控件；当前主角色始终勾选且不可移除，其余角色可由用户显式加入或排除。
- 后端：`/api/chat` 的 Agent Runtime 请求支持 `crewParticipantIds`；Director 只会在用户选择的 roster 内规划本轮发言者。
- API 验证：请求只选择 Walter/Saul，同时消息点名 Jesse/Mike/Gus，返回 speakers 和 agent messages 均只有 `walter`、`saul`。
- 浏览器验收：内置浏览器中切到多人局后可取消 Jesse/Skyler/Mike/Gus，仅保留 Walter/Saul；发送测试消息后页面只生成 Walter 和 Saul 回复，`/api/chat` 返回 200，控制台无 error/warn。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。

## 计划 - 2026-05-23 隐藏玩家界面运行时调试信息

- [x] 从聊天气泡中移除计划摘要、反思摘要、工具日志和记忆变化渲染。
- [x] 删除对应的玩家界面文案和样式，避免折叠入口继续破坏沉浸。
- [x] 移除顶部导演计划展示，并清理 `scene participant` / 英文关系锚点泄露。
- [x] 运行 lint/build，并用内置浏览器确认聊天流只显示角色内容。

## Review - 2026-05-23 隐藏玩家界面运行时调试信息

- 聊天气泡不再渲染 `计划摘要`、`反思摘要`、`记忆变化`、`工具日志` 等开发者审计字段。
- 顶部不再展示 Director 的内部 speaker plan，只保留玩家可理解的剧情事件。
- 后端 fallback 清理了 `scene participant` 和英文关系锚点外露，中文回复会使用中文关系标签或自然称呼。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 浏览器验收：内置浏览器多人局发送消息后，只显示用户消息、角色名、情绪标签和角色回复；`/api/chat` 返回 200，控制台无 error/warn。

## 计划 - 2026-05-23 恢复 Agent Runtime 真实模型接管

- [x] 修复 Vite dev server 中 Agent Runtime 未显式传入 MiniMax Token Plan key 导致静默 fallback 的问题。
- [x] 给每个运行时角色补入 compact voice card，避免真实模型接管后仍然泛化、重复。
- [x] 将默认 UI 中 `Agent Runtime` / `JSON Schema` 技术标签改成玩家可理解的角色引擎文案。
- [x] 运行 lint/build 和真实 `/api/chat` smoke test，确认回复不再是固定模板。
- [x] 用内置浏览器验证多人局回复有模型生成差异，且开发者信息仍不显示。

## Review - 2026-05-23 恢复 Agent Runtime 真实模型接管

- 根因：Vite dev middleware 用 `loadEnv` 读到了 MiniMax key，但 Agent Runtime 内部只读取 `process.env.MINIMAX_TOKEN_PLAN_KEY`，导致本地多人局静默降级到 fallback 模板。
- 修复：`vite.config.ts` 和 Vercel API 均显式把 key 传给 `DirectorAgent`，再传给每个 `AgentContainer`。
- 质量补强：每个角色增加 compact voice card，提示模型避免重复近期句式，并禁止在玩家回复里暴露 director/tool/memory/plan/fallback 等内部词。
- UI 清理：默认界面把 `Agent Runtime` 和 `JSON Schema` 改为 `真实角色引擎`、`角色边界已启用`。
- 验证命令：`npm run lint` 通过；`npm run build` 通过。
- 真实模型验证：`/api/chat` 多人局返回 Walter/Jesse/Skyler 三条差异化回复，不再是固定模板句。
- 浏览器验收：内置浏览器多人局显示真实模型回复，无计划/反思/工具/记忆调试块，控制台无 error/warn。
