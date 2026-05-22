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
