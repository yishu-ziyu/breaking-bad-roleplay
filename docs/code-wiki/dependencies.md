# 依赖清单

## 前端依赖 (npm)

### 生产依赖

| 包名 | 版本 | 说明 |
|------|------|------|
| `react` | ^19.2.6 | 前端框架 |
| `react-dom` | ^19.2.6 | React DOM 渲染 |
| `@supabase/supabase-js` | ^2.108.2 | Supabase 客户端 SDK |
| `@supabase/ssr` | ^0.12.0 | Supabase SSR 支持 |

### 开发依赖

| 包名 | 版本 | 说明 |
|------|------|------|
| `vite` | ^8.0.12 | 构建工具 |
| `@vitejs/plugin-react` | ^6.0.1 | Vite React 插件 |
| `typescript` | ~6.0.2 | TypeScript 编译器 |
| `tsx` | ^4.22.0 | TypeScript 执行器 (测试用) |
| `eslint` | ^10.3.0 | 代码检查 |
| `@eslint/js` | ^10.0.1 | ESLint JS 配置 |
| `typescript-eslint` | ^8.59.2 | TS ESLint 支持 |
| `eslint-plugin-react-hooks` | ^7.1.1 | React Hooks ESLint 规则 |
| `eslint-plugin-react-refresh` | ^0.5.2 | React Refresh ESLint 规则 |
| `globals` | ^17.6.0 | 全局变量定义 |
| `@types/react` | ^19.2.14 | React 类型定义 |
| `@types/react-dom` | ^19.2.3 | React DOM 类型定义 |
| `@types/node` | ^24.12.3 | Node 类型定义 |
| `@playwright/test` | ^1.49.0 | E2E 测试框架 |

## 后端依赖 (Python)

### 生产依赖 (requirements.txt / pyproject.toml)

| 包名 | 版本 | 说明 |
|------|------|------|
| `fastapi` | >=0.110.0 | Web 框架 |
| `uvicorn[standard]` | >=0.29.0 | ASGI 服务器 |
| `sqlalchemy[asyncio]` | >=2.0.0 | ORM (异步) |
| `asyncpg` | >=0.29.0 | PostgreSQL 异步驱动 |
| `httpx` | >=0.27.0 | HTTP 客户端 (LLM 调用) |
| `pydantic-settings` | >=2.0.0 | Pydantic 配置管理 |
| `python-dotenv` | >=1.0.0 | .env 文件加载 |
| `alembic` | >=1.18.5 | 数据库迁移 |
| `psycopg2-binary` | >=2.9.12 | PostgreSQL 同步驱动 (Alembic 用) |

### 开发依赖

| 包名 | 说明 |
|------|------|
| `pytest-asyncio` | 异步测试支持 |
| `ruff` | Python linter |

## 工具链

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 20 (slim) | 前端构建 + 运行时 |
| Python | 3.12 (slim) | 后端运行时 |
| uv | — | Python 包管理器 (替代 pip) |
| Docker | — | 容器化部署 |
| Alembic | 1.18+ | 数据库迁移 |
| Playwright | 1.49+ | E2E 测试 |
| ESLint | 10.x | 前端 Lint |
| Ruff | — | 后端 Lint |

## 外部服务

| 服务 | 用途 |
|------|------|
| **Supabase** | PostgreSQL 数据库托管 + Auth 认证 |
| **MiniMax** | LLM 提供商 (M3 模型) + TTS 语音合成 |
| **StepFun** | LLM 提供商 (step-3.7-flash) |
| **Giphy** | 角色 GIF 表情托管 |
| **Vercel** | 前端静态文件托管 (可选) |
| **Docker VM** (121.89.90.68) | 主生产服务器 |
| **Let's Encrypt** | TLS 证书 |

## 依赖关系图

```mermaid
flowchart LR
    subgraph Frontend["前端 (React SPA)"]
        RE[react / react-dom<br/>UI 框架]
        SU[<br/>@supabase/supabase-js<br/>认证 + 数据库]
        VT[vite / typescript<br/>构建 & 类型检查]
    end

    subgraph Backend["后端 (FastAPI)"]
        FA[fastapi / uvicorn<br/>Web 服务器]
        SA[sqlalchemy / asyncpg<br/>数据库 ORM + 驱动]
        AL[alembic / psycopg2-binary<br/>迁移工具]
        HT[httpx<br/>LLM 提供商 HTTP 调用]
        PS[pydantic-settings<br/>配置管理]
    end

    subgraph LLM["外部 LLM 提供商"]
        MM[MiniMax<br/>minimax/]
        SF[StepFun<br/>stepfun/]
        CP[CLI Proxy<br/>cliproxy/]
    end

    DB[(PostgreSQL<br/>Supabase 托管)]

    Frontend --> Backend
    Backend --> LLM
    Backend --> DB
    SA --> DB
    AL --> DB
    HT --> MM
    HT --> SF
    HT --> CP
```