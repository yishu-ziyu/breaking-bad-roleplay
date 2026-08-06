# Agent Harness — ready to try (end of 30min sprint)

**Backend:** http://127.0.0.1:8002 (uvicorn; 8001 常被占)  
**Frontend:** http://127.0.0.1:5176 → bottom-right **Agent 实验台**  
（Vite proxy 指向 8002；见 `vite.config.ts`）

## Green checks

- 61 harness unit/API tests passed
- Acceptance batch: cast / dossier / guardrail / mckee / crew / pollos / stats = ALL True

## Try first

1. Open http://127.0.0.1:5173
2. Click bottom-right Agent 实验台
3. Leave offline ON, message: `列出可玩角色` → Run
4. Try: `recall jesse` / safety blocked prompt / crew multi-agent

Docs: `docs/agent-harness/TRY_NOW.md`, `README.md`, `SPRINT_30MIN.md`
