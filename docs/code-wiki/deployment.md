# Deployment And Runbook

本文记录 ABQ Roleplay Lab 的本地运行、数据库迁移、测试和部署方式。

**改完代码后的上线习惯（双轨 Vercel + Docker VM、live smoke、项目专属坑）以 [docs/OPS_RUNBOOK.md](../OPS_RUNBOOK.md) 为准。**
Render / Fly 等内容多为历史路径，不是当前主生产。

## 本地运行

### 前置条件

- Node.js 20 recommended（项目 Docker 使用 `node:20-slim`）
- Python 3.11+（项目要求 `>=3.11`，Docker 使用 Python 3.12）
- PostgreSQL
- `uv`
- 至少一个 LLM provider key：MiniMax、StepFun 或 CLIProxy

### 安装前端依赖

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay
npm install
```

### 安装后端依赖

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend
uv sync
```

### 配置后端 `.env`

文件位置：

```text
/Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend/.env
```

最小示例：

```dotenv
DATABASE_URL=postgresql+asyncpg://bb_roleplay:password@localhost:5432/breaking_bad_roleplay
APP_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
LOG_LEVEL=INFO

# 至少配置一个
MINIMAX_API_KEY=
STEPFUN_API_KEY=
CLI_PROXY_BASE_URL=http://127.0.0.1:8317
CLI_PROXY_API_KEY=
CLI_PROXY_DEFAULT_MODEL=gemini-pro-agent
```

说明：

- `DATABASE_URL` 必填。
- 至少一个 LLM key 必须存在。
- 如果使用 CLIProxy 且 `CLI_PROXY_API_KEY` 为空，`ProviderFacade` 会尝试从 `~/.cli-proxy-api/config.yaml` 读取第一条 key。

### 配置前端 Supabase（可选）

如果需要登录和云同步，在根目录 `.env.local` 或 Vite 可读取的环境中配置：

```dotenv
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

不配置也可以 guest 使用；`createClient()` 会返回 `null`。

## 数据库迁移

长期标准路径是 Alembic：

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend
uv run alembic upgrade head
```

重要：

- `backend/main.py` 不会在 startup 自动 `create_all`。
- Docker CMD 会先执行 `cd /app/backend && alembic upgrade head`。
- [backend/scripts/setup_db.py](../../backend/scripts/setup_db.py) 仍是 `Base.metadata.create_all` 脚本，只适合作为旧本地应急路径。
- Alembic 会对齐 `sessions.current_mode`、dossier 默认值与 `sessions.next_beat_index`，生产库必须处于 head。

## 启动开发服务器

### 后端

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend
uv run uvicorn main:app --reload --port 8001
```

后端地址：

```text
http://localhost:8001
```

健康检查：

```bash
curl http://localhost:8001/api/health
```

### 前端

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay
npm run dev
```

前端地址：

```text
http://localhost:5173
```

[vite.config.ts](../../vite.config.ts) 已配置 dev proxy：`/api` 会转发到 `http://localhost:8001`。

## 测试与验证

### Frontend

```bash
npm test
npm run lint
npm run build
npm run e2e
```

### Backend

```bash
cd backend
uv run pytest
uv run ruff check .
```

### 手动 smoke test

1. 后端启动并通过 `/api/health`。
2. 前端打开 `http://localhost:5173`。
3. Chat view：
   - guest 进入。
   - 选择 Walter。
   - 发送一句短消息。
   - 确认文本、emotion、GIF/voice 不报错。
4. Crew mode：
   - 切换 Crew Debate。
   - 消息中提到 Saul 或 Mike。
   - 确认多个角色回复。
5. Story view：
   - 输入剧情任务。
   - 确认 outline 出现。
   - 等到 `beat_ready`。
   - 测试 Continue、Redirect、Switch Perspective、Stop。
6. 刷新页面：
   - 如果 session id 存在，确认通过 `/messages` 恢复到 `beat_paused`。

## Docker 生产镜像

文件：[Dockerfile](../../Dockerfile)

构建流程：

```text
frontend-build stage
  node:20-slim
  npm ci
  npm run build

runtime stage
  python:3.12-slim
  pip install -r requirements.txt
  copy backend/
  copy start.py
  copy dist/
  ENV PYTHONPATH=/app/backend
  ENV PORT=8080
```

启动命令：

```bash
cd /app/backend && alembic upgrade head && cd /app && python3 start.py
```

`start.py`：

- 读取 `PORT`，默认 `8080`。
- 将 `/app/backend` 加入 `sys.path`。
- import `backend.main:app`。
- 通过 uvicorn 启动 `0.0.0.0:{PORT}`。

本地 Docker：

```bash
docker build -t abq-roleplay-lab .
docker run --rm -p 8080:8080 \
  -e APP_ENV=production \
  -e DATABASE_URL='postgresql://...' \
  -e ALLOWED_ORIGINS='http://localhost:8080' \
  -e MINIMAX_API_KEY='...' \
  abq-roleplay-lab
```

