# PROJECT_INTAKE — ABQ Roleplay Lab

## 产品用途

Breaking Bad 世界观的 AI 角色扮演产品。玩家选择角色 + 关系锚点，可做「微观私聊」（direct）或「宏观辩论」（crew），也可布置任务让 Director Agent 自主演绎剧情（story mode）。

目标用户：黑客松 demo 用户，Breaking Bad 粉丝

核心任务：
1. 选择角色 → 选关系锚点 → 开始聊天
2. 布置自然语言任务 → Director 自主演绎 → 每 beat 等玩家决策

7 个可玩角色：Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring, Hank Schrader（权威表见 [CONTEXT.md](../CONTEXT.md)）

## 架构

```
Frontend: React 19 + TypeScript + Vite 8 (dist/ 预编译)
Backend:  Python FastAPI + uvicorn + SQLAlchemy + asyncpg
DB:       PostgreSQL (auto create_all)
LLM:      StepFun step-3.7-flash (主), MiniMax M3 (辅)
Entry:    start.py → uvicorn(main:app)
Docker:   python:3.12-slim, COPY dist/ + backend/, CMD python3 start.py
```

关键端点：
- `POST /api/chat` — 直接对话 / crew 辩论
- `POST /api/session/create` — 创建故事 session
- `GET /api/session/{id}/stream` — SSE 事件流
- `POST /api/session/{id}/action` — 玩家决策
- `GET /api/health` — 健康检查

## 运行基线

| 检查 | 状态 | 备注 |
|------|------|------|
| `npm run build` | ✅ PASS | 28 modules, 153ms |
| TypeScript | ✅ PASS | 0 errors |
| `npm run lint` | ❌ FAIL | 9 errors, 7 warnings |
| `npm test` | ❌ FAIL | tool-safety.test.js 引用不存在的文件 |
| 后端 pytest | ⚠️ 未验证 | 需要 PostgreSQL |

## 部署决策

- 平台：Render（全部）
- 前端：dist/ 预编译，Dockerfile 服务
- 后端：同一个 Dockerfile
- DB：Render 内置 PostgreSQL
- 环境变量：MINIMAX_API_KEY, STEPFUN_API_KEY, DATABASE_URL, ALLOWED_ORIGINS

## 待修复项

1. lint 9 errors — react-hooks/set-state-in-effect, no-unused-vars
2. tool-safety.test.js — 引用不存在的 server/agents/AgentContainer.ts
3. Dockerfile — 确认兼容 Render
4. 环境变量配置
5. CORS 配置

## 风险

- Render 免费层 15 分钟无流量休眠（demo 够用）
- StepFun step-3.7-flash 是 reasoning 模型，可能拒收某些参数
- SSE 在冷启动后首次连接可能有延迟
