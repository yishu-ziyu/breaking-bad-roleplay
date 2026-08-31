import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE_BACKDROPS,
  STAGE_BACKDROP_FALLBACK,
  pickStageBackdrop,
  pickStageBackdropInfo,
} from './stageBackdrops.ts'

describe('pickStageBackdrop', () => {
  it('routes desert / reservation wording to desert-night', () => {
    assert.equal(pickStageBackdrop('托胡阿吉莱保留地沙漠 — 夜'), '/backgrounds/stage-bg-desert-night.jpg')
    assert.equal(pickStageBackdrop('荒漠公路 外景'), '/backgrounds/stage-bg-desert-night.jpg')
    assert.equal(pickStageBackdrop('north of the ABQ desert'), '/backgrounds/stage-bg-desert-night.jpg')
  })

  it('routes rv / lab wording to rv-interior', () => {
    assert.equal(pickStageBackdrop('INT. 房车车厢 — 夜 实验室'), '/backgrounds/stage-bg-rv-interior.jpg')
    assert.equal(pickStageBackdrop('The RV rolls north of ABQ'), '/backgrounds/stage-bg-rv-interior.jpg')
  })

  it('matches short english keywords on word boundaries only', () => {
    // "nervous" 内含 rv，但整词匹配不应误判成房车内景
    assert.equal(pickStageBackdrop('nervous energy under the desert sky'), '/backgrounds/stage-bg-desert-night.jpg')
  })

  it('routes home kitchen wording to kitchen-night', () => {
    assert.equal(pickStageBackdrop('怀特家的厨房 灯还亮着'), '/backgrounds/stage-bg-kitchen-night.jpg')
    assert.equal(pickStageBackdrop('living room 客厅 住宅'), '/backgrounds/stage-bg-kitchen-night.jpg')
  })

  it('routes lawyer / saul office wording to office-neon', () => {
    assert.equal(pickStageBackdrop('Saul Goodman 律师办公室 霓虹'), '/backgrounds/stage-bg-office-neon.jpg')
    assert.equal(pickStageBackdrop('法律事务所 office'), '/backgrounds/stage-bg-office-neon.jpg')
  })

  it('routes pollos / fryer wording to chicken-bar', () => {
    assert.equal(pickStageBackdrop('Los Pollos Hermanos 炸鸡店后厨'), '/backgrounds/stage-bg-chicken-bar.jpg')
    assert.equal(pickStageBackdrop('鸡肉餐厅打烊后'), '/backgrounds/stage-bg-chicken-bar.jpg')
  })

  it('kitchen beats office when both keywords appear (weight decides)', () => {
    assert.equal(pickStageBackdrop('办公室楼上的茶水厨房'), '/backgrounds/stage-bg-kitchen-night.jpg')
  })

  it('chicken fryer beats plain kitchen (weight decides)', () => {
    assert.equal(pickStageBackdrop('炸鸡店的后厨与厨房'), '/backgrounds/stage-bg-chicken-bar.jpg')
  })

  it('falls back to desert-night on empty or unmatched text', () => {
    assert.equal(pickStageBackdrop(''), STAGE_BACKDROP_FALLBACK.url)
    assert.equal(pickStageBackdrop('未知的太空站'), '/backgrounds/stage-bg-desert-night.jpg')
    assert.equal(pickStageBackdrop('   '), STAGE_BACKDROP_FALLBACK.url)
  })

  it('info variant agrees with the url variant and carries a slugline label', () => {
    const info = pickStageBackdropInfo('Los Pollos 炸鸡店后厨')
    assert.equal(info.url, pickStageBackdrop('Los Pollos 炸鸡店后厨'))
    assert.equal(info.label, '内景 · 炸鸡店后厨')
    assert.equal(pickStageBackdropInfo('').label, '外景 · 沙漠夜')
  })

  it('keeps every route pointing at a public stage-bg asset', () => {
    for (const route of STAGE_BACKDROPS) {
      assert.match(route.url, /^\/backgrounds\/stage-bg-[a-z-]+\.jpg$/)
      assert.ok(route.label.length > 0)
    }
  })
})
