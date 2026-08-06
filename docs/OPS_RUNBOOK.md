# ABQ Roleplay Lab - Ops Runbook (project-specific)

This file is **project muscle memory**, not generic engineering advice.
Other repos may do the opposite. Here, follow these small habits every time.

Canonical live URL: **https://bb.yishuziyu.cn**

---

## 1. What "shipped" means here

A change is not done after `git push` alone.

| Layer | Role | When you must update it |
|-------|------|-------------------------|
| GitHub `main` | source of truth | every intentional change |
| **Docker VM** (`121.89.90.68`) | **primary production** (full FastAPI + static) | backend, env, quota, TTS, API, full-stack |
| **Vercel** (`bb.yishuziyu.cn` alias / `*.vercel.app`) | frontend + serverless API path | frontend UI/CSS/assets, or when user asks "上线" and Vercel is enough for the change |

Default after user-facing work:

1. commit + push `main`
2. redeploy the surface that actually serves the change
3. smoke the live URL (not only localhost)

If unsure which surface serves the bug: smoke **both**, or at least `https://bb.yishuziyu.cn`.

---

## 2. Micro-checklist after a fix

Copy this into the mental loop. Do not skip because "it is only a GIF".

```text
[ ] reproduce / confirm fix locally if possible
[ ] frontend: npm run build (and tests when behavior changed)
[ ] backend: cd backend && uv run pytest (when API/quota/TTS/routes changed)
[ ] commit: English conventional commits (feat/fix/docs/chore) - no AI co-author trailer
[ ] push: origin main
[ ] deploy:
      - UI-only often: vercel --prod --yes
      - API/backend/full-stack: Docker VM rebuild of bb-roleplay
      - both if dual path may still serve old assets
[ ] live smoke: open https://bb.yishuziyu.cn and hit the changed path
[ ] health: curl -sS https://bb.yishuziyu.cn/api/health (or /api/... relevant)
```

UI taste changes: take a screenshot or Playwright snapshot of the live page if the change is visual. Code-only sign-off is not enough for landing/chat layout.

---

## 3. Vercel deploy (frontend / serverless)

```bash
cd /Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay
vercel --prod --yes
# or: npx vercel --prod --yes
```

Success looks like:

- `Production: https://breaking-bad-roleplay-....vercel.app`
- `Aliased: https://bb.yishuziyu.cn` (when domain is linked)

### Hard constraints

- Upload budget ~**100MB**. Heavy local trees must stay out.
- Keep `.vercelignore` current. Especially:
  - `materials/breaking-bad/voice-archetypes/samples` (huge)
  - `node_modules`, `backend/.venv`, reports, caches
- Do not put secrets in the client bundle.
- `vercel.json` rewrites `/api/*` -> `https://bb.yishuziyu.cn/api/$1` (Vercel 边缘代理到 VM)。Full FastAPI parity is **not** guaranteed on Vercel serverless; treat VM as the real backend home for quota, TTS, long streams, etc. 移除 route 中的 API 条目后，所有 `/api/*` 请求通过 Vercel 边缘网络代理到 VM，无需在 Vercel 上运行 Python serverless。

### When Vercel fails

- Size / upload errors: check `.vercelignore`, do not upload `materials/` samples.
- Build fails: read Vercel logs; local `npm run build` first.
- Domain SSL async message is normal; wait and re-check HTTPS.

---

## 4. Docker VM deploy (primary full stack)

Facts (do not break `gun.yishuziyu.cn` while doing this):

| Item | Value |
|------|--------|
| Public IP | `121.89.90.68` |
| App dir on server | `/opt/breaking-bad-roleplay` |
| Container name | `bb-roleplay` |
| App port | `8080` (host `0.0.0.0:8080` -> container `8080`) |
| Domain | `bb.yishuziyu.cn` -> Nginx -> `127.0.0.1:8080` |
| Nginx conf | `/etc/nginx/conf.d/bb-roleplay.conf` |
| IP fallback conf | `/etc/nginx/conf.d/red-herring-ip-api.conf` (bare IP may route here) |
| TLS | Let's Encrypt: `/etc/letsencrypt/live/bb.yishuziyu.cn/` |
| Dockerfile CMD | `alembic upgrade head && python3 start.py` |

### Sync code (rsync preferred; tar+scp if rsync missing)

```bash
# from local repo root
rsync -az --delete \
  --exclude node_modules --exclude backend/.venv --exclude .git \
  --exclude dist --exclude playwright-report --exclude test-results \
  --exclude materials/breaking-bad/voice-archetypes/samples \
  ./ root@121.89.90.68:/opt/breaking-bad-roleplay/
```

If `rsync` is unavailable, pack a slim tarball and `scp`, then extract on the server under `/opt/breaking-bad-roleplay`.

### Rebuild container on the server

