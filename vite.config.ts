import type { IncomingMessage } from 'node:http'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import gameLoopHandler from './api/game-loop'
import chatHandler from './api/chat'
import ttsHandler from './api/tts'

function readJsonBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let rawBody = ''
    request.on('data', (chunk) => {
      rawBody += chunk
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(rawBody))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Inject environment variable for serverless API handlers in development
  process.env.MINIMAX_TOKEN_PLAN_KEY = env.MINIMAX_TOKEN_PLAN_KEY;

  return {
    plugins: [
      react(),
      {
        name: 'minimax-token-plan-api',
        configureServer(server) {
          server.middlewares.use('/api/chat', async (request, response) => {
            const body = (request.method === 'POST' ? await readJsonBody(request).catch(() => ({})) : {}) as Record<string, unknown>
            await chatHandler(
              { method: request.method, body },
              {
                status(code: number) {
                  response.statusCode = code
                  return this
                },
                json(payload: unknown) {
                  response.setHeader('Content-Type', 'application/json')
                  response.end(JSON.stringify(payload))
                },
              },
            )
          })
          server.middlewares.use('/api/game-loop', async (request, response) => {
            const body = (request.method === 'POST' ? await readJsonBody(request).catch(() => ({})) : {}) as Record<string, unknown>
            await gameLoopHandler(
              { method: request.method, body },
              {
                status(code: number) {
                  response.statusCode = code
                  return this
                },
                json(payload: unknown) {
                  response.setHeader('Content-Type', 'application/json')
                  response.end(JSON.stringify(payload))
                },
              },
            )
          })
          server.middlewares.use('/api/tts', async (request, response) => {
            const body = (request.method === 'POST' ? await readJsonBody(request).catch(() => ({})) : {}) as Record<string, unknown>
            await ttsHandler(
              { method: request.method, body },
              {
                status(code: number) {
                  response.statusCode = code
                  return this
                },
                json(payload: unknown) {
                  response.setHeader('Content-Type', 'application/json')
                  response.end(JSON.stringify(payload))
                },
              },
            )
          })
        },
      },
    ],
  }
})
