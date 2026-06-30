# Frontend Code Wiki

前端位于 [src](../../src)，是一个 React + TypeScript + Vite 单页应用。它有两个主视图：

- Chat view：普通角色聊天，支持 direct 和 crew 两种模式。
- Story view：Director Agent 驱动的实时剧情流，使用 EventSource 接收后端 SSE。

## 目录结构

```text
src/
  App.tsx                         # 应用主入口与大部分 UI 编排
  App.css                         # 主界面样式
  index.css                       # 全局样式
  styles/tokens.css               # 设计 token
  roleProfiles.ts                 # 角色关系、语气、验收标准数据
  roleAssets.ts                   # 角色 GIF 素材 registry
  components/
    AuthSection.tsx               # Supabase 登录/注册/退出 UI
    GifCard.tsx                   # GIF 渲染与失败隐藏
    VoicePlayer.tsx               # Web Speech 播放按钮
  hooks/
    useAuth.ts                    # Supabase auth hook
    useCharacterMemory.ts         # 前端滑窗记忆
    useStoryStream.ts             # Story session/SSE 状态机
  lib/
    gifResolver.ts                # 角色 GIF 选择
    persistedState.ts             # localStorage state hooks
    sceneBackgrounds.ts           # 聊天场景背景路由
    silhouette.tsx                # 角色头像/剪影渲染
    supabaseClient.ts             # Supabase browser client
    supabasePersistence.ts        # Supabase chat/memory CRUD
    voiceExamples.ts              # 角色开场/语音参考文本
    voicePlayerHelpers.ts         # Web Speech voice selection + pure helpers
```

## 应用入口：[src/App.tsx](../../src/App.tsx)

`App` 同时管理侧边栏控制和主内容区。

### 主要类型

| 类型 | 值 |
|---|---|
| `ChatMode` | `direct` / `crew` |
| `Language` | `en` / `zh` |
| `View` | `chat` / `story` |
| `CharacterId` | `walter` / `jesse` / `skyler` / `saul` / `mike` / `gus` |
| `ChatMessage` | `{ id, sender, text, emotion, gifQuery, gifUrl, thinking, toolExecuted, toolLog }` |

### 主要状态

| state | 持久化 | 说明 |
|---|---|---|
| `selectedCharId` | localStorage `abq_character` | 当前角色 |
| `language` | `abq_language` | UI 和 prompt 目标语言 |
| `relationByChar` | `abq_relation` | 每个角色独立关系锚点 |
| `view` | `abq_view` | Chat / Story |
| `mode` | `abq_mode` | direct / crew |
| `llmProvider` | `abq_llm-v2` | 当前模型后端；默认 `cliproxy` |
| `messagesByChar` | `abq_messages` | 普通聊天消息 |
| `memoryByChar` | `abq_memory` | 前端聊天记忆 |
| `storyTask` | React state | Story 任务输入 |

### 侧边栏

侧边栏负责：

- 品牌和 tagline。
- `AuthSection`。
- 六个角色按钮。
- 语言切换。
- Chat/Story 视图切换。
- 当前角色的关系锚点选择。
- Chat 模式下的 direct/crew 切换。
- 模型后端选择。

当前模型下拉：

```text
cliproxy -> CLIProxy gemini-pro-agent
minimax  -> MiniMax M3
```

后端仍支持 `stepfun`，但前端 UI 当前没有暴露。

## Chat View 流程

### 初始化

App 在角色、语言、关系或登录用户变化时执行一次合并逻辑：

1. 如果已登录，调用：
   - `loadChatMessages(userId, selectedCharId)`
   - `loadCharacterMemory(userId, selectedCharId)`
2. 将云端消息和本地消息按 `{sender,text}` 去重合并。
3. 如果合并后为空，插入角色 opener。
4. 如果云端有 memory，写入 `memoryByChar`。

### 发送消息

`handleSend`：

```text
user submits composer
  -> append user ChatMessage locally
  -> charMemory.addTurn(user)
  -> POST /api/chat
      {
        characterId,
        userInput,
        relation,
        mode,
        history: last 10 messages,
        language,
        llmProvider,
        voiceExample,
        memorySummary,
        keyFacts
      }
  -> if direct:
       append one character reply
       update memory with character reply
       persist reply + memory to Supabase when logged in
     if crew:
       append each debate log as a character reply
```

注意：

- `memorySummary` 和 `keyFacts` 当前由前端发送，但 FastAPI `ChatRequest` 未声明这些字段；Pydantic 默认忽略 extra，所以后端目前没有使用它们。
- 普通聊天只在登录后把角色回复同步到 Supabase；用户消息当前只保存在 localStorage。
- `GifCard` 的 URL 由 `resolveGifUrl(character, emotion, gifQuery)` 在前端决定。

