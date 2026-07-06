import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function appSource() {
  return readFileSync(`${PROJECT_ROOT}/src/App.tsx`, 'utf8')
}

function cssSource() {
  return readFileSync(`${PROJECT_ROOT}/src/App.css`, 'utf8')
}

describe('handleCharChange relation preservation', () => {
  it('keeps prev[id] when it already exists and does not overwrite the default', () => {
    const app = appSource()

    assert.match(
      app,
      /const savedRelation = prev\[id\][\s\S]*?return \{ \.\.\.prev, \[id\]: savedRelation \?\? characters\.find\(c => c\.id === id\)!\.relationOptions\[0\] \}/,
      'handleCharChange must keep prev[id] when it already exists',
    )
  })

  it('surfaces a user-visible relation notice (not just console.info) when a saved relation is reused', () => {
    const app = appSource()
    const css = cssSource()

    assert.match(
      app,
      /setRelationNotice\(/,
      'handleCharChange should set a relation-notice state when a saved relation is reused',
    )
    assert.match(
      app,
      /\{\s*relationNotice\s*&&\s*\([\s\S]*?role="status"/,
      'App should render a role="status" notice when relationNotice is non-null',
    )
    assert.match(
      css,
      /\.relation-notice/,
      'CSS must define a .relation-notice class for the inline pill',
    )
  })
})