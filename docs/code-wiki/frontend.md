# 前端详解

## 目录结构

```
src/
├── main.tsx              # React 入口, 挂载 App 到 #root
├── App.tsx               # 主应用组件 — 状态管理、UI 渲染、事件处理
├── App.css               # 主样式
├── index.css             # 全局基础样式
├── styles/
│   └── tokens.css        # 设计令牌 (CSS 变量)
├── components/
│   ├── AuthSection.tsx    # 登录/注册/退出 UI
│   ├── ConnectionSheet.tsx # BYOK 连接配置面板
│   ├── GifCard.tsx        # 角色 GIF 表情卡片
│   ├── VoicePlayer.tsx    # TTS 语音播放器
│   ├── VoicePlayer.test.ts
│   ├── PlotGraphPanel.tsx # 剧情图谱可视化面板
│   └── PlotGraphPanel.test.ts
├── hooks/
│   ├── useAuth.ts         # Supabase 认证 hook
│   ├── useCharacterMemory.ts # 角色记忆滑动窗口
│   ├── useConnection.ts   # BYOK 连接管理
│   ├── useQuota.ts        # 免费额度查询
│   ├── useStoryStream.ts  # Story SSE 流 hook
│   └── useStoryStream.test.ts
├── lib/
│   ├── authHeaders.ts     # 认证请求头生成
│   ├── connectionVault.ts # BYOK 凭证本地加密存储
│   ├── gifResolver.ts     # GIF 标签匹配解析
│   ├── gifResolver.test.ts
│   ├── guestId.ts         # 访客 ID 管理
│   ├── handleCharChange.test.ts
│   ├── persistedState.ts  # 持久化状态
│   ├── privacyVault.ts    # 客户端 AES-GCM 加密
│   ├── privacyVault.test.ts
│   ├── providerBrands.ts  # LLM 提供商品牌信息
│   ├── sceneBackgrounds.ts # 场景背景图映射
│   ├── silhouette.tsx     # 角色剪影 SVG 组件
│   ├── storyStagePacing.ts # 故事阶段节奏控制
│   ├── storyStagePacing.test.ts
│   ├── supabaseClient.ts  # Supabase 客户端初始化
│   ├── supabasePersistence.ts  # Supabase 持久化
│   ├── supabasePersistence.test.ts
│   ├── voiceCasting.ts    # 语音投射逻辑
│   ├── voiceExamples.ts   # 角色语音示例
│   └── voicePlayerHelpers.ts # 播放器辅助函数
└── roleProfiles.ts        # 角色人格定义 (8 角色)
└── roleAssets.ts          # 角色 GIF 资产注册表
```

## 关键文件详解

### `src/main.tsx`

React 应用入口。挂载 `App` 组件到 `#root`，引入设计令牌和全局样式。

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### `src/App.tsx`

**核心文件** — 单文件 SPA 主组件，处理所有 UI 逻辑。典型规模超过 1000 行。

**主要职责**:
- 用户认证状态管理 (useAuth)
- 角色选择 UI
- 对话模式切换 (Direct / Crew / Story)
- 聊天消息列表渲染
- Story SSE 流订阅与事件处理
- GIF 表情匹配与展示
- TTS 语音播放
- 场景背景切换

**关键状态变量** (简化):
- `authState` — 认证状态
- `selectedCharacter` — 当前选中角色
- `chatMode` — 对话模式 ('direct' | 'crew' | 'story')
- `messages` — 消息历史
- `storyState` — 故事流状态 (大纲、节拍、事件)

### `src/roleProfiles.ts`

定义 8 个角色的完整人格模型（CharacterId = walter / jesse / skyler / saul / mike / gus / hank / marie）。

```typescript
export type RoleProfile = {
  roleKernel: string[]          // 角色核心：公共面具、内心引擎、主要矛盾、失败模式
  voiceRules: string[]          // 语气规则：句式、用词、节奏
  relationshipRules: Record<string, string[]>  // 关系规则：按关系类型
  emotionTags: string[]         // 情感标签
  visualTags: string[]          // 视觉标签
  acceptanceChecks: string[]    // 验收标准
}
```

### `src/roleAssets.ts`

角色 GIF 资产注册表，每个角色有 `gifPools` 数组，包含 GIF 的 URL、标签、使用说明和安全说明。

```typescript
export type RoleGifAsset = {
  id: string
  source: 'giphy'
  url: string
  tags: RoleGifTag[]           // 标签：default, tense, chemistry, panic, etc.
  usageNotes: string
  safetyNotes: string
  copyrightNotes: string
}
```

## Hooks 详解

### `useAuth.ts`

Supabase 认证 hook。提供 `login`, `signup`, `logout`, `resetPassword` 方法，暴露 `authState` (user / loading / error)。

### `useStoryStream.ts`

Story 模式 SSE 流 hook。连接 `/api/story/stream` 端点，解析 `AgentEvent` 事件并更新 UI 状态。

**事件类型**: `status`, `scene_change`, `agent_act`, `agent_speak`, `agent_think`, `beat_ready`, `dossier_update`, `outline`, `done`, `error`

### `useCharacterMemory.ts`

角色记忆滑动窗口。维护会话中角色可见的消息上下文，按窗口大小截断。

### `useQuota.ts`

查询剩余免费额度。调用 `GET /api/quota` 展示。

### `useConnection.ts`

BYOK 连接管理。管理用户自备 API key 的注册/验证/状态。

## 样式系统

### `src/styles/tokens.css`

**设计令牌** — 集中管理颜色、间距、圆角、阴影等 CSS 变量。

### `index.css`

全局基础样式 — 重置、字体、基础排版。

### `App.css`

主应用样式 — 布局、组件样式、动画、响应式。

## 关键 lib 详解

| 文件 | 职责 |
|------|------|
| `privacyVault.ts` | 客户端 AES-GCM 加密，保护敏感数据 |
| `gifResolver.ts` | 根据情感标签从角色 GIF 池匹配最佳 GIF |
| `sseClient.ts` | SSE 连接客户端，支持重连和事件解析 |
| `supabaseClient.ts` | Supabase 客户端初始化 |
| `voiceCasting.ts` | 语音投射 — 选择 TTS 或浏览器 speechSynthesis |
| `storyStagePacing.ts` | 故事阶段节奏控制 — 根据大纲阶段调整 UI 节奏 |
| `sceneBackgrounds.ts` | 场景背景图映射 — 场景 ID → 背景图片 URL |
| `connectionVault.ts` | BYOK 凭证本地加密存储 |
| `authHeaders.ts` | 生成认证请求头 |