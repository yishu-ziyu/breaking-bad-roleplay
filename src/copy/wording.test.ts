// Guards docs/GLOSSARY.md: player-visible copy must not use banned product words.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..')

// Outside the glossary's scope (see docs/GLOSSARY.md「不在词表管辖内」).
const EXEMPT = [
  'lib/directOpeners.ts',
  'lib/directWayfinders.ts',
  'lib/voiceExamples.ts',
  'lib/voicePlayerHelpers.ts',
  'features/game/',
  'components/AgentHarnessPanel.tsx',
  'roleProfiles.ts',
  'copy/',
]

// Strings that match a banned word but are not player-visible copy.
const ALLOW: Array<{ file: string; text: string; exact?: boolean; why: string }> = [
  { file: 'App.tsx', text: '开场压迫', exact: true, why: 'internal emotion tag on openers; never rendered, keys GIF lookup' },
  { file: 'lib/gifResolver.ts', text: '开场压迫', exact: true, why: 'GIF lookup key for the opener emotion tag' },
  { file: 'App.tsx', text: '从关键节点分叉', why: 'prompt sent to the model when branching a story' },
  { file: 'App.tsx', text: 'Branch from the earlier decisive beat', why: 'prompt sent to the model when branching a story' },
  { file: 'components/coldOpenCopy.ts', text: 'Beat whatever else', why: '"beat" as a verb (get there first)' },
]

const BANNED_ZH = [
  // D1 product name / D2 modes
  'Roleplay Lab', '互动剧情', '长线剧情演绎', '角色深度对话', '角色对话', '群像会谈', '游玩模式', '开始故事',
  // D3 names
  '迈克', '老白', '小粉', '炸鸡叔',
  // D4 director / D5 units
  '导演', '节点', '一拍', '这一拍', '下一拍', '节拍', '幕间', '分镜', '张力', '开场压迫',
  // D6 account
  '档案', '访问密码', '访客', '游客',
  // D7 quota / D8 AI settings
  '额度', '免费体验', '早期用户', '不占', '自备密钥', '线路', '模型引擎', '平台演示', '我的密钥', '密钥', '路演',
  // D9 identity
  '身份对', '锚点',
  // engineering words
  '重定向', '切换视角', '工具调用', '编号', '落地', '结算', '绑定',
  // retired metaphors
  '局面图', '局面地图', '局面展开',
  // facts
  '嫂子',
]

const BANNED_EN = [
  /\bBYOK\b/, /\bRoleplay Lab\b/i, /\bdirector\b/i, /\bquota\b/i, /\bbeat\b/i,
  /\bdemo\b/i, /\bearly-access\b/i, /\bown key\b/i, /\bthe run\b/i, /\bsituation map\b/i,
  /\bDirect (chat|mode)\b/, /\bCrew\b/,
]
const EN_NAMES = /\b(Walter|Jesse|Skyler|Saul|Mike|Gus|Hank|Marie|Heisenberg|Pinkman|Goodman|Fring|Ehrmantraut|Schrader)\b/i
const HAN = /\p{Script=Han}/u

function uiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return uiFiles(path)
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) return []
    const rel = relative(src, path)
    return EXEMPT.some((e) => rel.startsWith(e)) ? [] : [path]
  })
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** String literals and JSX text — the parts a player can see. */
function visibleStrings(code: string): string[] {
  const out: string[] = []
  const literal = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g
  for (const m of code.matchAll(literal)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  for (const m of code.matchAll(/>([^<>{}]*\p{Script=Han}[^<>{}]*)</gu)) out.push(m[1])
  return out
}

type Hit = { file: string; word: string; text: string }

function checkStrings(rel: string, strings: string[]): Hit[] {
  const hits: Hit[] = []
  for (const text of strings) {
    if (ALLOW.some((a) => a.file === rel && (a.exact ? text === a.text : text.includes(a.text)))) continue
    if (HAN.test(text)) {
      for (const word of BANNED_ZH) if (text.includes(word)) hits.push({ file: rel, word, text })
      const name = text.match(EN_NAMES)
      if (name) hits.push({ file: rel, word: `英文名 ${name[1]}`, text })
    } else {
      // Ignore interpolated code and class-name strings such as `quota-pill${…}`.
      const plain = text.replace(/\$\{[^}]*\}/g, ' ').trim()
      if (!/\s/.test(plain) || /^[a-z0-9]+[-_][a-z0-9-_]*(\s|$)/.test(plain)) continue
      for (const re of BANNED_EN) {
        const m = plain.match(re)
        if (m) hits.push({ file: rel, word: m[0], text })
      }
    }
  }
  return hits
}

function scan(): Hit[] {
  const hits = uiFiles(src).flatMap((file) =>
    checkStrings(relative(src, file), visibleStrings(stripComments(readFileSync(file, 'utf8')))),
  )
  // The browser tab title is the first place a player reads the product name.
  const html = readFileSync(join(src, '..', 'index.html'), 'utf8')
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
  if (/ABQ|Roleplay Lab/i.test(title)) hits.push({ file: 'index.html', word: 'title', text: title })
  return hits
}

describe('player-visible wording follows docs/GLOSSARY.md', () => {
  it('the checker itself catches banned copy (positive control)', () => {
    const words = checkStrings('fixture.tsx', [
      '让导演继续', '重试这一拍', '和 Walter 聊聊', '局面展开中…', '平克曼 Pinkman 来了',
      'Free demo credits used up. Connect your own key.', 'The run may still be generating', 'Direct and Crew',
    ]).map((h) => h.word)
    for (const w of ['导演', '这一拍', '英文名 Walter', '局面展开', '英文名 Pinkman', 'demo', 'own key', 'Crew']) {
      assert.ok(words.includes(w), `expected the checker to flag ${w}; got ${words.join(', ')}`)
    }
    assert.deepEqual(checkStrings('fixture.tsx', ['quota-pill is-low', 'beat-paused beat-paused--drama', '今天还剩 3 次']), [])
  })

  it('uses no banned words and no English names inside Chinese copy', () => {
    const hits = scan()
    const report = hits.map((h) => `${h.file}  [${h.word}]  ${h.text.slice(0, 80)}`).join('\n')
    assert.equal(hits.length, 0, `banned wording found:\n${report}`)
  })
})
