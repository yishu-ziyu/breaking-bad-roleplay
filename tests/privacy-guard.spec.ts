import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(`${PROJECT_ROOT}${path}`, 'utf8')
}

describe('privacy logging guardrails', () => {
  it('backend chat route does not log user message, history, prompt, or model response bodies', () => {
    const routes = source('backend/api/routes.py')
    const forbidden = ['payload.userInput', 'payload.history', 'memorySummary', 'keyFacts', 'reply_text', 'debate_logs']
    const loggerLines = routes.split(/\r?\n/).filter(line => line.includes('logger.'))

    for (const line of loggerLines) {
      for (const token of forbidden) {
        assert.equal(line.includes(token), false, `Sensitive chat data reached logger: ${line.trim()}`)
      }
    }
  })

  it('production frontend source does not contain console.log debug logging', () => {
    const app = source('src/App.tsx')
    assert.equal(/console\.log/.test(app), false)
  })

  it('provider transport does not log raw provider request or response payloads', () => {
    const provider = source('backend/agents/provider.py')
    const loggerLines = provider.split(/\r?\n/).filter(line => line.includes('logger.'))
    for (const line of loggerLines) {
      assert.equal(/payload|response|messages/.test(line), false, `Provider logs raw transport data: ${line.trim()}`)
    }
  })
})
