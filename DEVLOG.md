# Breaking Bad Roleplay — 开发日志

## 2026-06-24 部署调研（未完成）

### 背景
- 代码已全部写完并推送到 GitHub（私有仓库 `yishu-ziyu/breaking-bad-roleplay`）
- 前端已预编译（`dist/` 存在），后端 `start.py` + `requirements.txt` 就绪
- 目标：部署到公网可访问 URL

### Railway 部署失败记录
- 尝试 3+ 小时，失败原因：
  - GitHub App 集成问题
  - 代理冲突
  - CLI auth 过期
  - Railpack builder 各种报错
  - 换 Dockerfile 后仍失败
- **结论：放弃 Railway，切换平台**

### 平台调研结论
- 对比 Render / Fly.io / Vercel / Railway
- **推荐 Render**：支持 Docker、内置 Postgres、GitHub 集成简单、非技术用户友好
- 唯一缺点：免费层 15 分钟无流量休眠（黑客松 demo 够用）

### 部署准备状态（等待用户确认）
- [ ] Render 账号（新建 or 已有？）
- [ ] GitHub 授权（Render 访问私有仓库）
- [ ] API Keys（MINIMAX_API_KEY、STEPFUN_API_KEY）
- [ ] 执行部署流程（待续）

### 技术架构
- 前端：React 19 + TypeScript + Vite 8（`dist/` 预编译）
- 后端：FastAPI + uvicorn + SQLAlchemy + asyncpg
- 数据库：PostgreSQL（自动 create_all）
- 部署：Dockerfile（python:3.12-slim，同时服务后端 + 前端静态文件）
- 入口：`start.py`（读 PORT env，启动 uvicorn）
- Health：`/api/health`
