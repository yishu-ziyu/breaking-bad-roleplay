import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(here, '../App.tsx'), 'utf8')

describe('relation prototype wiring', () => {
  it('stays behind ?relproto=1 and keeps the header select for the default path', () => {
    assert.match(app, /relationPrototypeEnabled\(/)
    assert.match(app, /relationProto && \(/)
    assert.match(app, /!relationProto &&/)
    assert.match(app, /id="chat-relation"/)
    assert.match(app, /<RelationPills/)
    assert.doesNotMatch(app, /import\.meta\.env/)
  })

  it('still writes relations onto the chat-v2 thread key', () => {
    assert.match(app, /setRelationByChar\(\(prev\) => \(\{ \.\.\.prev, \[threadKey\]: next \}\)\)/)
  })
})
