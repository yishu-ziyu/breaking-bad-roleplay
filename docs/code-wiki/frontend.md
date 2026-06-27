# 前端模块说明

## 1. 目录结构

```
src/
├── App.tsx                 # 应用根组件
├── main.tsx                # React 渲染入口
├── index.css / App.css     # 全局与应用样式
├── assets/                 # 静态图片
├── components/
│   └── AuthSection.tsx     # 登录/注册/登出 UI
├── hooks/
│   ├── useAuth.ts          # Supabase 认证
│   ├── useStoryStream.ts   # 剧情流状态
│   └── useCharacterMemory.ts # 单角色记忆
├── lib/
│   ├── persistedState.ts   # localStorage 持久化 state hook
│   ├── sceneBackgrounds.ts # 根据对话内容选择场景背景
│   ├── silhouette.tsx      # 角色剪影 SVG 组件
│   ├── supabaseClient.ts   # Supabase 客户端初始化
│   ├── supabasePersistence.ts # Supabase 聊天/记忆持久化
│   └── voiceExamples.ts    # 角色语音示例映射
├── styles/
│   └── tokens.css          # CSS 设计 token
├── roleAssets.ts           # 角色头像/背景资源映射
└── roleProfiles.ts         # 角色档案数据

public/
├── avatars/                # 角色头像 SVG
├── backgrounds/            # 场景背景 SVG
├── favicon.svg
└── icons.svg
```

## 2. 核心组件

### 2.1 App.tsx

文件：`[src/App.tsx](../../src/App.tsx)`

`App` 是单页应用的根组件，负责：

- 侧边栏：角色选择、语言切换、视图切换、关系选择、模式选择、模型后端选择。
- 主面板：根据 `view` 渲染聊天视图或剧情视图。
- 聊天视图：消息列表、输入框、场景背景、GIF 卡片、工具信息。
- 剧情视图：任务输入 → 大纲确认 → beat 回放与决策按钮。

关键状态：

| 状态 | 说明 |
|------|------|
| `selectedCharId` | 当前选中的角色 |
| `language` | `en` / `zh` |
| `view` | `chat` / `story` |
| `mode` | `direct` / `crew` |
| `llmProvider` | `agnes` / `stepfun` / `deepseek` / `minimax` |
| `messagesByChar` | 每个角色的聊天历史 |
| `storyTask` / `story` | 剧情模式输入与流状态 |

### 2.2 AuthSection

文件：`[src/components/AuthSection.tsx](../../src/components/AuthSection.tsx)`

- 接收 `auth` 对象与 `syncStatus`。
- 渲染登录表单或用户信息。

## 3. 自定义 Hooks

### 3.1 useAuth

文件：`[src/hooks/useAuth.ts](../../src/hooks/useAuth.ts)`

| 名称 | 说明 |
|------|------|
| `user` | 当前 Supabase 用户 |
| `session` | 当前 session |
| `loading` | 初始化中 |
| `signIn(email, password)` | 登录 |
| `signUp(email, password)` | 注册 |
| `signOut()` | 登出 |

### 3.2 useStoryStream

文件：`[src/hooks/useStoryStream.ts](../../src/hooks/useStoryStream.ts)`

| 名称 | 说明 |
|------|------|
| `events` | 已渲染的 SSE 事件列表 |
| `outline` | 剧情大纲文本 |
| `beatIndex` / `totalBeats` | 当前 beat 进度 |
| `confirmed` | 用户是否已确认大纲 |
| `isGenerating` | 是否加载中 |
| `sessionId` | 当前 session ID |
| `startStory(task, character, provider)` | 调用 `/api/story` 获取大纲与 beats |
| `confirmStory()` | 确认大纲，开始播放第一个 beat |
| `sendAction(action)` | 继续 / 停止 动作 |

注意：当前实现为本地回放模式，调用 `/api/story` 一次性返回大纲与 beats，前端按 beat 逐步展示。

### 3.3 useCharacterMemory

文件：`[src/hooks/useCharacterMemory.ts](../../src/hooks/useCharacterMemory.ts)`

- 提供 `addTurn(role, text, memory)` 方法。
- 维护每个角色的 `summary` 与 `keyFacts`。
- 聊天时传给后端作为上下文。

## 4. 工具库

### 4.1 persistedState

文件：`[src/lib/persistedState.ts](../../src/lib/persistedState.ts)`

- `usePersistedState<T>(key, defaultValue)`：基于 `localStorage` 的持久化 state hook。

### 4.2 supabaseClient

文件：`[src/lib/supabaseClient.ts](../../src/lib/supabaseClient.ts)`

- 读取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。
- 创建 Supabase 客户端。

### 4.3 supabasePersistence

文件：`[src/lib/supabasePersistence.ts](../../src/lib/supabasePersistence.ts)`

- `loadChatMessages(userId, characterId)`
- `persistChatMessage(userId, message)`
- `loadCharacterMemory(userId, characterId)`
- `persistCharacterMemory(userId, memory)`

### 4.4 sceneBackgrounds

文件：`[src/lib/sceneBackgrounds.ts](../../src/lib/sceneBackgrounds.ts)`

- `pickSceneUrl(recentTexts)`：根据最近对话关键词选择背景图 URL。

### 4.5 silhouette

文件：`[src/lib/silhouette.tsx](../../src/lib/silhouette.tsx)`

- `<Silhouette characterId name size />`：渲染角色剪影 SVG。

## 5. 样式系统

文件：`[src/styles/tokens.css](../../src/styles/tokens.css)`

定义 CSS 变量：颜色、间距、字体、阴影等设计 token。

## 6. 静态资源

- 头像：`public/avatars/{walter,jesse,skyler,saul,mike,gus}.svg`
- 背景：`public/backgrounds/{abq-sunset,dea-office,lab-rv,los-pollos,rv-interior,saul-neon,skyler-living}.svg`