```bash
ssh root@121.89.90.68
cd /opt/breaking-bad-roleplay
# Prefer existing compose/run script if present on server.
# Typical pattern:
docker build -t bb-roleplay .
docker stop bb-roleplay || true
docker rm bb-roleplay || true
docker run -d --name bb-roleplay --restart unless-stopped \
  -p 8080:8080 \
  --env-file /opt/breaking-bad-roleplay/.env \
  bb-roleplay
docker ps | grep bb-roleplay
curl -sS http://127.0.0.1:8080/api/health
```

Adjust `docker run` flags to match whatever is already on the box if the live container was created with extra env mounts. Prefer **inspect current container** before inventing a new run line:

```bash
docker inspect bb-roleplay --format '{{json .Config.Env}}'
docker inspect bb-roleplay --format '{{json .HostConfig.PortBindings}}'
```

### Env rules on VM

- `ALLOWED_ORIGINS` must include `https://bb.yishuziyu.cn` (not only localhost).
- Platform free demo keys live server-side only (MiniMax / etc.). Never echo them into chat or commits.
- Supabase: VM may need pooler URL (IPv6 direct host often fails on this box). See `DEVLOG.md` 2026-07-02.
- Dockerfile uses China mirrors (npmmirror / Tsinghua) on purpose for this VM network.

### Do not

- Touch `gun.yishuziyu.cn` Nginx conf as part of BB work.
- `docker system prune -a` without checking other containers on the shared VM.
- Commit `.env` or production keys.

### Docker build pitfalls（2026-08-04 踩坑）

这两个坑会让 `docker build` 在 VM 上失败，但本地整天 `npm run dev` / `uvicorn` 都看不出来——只在 Docker 干净构建时暴露：

1. **不要携带平台相关的 `package-lock.json` 进前端构建阶段。**
   lockfile 在 macOS 上生成，只记录 `binding-darwin-arm64` 这一个 rolldown 原生绑定条目；Linux 的 `@rolldown/binding-linux-*` 没有独立包条目。`npm ci` 严格按 lockfile 装，Linux 容器里就缺 binding，`vite build` 报 `Cannot find native binding`（npm/cli#4828）。
   **解法**：Dockerfile 的 frontend-build 阶段只 `COPY package.json ./`，用 `npm install`（不是 `npm ci`），让 npm 在容器内按当前平台解析绑定。`.dockerignore`/构建上下文里照常排除 `node_modules`。
2. **`backend/requirements.txt` 里的 `face_recognition` 是死依赖，不要因为它"看起来在第 12 行"就保留。**
   它拖进 `dlib`，需要 cmake 源码编译，在 `python:3.12-slim` 里必挂（`Failed building wheel for dlib`）。之前线上能跑只是 Docker 缓存把那次编译结果盖住了；Dockerfile 一改缓存失效就暴露。
   **解法**：后端代码从未 `import face_recognition`，直接删掉 `requirements.txt` 和 `pyproject.toml` 里的 `face_recognition` 声明即可。若以后真需要人脸识别，再在 Dockerfile 里预装 cmake + build-essential 并显式加入。

**验证信号**：重建后 `docker build` 全绿，`curl -sS http://127.0.0.1:8080/api/health` 返回 `{"status":"ok"}`；随后在 `https://bb.yishuziyu.cn` 走一次 Story 创建（填简报 → 开始任务），确认 `POST /api/session/create` 返回 200 而非 500。

---

## 5. Dual-path reality (do not "fix one, forget the other")

| Change type | Prefer |
|-------------|--------|
| Pure frontend (App.tsx, CSS, roleAssets GIFs, landing) | Vercel prod is usually enough **if** DNS alias points there; if users hit VM-served static, rebuild Docker too |
| Backend routes, quota, TTS, provider, migrations | **Docker VM required** |
| Free-tier / security | VM + verify live `/api` behavior |
| "Deploy everything" user request | push + Vercel + VM |

DNS: `bb.yishuziyu.cn` **A record points at the VM** (`121.89.90.68`). That is what users actually load.

Critical: `vercel --prod` printing `Aliased: https://bb.yishuziyu.cn` does **not** mean the live site is Vercel. For this project the user-facing domain is Nginx on the VM. **Frontend-only fixes still require a Docker rebuild** if you want them on `bb.yishuziyu.cn`.

### Vercel Rewrites 双轨策略（P2 简化）

`vercel.json` 中的 `rewrites` 配置将所有 `/api/*` 请求从 Vercel 边缘网络代理到 VM：

```
/api/*  →  Vercel edge  →  rewrites  →  https://bb.yishuziyu.cn/api/$1  →  VM Nginx  →  FastAPI
```

**工作方式**：
- Vercel 部署时只上传前端静态文件（`dist/`），不再上传或运行 `api/index.py` serverless function。
- 所有 `/api/*` 请求到达 Vercel 边缘节点后，由 `rewrites` 直接代理到 VM 的 `https://bb.yishuziyu.cn`。
- 前端静态文件（`/assets/*`、`/index.html` 等）由 Vercel 的 filesystem handler 直接 serve。
- SPA 路由回退：`/(.*)` → `/index.html` 由 `routes` 处理。