## Story View 流程

Story 由 [src/hooks/useStoryStream.ts](../../src/hooks/useStoryStream.ts) 管理。

### State

| state | 说明 |
|---|---|
| `events` | 已接收事件，最多保留 `MAX_EVENTS = 200` |
| `outline` | Director 生成的剧情大纲 |
| `sessionId` | 当前后端 session id |
| `connectionState` | `idle` / `connecting` / `streaming` / `beat_paused` / `complete` / `error` |
| `currentBeatId` | 当前暂停 beat id |
| `beatIndex` | 前端累计 beat 数 |
| `isSendingByChar` | per-character action loading |
| `errorByChar` | per-character 或 session error |
| `autoContinued` | 5 分钟无操作自动继续提示 |
| `isResuming` | 正在从 saved session 恢复 |

### `startStory(taskPrompt, characterId='walter')`

```text
reset local Story state
  -> POST /api/session/create
      { title, task_prompt, active_character_id }
  -> save session_id to localStorage key abq_story_session_id
  -> connectStream(session_id)
```

### `connectStream(sid)`

创建：

```ts
new EventSource(`/api/session/${sid}/stream`)
```

监听事件：

| SSE event | 前端行为 |
|---|---|
| `outline` | 设置 `outline`，状态变 `streaming` |
| `status` | 普通 status 追加到 events；自动继续 status 设置 `autoContinued` |
| `scene_change` | 追加事件 |
| `agent_act` | 追加事件 |
| `agent_think` | 追加事件 |
| `agent_speak` | 追加事件，渲染 dialogue、VoicePlayer、GifCard |
| `world_state_delta` | 追加事件，渲染 delta list |
| `beat_ready` | 设置 `currentBeatId`、`beatIndex + 1`、状态变 `beat_paused` |
| `complete` | 追加 complete，状态变 `complete`，关闭 EventSource |
| `error` | 如果有 `e.data`，视作后端 fatal error；否则让 EventSource 原生重试 |

dedup：

- `agent_speak` 用 `character_id + content`。
- `beat_ready` 用 `beat_id`。
- 其他事件允许重复，避免误删。

### `resumeSession(sid)`

页面加载时如果存在 `abq_story_session_id`：

```text
GET /api/session/{sid}/messages
  -> 404: 清空 localStorage，回到 idle
  -> 200: 把 MessageOut[] 映射为 agent_speak events
  -> 状态设为 beat_paused
```

恢复后不会自动连接 SSE。用户需要点击 Continue，避免刷新后自动继续消耗 LLM。

### `sendAction(action, params, characterId)`

动作：

| action | 前端行为 |
|---|---|
| `stop` | POST action 后关闭 EventSource、清空 story state、清除 saved session |
| `continue` | optimistic 设置 `streaming`，POST action |
| `redirect` | optimistic 设置 `streaming`，POST `{ redirect_prompt }` |
| `switch_perspective` | optimistic 设置 `streaming`，POST `{ target_character }` |

实现细节：

- 每次 action 前 abort 上一次未完成的 action request。
- action 失败会把状态回滚到 `beat_paused`。
- 组件 unmount 时关闭 EventSource 并 abort in-flight request。

## 前端持久化

### localStorage

由 [src/lib/persistedState.ts](../../src/lib/persistedState.ts) 管理的 key 自动加 `abq_` 前缀。

| key | 内容 |
|---|---|
| `abq_character` | 当前角色 |
| `abq_language` | 当前语言 |
| `abq_relation` | 每个角色的关系锚点 |
| `abq_view` | 当前视图 |
| `abq_mode` | Chat mode |
| `abq_llm-v2` | 当前 LLM provider |
| `abq_messages` | 普通聊天消息 |
| `abq_memory` | 普通聊天记忆 |
| `abq_story_session_id` | Story 后端 session id；由 `useStoryStream` 直接管理 |
| `abq_recent_gifs` | GIF cooldown 最近使用 URL；由 `gifResolver` 管理 |

### Supabase

[src/lib/supabaseClient.ts](../../src/lib/supabaseClient.ts) 读取：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

如果未配置，`createClient()` 返回 `null`，UI 仍可 guest 使用。

[src/lib/supabasePersistence.ts](../../src/lib/supabasePersistence.ts) 提供 Supabase 读写；[src/lib/privacyVault.ts](../../src/lib/privacyVault.ts) 提供客户端 AES-GCM 加密。

