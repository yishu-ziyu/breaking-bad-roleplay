# 部署与运行

## 1. 环境变量

### 1.1 后端必需

文件：`[backend/.env.example](../../backend/.env.example)`

| 变量 | 说明 |
|------|------|
| `MINIMAX_API_KEY` | MiniMax API key |
| `STEPFUN_API_KEY` | StepFun API key |
| `DATABASE_URL` | PostgreSQL 异步连接串，例如 `postgresql+asyncpg://user:pass@host/db` |
| `APP_ENV` | `development`（默认）或 `production` |
| `ALLOWED_ORIGINS` | CORS 来源，逗号分隔；`*` 表示允许所有（仅开发） |

### 1.2 前端必需

文件：`[.env.example](../../.env.example)`

| 变量 | 说明 |
|------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名 key |

### 1.3 遗留 Serverless

文件：`[.env.production.example](../../.env.production.example)`

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | Serverless `/api/chat` 与 `/api/story` 使用的通用 key |
| `LLM_URL` | 可选，覆盖默认 Agnes endpoint |
| `LLM_MODEL` | 可选，覆盖默认模型 |

## 2. 本地运行

### 2.1 前端

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5173`

可用脚本（`[package.json](../../package.json)`）：

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | TypeScript 编译 + Vite 构建 |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | ESLint 检查 |
| `npm run test` | node --test |

### 2.2 后端

```bash
cd backend
cp .env.example .env
# 编辑 .env 填入 API key 与 DATABASE_URL
uv sync
uvicorn main:app --reload --port 8001
```

默认地址：`http://localhost:8001`

或使用项目根入口：

```bash
python start.py
```

## 3. 部署配置

### 3.1 Docker

文件：`[Dockerfile](../../Dockerfile)`

- 基于 `python:3.12-slim`
- 安装 `backend/requirements.txt`
- 复制 `backend/`、`start.py`、预构建 `dist/`
- 暴露 8080，运行 `python3 start.py`

构建：

```bash
npm run build
docker build -t abq-roleplay-lab .
```

### 3.2 Railway

文件：`[railway.toml](../../railway.toml)`、`[.railway/railway.ts](../../.railway/railway.ts)`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = ""
healthcheckPath = "/api/health"
```

### 3.3 Fly.io

文件：`[fly.toml](../../fly.toml)`

- 应用名：`abq-roleplay-lab`
- 主区域：`sin`
- 服务端口：8080
- 健康检查：`GET /api/health`

### 3.4 Render

文件：`[render.yaml](../../render.yaml)`

- 免费 PostgreSQL 数据库：`abq-roleplay-db`
- Web 服务：Docker 构建，从数据库读取 `DATABASE_URL`
- 环境变量：MINIMAX_API_KEY、STEPFUN_API_KEY、APP_ENV、ALLOWED_ORIGINS

### 3.5 Vercel

文件：`[vercel.json](../../vercel.json)`

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Vercel 部署主要用于前端静态站点，serverless 函数 `api/chat.py` 与 `api/story.py` 作为备用。

## 4. 数据库初始化

MVP 阶段后端启动时自动建表：

```python
# backend/main.py lifespan
async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
```

Supabase 迁移文件：`[supabase/migrations/20260626120000_create_tables.sql](../../supabase/migrations/20260626120000_create_tables.sql)`

## 5. 测试

### 5.1 后端测试

```bash
cd backend
.venv/bin/python -m pytest tests/ -v
```

测试文件：

- `[backend/tests/test_director_beat_parsing.py](../../backend/tests/test_director_beat_parsing.py)`
- `[backend/tests/test_director_bugfixes.py](../../backend/tests/test_director_bugfixes.py)`
- `[backend/tests/test_memory_persistence.py](../../backend/tests/test_memory_persistence.py)`

### 5.2 前端测试

```bash
npm test
```

前端测试位于 `[test/tool-safety.test.js](../../test/tool-safety.test.js)` 与 `[tests/bugfix.spec.ts](../../tests/bugfix.spec.ts)`。
