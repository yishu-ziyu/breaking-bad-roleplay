# Breaking Bad Roleplay — Code Wiki

> 项目代码知识库，涵盖整体架构、模块职责、关键类/函数、依赖关系和运行方式。
>
> 线上服务: https://bb.yishuziyu.cn

## 文档索引

| 文件 | 说明 |
|------|------|
| [architecture.md](architecture.md) | 整体架构 — 前端/后端分层、数据流、设计模式 |
| [frontend.md](frontend.md) | 前端模块详解 — React 组件、hooks、lib 工具、样式 |
| [backend.md](backend.md) | 后端模块详解 — Agent 引擎、Provider、路由、角色系统 |
| [data-models.md](data-models.md) | 数据模型 — ORM 表结构、Pydantic Schema、关系 |
| [api.md](api.md) | API 参考 — 所有端点、请求/响应、SSE 事件 |
| [dependencies.md](dependencies.md) | 依赖清单 — 前端 npm、后端 Python、工具链 |
| [deployment.md](deployment.md) | 部署与运维 — Docker、Vercel、双轨部署、验活 |

## 项目概览

这是一个《绝命毒师》主题的 AI 角色扮演对话应用，不是普通聊天机器人。

**核心体验**: 选角色 → 建立关系锚点 → 对话 / 剧情演绎

**三种对话模式**:
- **Direct Chat** (一对一) — 用户与选定角色直接对话
- **Crew** (多人辩论) — 多角色同时参与对话
- **Story** (剧情流) — SSE 驱动的大纲/节拍叙事引擎

**可玩角色** (8 个): Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring, Hank Schrader, Marie Schrader

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | React + TypeScript | 19 / 6.0 |
| 构建工具 | Vite | 8.x |
| 后端框架 | FastAPI (Python) | 0.110+ |
| 数据库 | PostgreSQL (Supabase 托管) | — |
| ORM | SQLAlchemy + Alembic | 2.0+ / 1.18+ |
| LLM 提供商 | MiniMax-M3 / StepFun / CLI Proxy | — |
| 认证 | Supabase Auth (email/password) | — |
| 部署 | Docker VM (121.89.90.68) + Nginx + Vercel | — |
| TTS | MiniMax T2A (克隆语音) | — |

## 安全边界

- 禁止生成现实世界犯罪操作指导（制毒、暴力、洗钱等）
- 戏剧张力保留，虚构语境内允许
- LLM API key 永不暴露前端
- 免费额度按身份/IP 限流