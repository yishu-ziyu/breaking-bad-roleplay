import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

function formatCost(costs: Record<string, number>): string {
  return Object.entries(costs)
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} -${value}`)
    .join(' · ')
}

describe('game kernel cost labels', () => {
  it('shows real action costs', () => {
    assert.equal(formatCost({ cash: 200, saul_favor: 1 }), 'cash -200 · saul_favor -1')
  })

  it('hides empty costs', () => {
    assert.equal(formatCost({}), '')
  })
})