## Render

主要文件：

- [render.yaml](../../render.yaml)
- [Dockerfile](../../Dockerfile)
- [docs/DEPLOY_RENDER.md](../DEPLOY_RENDER.md)

Blueprint 创建：

- PostgreSQL database：`abq-roleplay-db`
- Docker web service：`abq-roleplay-lab`

`render.yaml` env：

| Env | 来源 |
|---|---|
| `MINIMAX_API_KEY` | Render secret |
| `STEPFUN_API_KEY` | Render secret |
| `APP_ENV=production` | yaml |
| `ALLOWED_ORIGINS` | Render secret/manual |
| `DATABASE_URL` | Render database connection string |

健康检查：

```text
/api/health
```

Render 注意事项：

- 单实例服务中 startup 跑 `alembic upgrade head` 可接受。
- 如果未来多副本部署，应把 migration 从 web startup 中移到 release job / one-off migration。
- 生产 `ALLOWED_ORIGINS` 应设置为确切域名，不要长期使用 `*`。

## Fly.io

文件：[fly.toml](../../fly.toml)

关键配置：

- app：`abq-roleplay-lab`
- region：`sin`
- internal port：`8080`
- force HTTPS
- health check：`GET /api/health`
- auto stop/start machines enabled

需要通过 Fly secrets 配置：

```bash
fly secrets set DATABASE_URL='...'
fly secrets set MINIMAX_API_KEY='...'
fly secrets set APP_ENV='production'
fly secrets set ALLOWED_ORIGINS='https://your-app.fly.dev'
```

## Vercel

主生产入口是 [api/index.py](../../api/index.py)，它导出与本地一致的 FastAPI app。[vercel.json](../../vercel.json) 将 `/api/*` 路由到该 Python Function，其余路径交给 Vite SPA。

Story 每次函数调用只渲染一个 beat；`next_beat_index`、outline 和消息持久化到 Supabase Postgres。前端在收到非最终 `beat_ready` 后关闭 SSE，玩家操作成功后再发起下一次请求。

Vercel Production 必需变量：

- `DATABASE_URL`
- `MINIMAX_API_KEY`（或另一个可用 provider key）
- `DIRECTOR_MODEL_ROUTE=minimax/MiniMax-M3`
- `ENABLE_DOSSIER_UPDATES=false`
- `APP_ENV=production`
- `ALLOWED_ORIGINS=https://bb.yishuziyu.cn,https://breaking-bad-roleplay.vercel.app`
- `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`

数据库迁移不在函数冷启动时执行；部署前单独运行 `alembic upgrade head`。公开域名为 `https://bb.yishuziyu.cn`。

## Nixpacks

文件：[nixpacks.toml](../../nixpacks.toml)

当前只声明 python/node providers 和 apt packages。项目主生产部署更明确的是 Dockerfile。

## 生产配置清单

| 项 | 必须 | 说明 |
|---|---|---|
| PostgreSQL | yes | 后端 Story 主路径需要 |
| Alembic migration | yes | 启动前/启动时执行 |
| `APP_ENV=production` | yes | 启用生产静态托管和 CORS 语义 |
| `ALLOWED_ORIGINS` | yes | 生产明确域名 |
| LLM key | yes | 至少一个 |
| Supabase env | optional | 只影响登录和 Chat 云同步 |
| HTTPS | yes | Supabase Auth 和浏览器安全体验需要 |
| Rate limiting | recommended | 当前代码未内建 |
| Cost guard | recommended | Story 模式会触发多次 LLM 调用 |

## 常见问题

### `Settings` import 时报 `DATABASE_URL` 缺失

后端 `db/session.py` import 时会创建 engine，所以 `DATABASE_URL` 必须在 import backend app 前存在。

### 本地 Chat 选 CLIProxy 失败

确认：

- CLIProxy 服务运行在 `CLI_PROXY_BASE_URL`。
- `CLI_PROXY_API_KEY` 已设置，或 `~/.cli-proxy-api/config.yaml` 有可读取 key。
- `CLI_PROXY_DEFAULT_MODEL` 是 proxy 支持的模型。

### Story session 创建成功但 stream 报 DB column error

优先检查 Alembic schema 是否包含当前 ORM 所有列，尤其是 `sessions.current_mode`。

### 页面刷新后 Story 没有继续播放

这是当前设计。刷新后只恢复已持久化 dialogue 并进入 `beat_paused`，用户点击 Continue 后才继续，避免自动消耗 LLM。

### CORS 失败

检查：

- 本地：`ALLOWED_ORIGINS=http://localhost:5173`
- 生产：`ALLOWED_ORIGINS=https://your-domain`
- 如果留空且 `APP_ENV=production`，后端会 warning，并拒绝浏览器跨域请求。
