import type { IncomingMessage } from 'node:http'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { callMiniMaxTokenPlan } from './server/minimax'

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

  return {
    plugins: [
      react(),
      {
        name: 'minimax-token-plan-api',
        configureServer(server) {
          server.middlewares.use('/api/chat', async (request, response) => {
            if (request.method !== 'POST') {
              response.statusCode = 405
              response.end(JSON.stringify({ error: 'Method not allowed.' }))
              return
            }

            try {
              const body = await readJsonBody(request)
              const output = await callMiniMaxTokenPlan(env.MINIMAX_TOKEN_PLAN_KEY, body as { systemPrompt: string; contextPrompt: string })
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify(output))
            } catch (error) {
              response.statusCode = 500
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown MiniMax request error.' }))
            }
          })
        },
      },
    ],
  }
})
