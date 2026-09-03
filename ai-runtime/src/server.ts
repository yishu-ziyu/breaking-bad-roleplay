import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { PerformanceRequest } from "./contracts.ts"
import { liveProviderFromEnv } from "./providers.ts"
import { runtime } from "./runtime.ts"

const PORT = Number(process.env.AI_RUNTIME_PORT || 8010)
const HOST = process.env.AI_RUNTIME_HOST || "127.0.0.1"

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function parseRequest(raw: string): PerformanceRequest {
  const body = JSON.parse(raw) as PerformanceRequest
  if (!body.request_id || !body.game_id || !body.resolved_beat) {
    throw new Error("request_id, game_id, resolved_beat required")
  }
  body.character_id = "walter"
  body.language = body.language === "zh" ? "zh" : "en"
  if (!body.provider) body.provider = liveProviderFromEnv()
  return body
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`)
  try {
    if (req.method === "GET" && url.pathname === "/internal/health") {
      json(res, 200, { status: "ok", service: "ai-runtime", sessions: runtime.registry.size() })
      return
    }
    if (req.method === "POST" && url.pathname === "/perform") {
      const request = parseRequest(await readBody(req))
      const result = await runtime.perform(request)
      json(res, 200, result)
      return
    }
    if (req.method === "POST" && url.pathname === "/perform/stream") {
      const request = parseRequest(await readBody(req))
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })
      let done = false
      const write = (event: { type: string; text?: string }) => {
        if (event.type === "done") {
          if (done) return
          done = true
        }
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      }
      req.on("close", () => {
        void runtime.abort(request.game_id, request.character_id)
      })
      await runtime.perform(request, { onEvent: write })
      if (!done) write({ type: "done" })
      res.end()
      return
    }
    if (req.method === "POST" && url.pathname === "/abort") {
      const body = JSON.parse(await readBody(req)) as { game_id: string; character_id?: string }
      await runtime.abort(body.game_id, body.character_id ?? "walter")
      json(res, 200, { ok: true })
      return
    }
    if (req.method === "POST" && url.pathname === "/dispose") {
      const body = JSON.parse(await readBody(req)) as { game_id: string; character_id?: string }
      runtime.dispose(body.game_id, body.character_id)
      json(res, 200, { ok: true })
      return
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "bad request" })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`ai-runtime listening on http://${HOST}:${PORT}`)
})

const shutdown = () => {
  runtime.shutdown()
  server.close()
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