| 函数 | 表 | 说明 |
|---|---|---|
| `loadChatMessages(userId, characterId, { privacyKey })` | `chat_messages` | 加载普通聊天，自动解密 `abqenc:v1:` envelope |
| `persistPrivateChatMessage(userId, msg, privacyKey)` | `chat_messages` | 加密后插入普通聊天消息 |
| `persistPrivateChatMessages(userId, msgs, privacyKey)` | `chat_messages` | 加密后批量插入普通聊天消息 |
| `loadCharacterMemory(userId, characterId, { privacyKey })` | `character_memory` | 加载并解密 summary/key facts |
| `persistPrivateCharacterMemory(userId, memory, privacyKey)` | `character_memory` | 加密后 upsert memory |

明文 `persistChatMessage` / `persistCharacterMemory` 仍保留给低层测试和迁移兼容，但 App 云同步路径必须使用 private 版本。

## 角色数据

### [src/roleProfiles.ts](../../src/roleProfiles.ts)

定义：

- `CharacterId`
- `RelationshipState`
- `RoleProfile`
- `baselineRelationshipState`
- `roleProfiles`

每个角色包含：

- `roleKernel`
- `voiceRules`
- `relationshipRules`
- `emotionTags`
- `visualTags`
- `acceptanceChecks`

这些数据当前主要用于前端/产品表达，后端角色 prompt 在 `backend/agents/characters` 中另有一套。

### [src/roleAssets.ts](../../src/roleAssets.ts)

定义角色 GIF registry：

- `RoleAssetCharacterId`
- `RoleGifTag`
- `RoleGifAsset`
- `RoleAssetRegistryEntry`
- `roleAssets`

每个 GIF 包含：

- `id`
- `source`
- `url`
- `tags`
- `usageNotes`
- `safetyNotes`
- `copyrightNotes`

## 视觉与媒体模块

| 文件 | 职责 |
|---|---|
| [src/lib/gifResolver.ts](../../src/lib/gifResolver.ts) | 通过 emotion/gifQuery 匹配 tag，避开最近两次使用的 GIF |
| [src/components/GifCard.tsx](../../src/components/GifCard.tsx) | 渲染 GIF；图片加载失败后隐藏该 src |
| [src/lib/sceneBackgrounds.ts](../../src/lib/sceneBackgrounds.ts) | 根据最近 8 条聊天文本关键词选择背景图 |
| [src/lib/silhouette.tsx](../../src/lib/silhouette.tsx) | 角色头像渲染，当前支持公共 avatars |
| [src/components/VoicePlayer.tsx](../../src/components/VoicePlayer.tsx) | Web Speech 播放按钮；无 speechSynthesis 时 disabled |
| [src/lib/voicePlayerHelpers.ts](../../src/lib/voicePlayerHelpers.ts) | 角色 pitch/rate、voice 选择、播放/停止纯函数 |
| [src/lib/voiceExamples.ts](../../src/lib/voiceExamples.ts) | 角色/关系开场与风格参考 |

## 组件说明

### `AuthSection`

Props：

```ts
{
  auth: ReturnType<typeof useAuth>
  language: 'en' | 'zh'
  syncStatus: string | null
}
```

状态：

- `signin` / `signup`
- email/password
- form error
- guest hint

行为：

- Supabase 未配置时不阻塞 guest 使用。
- 登录后显示 email、sign out、cloud sync 状态。

### `GifCard`

简单展示组件：

- `src` 为空返回 `null`。
- `onError` 后记录 `failedSrc`，避免破图反复渲染。

### `VoicePlayer`

行为：

- 使用 `globalThis.speechSynthesis`。
- 根据角色和语言选择 voice。
- 根据角色 profile 设置 pitch/rate。
- speaking 时点击会 cancel。
- unmount 时 cancel，避免音频继续播放或 setState on unmounted。

## 前端测试

现有测试：

- [src/lib/gifResolver.test.ts](../../src/lib/gifResolver.test.ts)
- [src/components/VoicePlayer.test.ts](../../src/components/VoicePlayer.test.ts)
- [tests/bugfix.spec.ts](../../tests/bugfix.spec.ts)
- [test/tool-safety.test.js](../../test/tool-safety.test.js)
- [tests/e2e](../../tests/e2e) Playwright E2E

常用命令：

```bash
npm test
npm run lint
npm run build
npm run e2e
```

## 前端开发注意事项

- Story event schema 变更时必须同步 `useStoryStream`、`App.tsx` 渲染和后端 `models/schemas.py`。
- localStorage key 已经有 `abq_` 前缀，新增持久化 state 应继续使用 `usePersistedState`。
- Supabase 未配置是允许场景，不要让 auth/persistence failure 阻塞 guest chat。
- GIF URL 是外部 Giphy 链接，正式生产前需要重新确认授权和可用性。
- `sceneBackgrounds.ts` 引用了 `/backgrounds/blue-desert-rv.jpg`；如果部署包缺这个文件，会回退为浏览器 404 背景，不影响 API 但影响视觉。
