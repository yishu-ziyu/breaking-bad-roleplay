import React from 'react'
import { characterPortrait as portrait } from '../lib/characterPortraits'

type ChatCharacter = 'walter' | 'jesse' | 'saul' | 'skyler' | 'mike' | 'gus' | 'hank' | 'marie'
type Props = { onStory: () => void; onChat: (character: ChatCharacter) => void }
const cast: { id: ChatCharacter; name: string; english: string; description: string }[] = [
  { id: 'walter', name: '沃尔特·怀特', english: 'WALTER WHITE', description: '化学老师。骄傲、精确，习惯掌控局面。' },
  { id: 'jesse', name: '杰西·平克曼', english: 'JESSE PINKMAN', description: '沃尔特的搭档。冲动，重感情。' },
  { id: 'saul', name: '索尔·古德曼', english: 'SAUL GOODMAN', description: '刑事律师。善于谈判，也善于寻找漏洞。' },
  { id: 'gus', name: '古斯·弗林', english: 'GUSTAVO FRING', description: '餐厅经营者。礼貌、谨慎，要求事情按计划进行。' },
  { id: 'mike', name: '迈克·厄曼特劳特', english: 'MIKE EHRMANTRAUT', description: '前警察。务实、寡言，负责处理麻烦。' },
  { id: 'skyler', name: '斯凯勒·怀特', english: 'SKYLER WHITE', description: '沃尔特的妻子。关注家庭，也留意他的隐瞒。' },
  { id: 'hank', name: '汉克·施拉德', english: 'HANK SCHRADER', description: '缉毒局探员。直率、敏锐，也是沃尔特的家人。' },
  { id: 'marie', name: '玛丽·施拉德', english: 'MARIE SCHRADER', description: '汉克的妻子、斯凯勒的妹妹。关心家人，喜欢追问。' },
]
// Recorded during the 2026-09-09 live smoke, not live model outputs.
const sample = [
  { kind: '内心', text: '五分钟。再五分钟他就站起来。把手机翻过去是为了不去数那个没人回的对话框——每次点亮都是沃尔特不在场的证据。' },
  { kind: '台词', text: '两分钟。操，就两分钟。我都快把手机盯穿了……沃尔特肯定在笑我呢。他人呢？啊？他人不在，规矩倒全摆这儿了。' },
]
export function HomePreview({ onStory, onChat }: Props) {
  const [shot, setShot] = React.useState(1)
  return <div className="hp" id="top">
    <header className="hp-nav">
      <a className="hp-back" href="/">当前游戏</a>
      <a className="hp-brand" href="#top" aria-label="ABQ Roleplay Lab 首页">abq<span>ROLEPLAY LAB</span></a>
      <nav aria-label="首页导航"><a href="#characters">角色</a><a href="#how">玩法</a></nav>
    </header>
    <main>
      <section className="hp-cover" aria-labelledby="hp-title">
        <div className="hp-cover-inner">
          <img className="hp-cover-art" src={portrait('jesse')} alt="杰西·平克曼的插画肖像，窗外透入阳光" fetchPriority="high" />
          <div className="hp-cover-type"><p className="hp-cover-kicker">AI CHARACTER ROLEPLAY</p><h1 id="hp-title"><span>BREAKING</span><span>BAD</span></h1><p className="hp-cover-chinese">绝命毒师 · 角色扮演</p></div>
          <span className="hp-cover-credit">JESSE PINKMAN</span>
        </div>
      </section>
      <div className="hp-game-mark" aria-label="ABQ Roleplay Lab">
        <img src={portrait('walter')} alt="" />
        <span>ABQ Roleplay Lab</span>
      </div>
      <div className="hp-entry"><button className="hp-primary" onClick={onStory}>开始故事</button><a className="hp-secondary" href="#characters">与角色聊天</a><p>支持中文与英文 · 可先以游客体验</p></div>
      <section className="hp-introduction" id="how" aria-labelledby="hp-intro-title">
        <p className="hp-eyebrow">ABOUT THE GAME</p><h2 id="hp-intro-title">角色对话与互动剧情</h2>
        <p>选择《绝命毒师》中的角色进行单聊，<br className="hp-wide-break" />或扮演角色，通过对话和行动推进故事。</p>
        <p>单聊中，你可以选择与角色的关系，再自由交谈。<br className="hp-wide-break" />剧情中，你可以跟随行动提示，也可以输入自己的决定。</p>
        <a href="#gameplay" className="hp-text-link">查看剧情片段</a>
      </section>
      <section className="hp-gameplay" id="gameplay" aria-labelledby="hp-gameplay-title">
        <div className="hp-section-heading"><p className="hp-eyebrow">IN THE GAME</p><h2 id="hp-gameplay-title">剧情片段</h2></div>
        <div className="hp-screen" aria-label="真实剧情片段演示">
          <div className="hp-screen-art"><img src={portrait('jesse')} alt="剧情中的杰西" loading="lazy" /><span>JESSE PINKMAN</span></div>
          <div className="hp-screen-content">
            <div className="hp-screen-meta"><span>房车内部</span><span>实际生成片段</span></div><h3>杰西·平克曼</h3>
            <div className="hp-excerpt" aria-live="polite"><span>{sample[shot].kind}</span><p>{sample[shot].text}</p></div>
            <div className="hp-replay"><p>回放样例，不是实时对话</p><div role="group" aria-label="切换剧情片段"><button aria-pressed={shot === 0} onClick={() => setShot(0)}>内心</button><button aria-pressed={shot === 1} onClick={() => setShot(1)}>台词</button></div></div>
          </div>
        </div>
        <p className="hp-caption">剧情会呈现角色的动作、内心与台词，并在需要决定时等待你的输入。</p>
      </section>
      <section className="hp-characters" id="characters" aria-labelledby="hp-cast-title">
        <div className="hp-section-heading"><p className="hp-eyebrow">THE CHARACTERS</p><h2 id="hp-cast-title">选择角色，开始对话</h2></div>
        <div className="hp-cast-grid">{cast.map(c => <button className="hp-character" key={c.id} onClick={() => onChat(c.id)} aria-label={`和${c.name}聊天`}>
          <div className={`hp-portrait hp-portrait-${c.id}`}><img src={portrait(c.id)} alt="" loading="lazy" /></div>
          <div className="hp-cast-info"><span className="hp-cast-en">{c.english}</span><h3>{c.name}</h3><p>{c.description}</p><span className="hp-chat-link">与角色聊天</span></div>
        </button>)}</div>
      </section>
      <section className="hp-play"><h2>想参与剧情？</h2><p>先选择行动，再选择你扮演的角色。</p><button className="hp-primary" onClick={onStory}>开始故事</button></section>
    </main>
    <footer className="hp-footer"><span>ABQ ROLEPLAY LAB</span><span>《绝命毒师》同人互动体验</span><a href="#top">回到顶部</a></footer>
  </div>
}