**优势**：
1. 前端部署只需 `vercel --prod --yes`，无需担心 API 层一致性。
2. VM 只需 serve 后端 API，静态文件由 Vercel CDN 处理，减轻 VM 负载。
3. 前端改动（UI、GIF、CSS）只需部署 Vercel，无需重建 Docker 容器。
4. Vercel 边缘网络就近代理，延迟比直接请求 VM 的 `/api/` 更低。

**注意事项**：
- VM 的 `ALLOWED_ORIGINS` 必须包含 Vercel 域名（`https://*.vercel.app`）以及 `https://bb.yishiziyu.cn`。
- 当用户直接访问 `https://bb.yishiziyu.cn`（DNS 指向 VM）时，请求不经过 Vercel rewrites，走的是 VM Nginx → FastAPI 的完整路径。
- 两种路径的行为必须一致。如果发现 VM 直连和 Vercel 代理路径表现不同，优先排查 VM 端的 CORS / 环境变量配置。
- `vercel.json` 中保留了 `functions.api/index.py` 的配置，但 `routes` 中已移除对应的 API 路由。如需回退到 Vercel serverless API，只需在 `routes` 中添加 `{ "src": "/api/(.*)", "dest": "/api/index.py" }` 即可。

Local machines often lack `rsync`; use tar + scp:

```bash
tar czf /tmp/bb-deploy.tgz \
  --exclude=node_modules --exclude=backend/.venv --exclude=.git \
  --exclude=dist --exclude=playwright-report --exclude=test-results \
  --exclude='materials/breaking-bad/voice-archetypes/samples' .
scp /tmp/bb-deploy.tgz root@121.89.90.68:/tmp/bb-deploy.tgz
ssh root@121.89.90.68 'cd /opt/breaking-bad-roleplay && tar xzf /tmp/bb-deploy.tgz && docker build -t bb-roleplay:latest . && docker stop bb-roleplay && docker rm bb-roleplay && docker run -d --name bb-roleplay --restart unless-stopped -p 8080:8080 --env-file /opt/breaking-bad-roleplay/.env.runtime bb-roleplay:latest'
```

Keep `/opt/breaking-bad-roleplay/.env.runtime` on the server (keys only, mode 600). Never print its contents into chat logs.

After any deploy, verify the **served** CSS hash includes the change:

```bash
curl -sS http://127.0.0.1:8080/ | grep -oE 'assets/index-[^"]+\.css'
# then curl that file and confirm the new rule token exists
```

---

## 6. Other small habits that matter only here

### Role GIFs (`src/roleAssets.ts`)

- **2026-07-15 footgun:** Hank v1 pool used random Giphy IDs tagged by emotion only. First-frame audit showed Moone Boy / Forrest Gump / dead assets - not Dean Norris. Tags ≠ face. Always download first frame and confirm the actor before shipping.

- Whitelist only. Never random Giphy search at runtime for production pools.
- After adding/changing a GIF ID: download first frame, **visually** confirm it is the character (no meme stickers / wrong show).
- Mike incident: `M0XoCjRUkhSYE` looked like Mike but was a SpongeBob "perfection" meme overlay. Visual audit is mandatory.

### Voice / TTS

- Six cast clones (Walter/Jesse/Skyler/Saul/Mike/Gus). Casting config under `materials/breaking-bad/voice-archetypes/`.
- Chat Voice button: every non-user message with `connectionSessionId`, not only opener.
- TTS costs free-tier credits (`tts` unit). Respect quota gates.

### Free tier / security

- See `docs/FREE_TIER_SECURITY.md`.
- Guest UUID + IP hash; site budget + per-IP rate limits.
- Platform demo = **shared server keys = your bill**. BYOK = user vault + RAM bind.
- Never put API keys in frontend.

### Commits

- English conventional commits.
- No auto AI co-author lines.
- Prefer small shippable commits over mega-dumps when possible.

### Docs that go stale

- `docs/DEPLOY_RENDER.md`, old Render/Fly configs under `deploy/archive/` are **historical**, not the current primary path.
- Current primary path = **this runbook** + `DEVLOG.md` (2026-07-02 VM notes).

---

## 7. Minimum live smoke (60 seconds)

1. Open `https://bb.yishuziyu.cn`
2. Landing loads (not blank, not old broken CSS)
3. Enter world / pick a character
4. Send one short chat line OR advance one story beat
5. If you touched Voice: confirm button on a non-opener reply
6. If you touched GIFs: confirm character GIF is not meme/wrong cast
7. If you touched quota: confirm exhausted state returns a clear 4xx, not 500

---

## 8. Where this lives

| File | Purpose |
|------|---------|
| `docs/OPS_RUNBOOK.md` | **this file** - ship habits |
| `CLAUDE.md` | agent entry; must link here |
| `DEVLOG.md` | chronological deploy history |
| `docs/FREE_TIER_SECURITY.md` | free credits + abuse controls |
| `docs/code-wiki/deployment.md` | broader local/run reference |

When a new project-only footgun appears (deploy, DNS, GIF, quota), **add a bullet here in the same session**, do not leave it only in chat memory.
