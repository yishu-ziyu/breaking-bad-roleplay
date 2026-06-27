# ABQ Roleplay Lab — Code Wiki

> 项目路径：`/Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay`
> 产品定位：基于《绝命毒师》世界观的 AI 角色扮演应用，支持单角色私聊与多角色 Crew 辩论，并逐步升级为 Director-Agent 自主剧情驱动。

---

## Wiki 导航

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 整体架构、分层边界、数据流向 |
| [backend.md](./backend.md) | Python 后端模块、类与函数说明 |
| [frontend.md](./frontend.md) | React 前端组件、Hooks、状态管理 |
| [data-models.md](./data-models.md) | 数据库模型与 Pydantic Schema |
| [api.md](./api.md) | REST API 端点与 SSE 事件协议 |
| [deployment.md](./deployment.md) | 部署配置、环境变量、本地运行 |
| [dependencies.md](./dependencies.md) | 技术栈与外部依赖 |

---

## 一句话总结

前端 React + Vite 提供聊天与剧情界面；后端 FastAPI 通过 `DirectorAgent` 编排 6 个角色 Sub-agent；LLM 调用统一封装在 `ProviderFacade`（MiniMax / StepFun / Agnes）；持久化使用 SQLAlchemy + PostgreSQL/Supabase；前端通过 HTTP + SSE 与后端通信。

---

## 快速入口

- 后端主入口：[backend/main.py](../../backend/main.py)
- 路由聚合：[backend/api/routes.py](../../backend/api/routes.py)
- 剧情导演：[backend/agents/director.py](../../backend/agents/director.py)
- 模型门面：[backend/agents/provider.py](../../backend/agents/provider.py)
- 角色基类：[backend/agents/characters/base.py](../../backend/agents/characters/base.py)
- 前端主组件：[src/App.tsx](../../src/App.tsx)
- 剧情流 Hook：[src/hooks/useStoryStream.ts](../../src/hooks/useStoryStream.ts)
