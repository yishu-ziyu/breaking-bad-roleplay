import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RelationPills } from './RelationPills.tsx'
import { relationLockCopy } from '../lib/relationPrototype.ts'

const OPTIONS = ['family member', 'lab partner', 'former student', 'DEA liability']
const LABELS = {
  'family member': '家人',
  'lab partner': '实验室搭档',
  'former student': '学生',
  'DEA liability': '隐患（汉克可能会查到你）',
}
const EXPLAINS = {
  'family member': '家里的人。他会把一部分话留在心里。',
  'lab partner': '一起干活的搭档。他默认你会跟上。',
  'former student': '他以前教过你。',
  'DEA liability': '他怕这件事传到汉克耳朵里。',
}

function render(overrides: Partial<Parameters<typeof RelationPills>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(RelationPills, {
      prefix: '你是沃尔特的：',
      options: OPTIONS,
      value: 'family member',
      locked: false,
      language: 'zh',
      labels: LABELS,
      explanations: EXPLAINS,
      lockHint: relationLockCopy('zh'),
      onChange: () => {},
      ...overrides,
    }),
  )
}

describe('RelationPills prototype', () => {
  it('shows 2–4 readable options before the first message', () => {
    const html = render()
    assert.match(html, /data-relation-prototype="true"/)
    assert.match(html, /role="radiogroup"/)
    assert.match(html, /家人/)
    assert.match(html, /实验室搭档/)
    assert.match(html, /学生/)
    assert.match(html, /隐患/)
    assert.doesNotMatch(html, /<select/)
  })

  it('marks the current option in text and expands its one-line explanation', () => {
    const html = render({ value: 'lab partner' })
    assert.match(html, /is-selected[^>]*>[\s\S]*实验室搭档[\s\S]*已选[\s\S]*一起干活的搭档/)
    assert.match(html, /aria-checked="true"/)
    assert.match(html, /aria-label="实验室搭档 · 已选"/)
  })

  it('keeps the lock after the first message and explains how to correct it', () => {
    const html = render({ locked: true, value: 'former student' })
    assert.match(html, /学生/)
    assert.match(html, /已选/)
    assert.match(html, /开聊/)
    assert.match(html, /对话/)
    assert.doesNotMatch(html, /role="radiogroup"/)
    assert.doesNotMatch(html, /实验室搭档/)
  })

  it('explains the lock in English when the UI is English', () => {
    const html = render({
      locked: true,
      language: 'en',
      prefix: "You are Walter's:",
      labels: { ...LABELS, 'former student': 'student' },
      value: 'former student',
      lockHint: relationLockCopy('en'),
    })
    assert.match(html, /Selected/)
    assert.match(html, /first message/i)
    assert.match(html, /chat/i)
  })

  it('is a keyboard radiogroup: options are radios with a shared name', () => {
    const html = render()
    assert.match(html, /role="radio"/)
    assert.match(html, /aria-checked="false"/)
    const radios = html.match(/role="radio"/g) ?? []
    assert.equal(radios.length, 4)
  })
})
