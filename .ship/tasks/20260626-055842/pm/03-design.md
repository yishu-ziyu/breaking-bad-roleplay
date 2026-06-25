# 设计方案

## 交互设计

### 关键页面

**首页 / 聊天页（单页应用）**
- 左侧边栏：角色选择 + 语言切换 + 模型后端选择 + 视图切换（对话/剧情）
- 主区域：聊天面板 / Story 导演面板
- 空状态：选角色后显示角色引言（prompt 中的第一句话）
- 加载状态：角色头像 + 省略号动画 + "正在思考..."
- 错误状态：红色提示框 + "重试"按钮 + 错误类型（网络/LLM/服务器）

**Story 面板**
- 顶部：大纲预览（可折叠）
- 主体：事件流（按 beat 分组，scene_change 用分隔线，agent_speak 用对话气泡，agent_think 用斜体旁白）
- Beat 控制栏：继续 / 停止 / 改方向
- 底部：进度条（beat 3/5）

### 空状态
- 未选角色：6 个头像网格 + 名字 + 一句话人设标签
- Story 未开始：输入框 + 占位提示 + "开始剧情"按钮（disabled 当输入为空）

## 技术方案

| 层 | 当前 | 长期 |
|----|------|------|
| 前端 | React 19 + Vite 8 | 同上，加 React Query 做服务端状态 |
| 后端 | Vercel Serverless Function（Python） | 同上 |
| 数据库 | 无（localStorage） | Supabase（PostgreSQL + Realtime + Auth） |
| LLM | 多引擎切换（Agnes/StepFun/DeepSeek/MiniMax） | 同上 + 自动 fallback |
| 部署 | Vercel | 同上 |

### Trade-offs

- **为什么 Supabase 而不是其他 DB**：免费层够用、Realtime 直接可用、和 Vercel 天然搭配。后续如果规模大可以换。
- **为什么 Vercel 而不是独立服务器**：零运维、自动扩缩容、免费层够 MVP。SSE 限制通过 Supabase Realtime 绕过。
- **为什么不用 FastAPI 后端**：Vercel Serverless 不需要常驻进程，减少部署复杂度。Story 模式用单次调用 + 前端 replay 绕过超时。

## 数据模型

```sql
-- 用户
users (id, email, created_at)

-- 对话会话
sessions (id, user_id, character_id, mode, language, llm_provider, title, created_at, updated_at)

-- 消息
messages (id, session_id, role, content, metadata_json, created_at)
-- role: user | assistant | system
-- metadata_json: { emotion_state, gif_query, tool_executed }

-- Story 会话
story_sessions (id, user_id, character_id, task_prompt, outline, current_beat, status, created_at)

-- Story 事件
story_events (id, story_session_id, event_type, event_data, beat_index, created_at)
-- event_type: scene_change | agent_act | agent_think | agent_speak | world_state_delta | beat_ready | complete
```

## API 设计

| 端点 | 方法 | 请求 | 响应 | 说明 |
|------|------|------|------|------|
| `/api/chat` | POST | `{characterId, userInput, relation, mode, history, language, llmProvider}` | `{reply_text, emotion_state, gif_search_query, thinking, tool_executed, tool_log}` | Chat + Crew |
| `/api/story` | POST | `{task_prompt, active_character_id, llmProvider}` | `{outline, beats}` | Story 生成 |
| `/api/sessions` | GET | auth header | `[{id, character_id, mode, title, updated_at}]` | 用户会话列表 |
| `/api/sessions/:id/messages` | GET | auth header | `[{id, role, content, created_at}]` | 会话消息 |
| `/api/sessions` | POST | auth header + `{character_id, mode}` | `{id, title}` | 创建会话 |

## 验收标准

### Golden Journey 1：首次对话
- **Given** 用户首次打开页面
- **When** 选择 Walter + 输入消息 + 发送
- **Then** 3 秒内收到 Walter 风格化回复（化学术语 + 短句 + 冷峻语气）

### Golden Journey 2：LLM 切换
- **Given** 用户在对话中
- **When** 切换模型后端为 DeepSeek + 发送新消息
- **Then** 回复来源变为 DeepSeek，不需要刷新页面

### Golden Journey 3：Story 导演模式
- **Given** 用户在 Story 标签
- **When** 输入任务 + 点击"开始剧情"
- **Then** 30 秒内生成大纲 + 自动播放第一 beat，显示角色动作/对话/内心独白

### Golden Journey 4：对话持久化
- **Given** 用户有 5 轮对话历史
- **When** 刷新页面
- **Then** 恢复角色选择 + 对话历史 + 人设记忆

## 风险评估

| 风险 | 类型 | 影响 | 缓解 | Plan B |
|------|------|------|------|--------|
| Agnes AI 关闭/限流 | 技术 | 中 | 多 LLM fallback 已实现 | 自动切 StepFun |
| LLM 角色人设飘 | 产品 | 高 | system prompt 精细化 + few-shot | 加角色记忆上下文 |
| Supabase 免费层限流 | 技术 | 中 | 按需初始化，非全量迁移 | 保留 localStorage 降级 |
| 版权风险（Breaking Bad IP） | 产品 | 低 | 非商业使用 + 粉丝创作声明 | 扩 IP 时提前谈授权 |
| 中文 LLM 质量 | 产品 | 中 | DeepSeek/MiniMax 已验证支持中文 | 用户选择英文模式 |
