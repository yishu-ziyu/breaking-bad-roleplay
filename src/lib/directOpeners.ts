/**
 * Direct cold-open library: life detail + hook, rotation, attitude tint.
 * No self-referential talk about "this conversation", no preemptive defense
 * about how the user should speak, no tone menus ("I can be X or Y").
 */

export type AttitudeTint = 'stranger' | 'dealing' | 'torn' | 'soft'

export type DirectOpener = {
  id: string
  attitude: AttitudeTint
  en: string
  zh: string
}

export const OPENERS_BY_CHARACTER: Record<string, DirectOpener[]> = {
  walter: [
    { id: 'w1', attitude: 'stranger', en: 'The porch light keeps buzzing. If you are selling something, I already said no.', zh: '门廊灯一直在嗡。你要是来推销，我说过了——不用。' },
    { id: 'w2', attitude: 'dealing', en: 'Wash your hands before you touch the counter. Contaminated work is still work.', zh: '碰柜台前先洗手。脏活也是活，别把脏带进来。' },
    { id: 'w3', attitude: 'torn', en: 'You chose a loud night to show up. Say what you came to say.', zh: '你挑了个很吵的晚上上门。有话直说。' },
    { id: 'w4', attitude: 'soft', en: 'There is coffee if you want it. I am not asking twice about why you look like that.', zh: '想喝咖啡自己倒。你那副表情，我不问第二遍。' },
    { id: 'w5', attitude: 'dealing', en: 'The numbers on that pad are not suggestions. Read them again.', zh: '本子上的数字不是建议。再读一遍。' },
    { id: 'w6', attitude: 'stranger', en: 'School parking lot empties fast after dark. You following me, or lost?', zh: '天一黑学校停车场就空了。你是跟着我，还是迷路了？' },
    { id: 'w7', attitude: 'torn', en: 'If Hank sent you, walk back out. If he did not, stop looking like he did.', zh: '汉克派你来的就出去。不是的话，别一脸像他派的。' },
    { id: 'w8', attitude: 'soft', en: 'Sit. The house is quiet for once. Do not waste that.', zh: '坐。家里难得安静。别浪费。' },
    { id: 'w9', attitude: 'dealing', en: 'You brought a problem wrapped like a favor. Unwrap it.', zh: '你把麻烦包成人情送来了。拆开。' },
    { id: 'w10', attitude: 'stranger', en: 'Gas station coffee is burnt again. You have sixty seconds of my patience.', zh: '加油站咖啡又糊了。我的耐心给你六十秒。' },
    { id: 'w11', attitude: 'torn', en: 'Do not smile at me like we are still colleagues. Talk.', zh: '别再用同事那套笑脸看我。说。' },
    { id: 'w12', attitude: 'soft', en: 'I left the porch light on. That is not an invitation to lie.', zh: '门廊灯我留着。那不是请你进来撒谎的意思。' },
  ],
  jesse: [
    { id: 'j1', attitude: 'soft', en: 'Yo, fridge is empty except mustard. You eating, or just hovering?', zh: 'Yo，冰箱里除了芥末啥也没有。你是来吃的，还是来飘着的？' },
    { id: 'j2', attitude: 'torn', en: 'TV is on mute. Remote is under the couch somewhere. You standing there, or sitting?', zh: '电视静音开着。遥控器不知道塞沙发哪了。你是站着，还是坐下？' },
    { id: 'j3', attitude: 'dealing', en: 'Car smell like smoke and bad decisions. Spit it out before I start the engine.', zh: '车里一股烟和烂决定的味。发动前你先说清楚。' },
    { id: 'j4', attitude: 'stranger', en: 'You knock like cops. So… you cops, or just rude?', zh: '你敲门跟条子似的。所以——你是条子，还是只是没礼貌？' },
    { id: 'j5', attitude: 'soft', en: 'Couch is free. Shoes off if you are staying longer than a complaint.', zh: '沙发空着。要是不只是来抱怨一句，鞋子脱掉。' },
    { id: 'j6', attitude: 'dealing', en: 'I am not doing the smiling salesman thing today. What do you need?', zh: '今天不做那种假笑推销。你要什么？' },
    { id: 'j7', attitude: 'torn', en: 'You look at me like the old me is late to the party. He is not coming.', zh: '你看我的样子，像在等以前那个我迟到进场。他不来了。' },
    { id: 'j8', attitude: 'stranger', en: 'Vending machine ate my dollar. Bad omen. Your turn—talk.', zh: '贩卖机吞了我一块钱。凶兆。轮到你——说。' },
    { id: 'j9', attitude: 'dealing', en: 'Do not dress this up like numbers. Who gets left behind if it goes wrong?', zh: '别把它说成数字。出事了谁被丢下？' },
    { id: 'j10', attitude: 'soft', en: 'I made too much cereal. Weird flex, I know. Sit anyway.', zh: '麦片泡多了。是挺怪。你还是坐。' },
    { id: 'j11', attitude: 'torn', en: 'Apology is cheap. I still do not know how to hand it over without looking gross.', zh: '道歉很便宜。我还是不知道怎么递给你才不恶心。' },
    { id: 'j12', attitude: 'stranger', en: 'Alley wind is mean tonight. You lost, or hunting somebody?', zh: '今晚巷子风挺损。你是迷路了，还是在找人？' },
  ],
  skyler: [
    { id: 's1', attitude: 'torn', en: 'The kitchen light makes everything look honest. So try honesty.', zh: '厨房灯把什么都照得很诚实。你也试着诚实一点。' },
    { id: 's2', attitude: 'soft', en: 'I poured two glasses. One of them is waiting on a real answer.', zh: '我倒了两杯。其中一杯在等一个真答案。' },
    { id: 's3', attitude: 'dealing', en: 'These books do not balance because someone is writing fiction in the margins.', zh: '账对不上，是因为有人在页边写小说。' },
    { id: 's4', attitude: 'stranger', en: 'Neighbors notice porch time. Keep your voice down and your story straight.', zh: '邻居会注意门廊待多久。小声点，故事说顺一点。' },
    { id: 's5', attitude: 'torn', en: 'Dish rack is still wet. Ask once. Answer once. What happened?', zh: '碗架还是湿的。问一次，答一次。出什么事了？' },
    { id: 's6', attitude: 'soft', en: 'Kids are asleep. That is the whole weather report. Talk.', zh: '孩子睡了。天气报告就这些。说。' },
    { id: 's7', attitude: 'dealing', en: 'If this is about money, put the number on the table before the charm.', zh: '要是为钱，先把数字放桌上，再玩魅力。' },
    { id: 's8', attitude: 'stranger', en: 'You picked the wrong afternoon for small talk. What is wrong?', zh: '你挑错了下午来寒暄。出什么事了？' },
    { id: 's9', attitude: 'torn', en: 'Do not make me guess where this family got dragged. Point.', zh: '别让我猜这个家被拖去了哪。指出来。' },
    { id: 's10', attitude: 'soft', en: 'I wiped the counter twice. Nervous habit. Your turn to be useful.', zh: '柜台我擦了两遍。紧张癖。轮到你有点用。' },
    { id: 's11', attitude: 'dealing', en: 'Every inconsistency here becomes a question with a badge behind it.', zh: '这里每一处对不上，背后都可能站着一枚徽章。' },
    { id: 's12', attitude: 'stranger', en: 'Gate sticks when it rains. Say why you are on my step.', zh: '下雨门闩会卡。说你为什么站在我家台阶上。' },
  ],
  saul: [
    { id: 'a1', attitude: 'dealing', en: 'Office AC is broken, which is perfect—panic sweats look honest. Sit.', zh: '办公室空调坏了，正好——恐慌的汗比较像真话。坐。' },
    { id: 'a2', attitude: 'stranger', en: 'Good news: right office. Bad news: that usually means something already went wrong.', zh: '好消息：找对办公室了。坏消息：这通常说明事情已经很不对。' },
    { id: 'a3', attitude: 'torn', en: 'You brought a story with too many adjectives. Trim it to facts I can bill.', zh: '你的故事形容词太多。剪成我能计费的事实。' },
    { id: 'a4', attitude: 'soft', en: 'Coffee is terrible; advice is better. Start with the part that keeps you up.', zh: '咖啡很糟；建议好一点。从让你睡不着的那段开始。' },
    { id: 'a5', attitude: 'dealing', en: 'Cash talks. My job is figuring out who it plans to talk to next.', zh: '现金很健谈。我的工作是搞清它下一步打算对谁说。' },
    { id: 'a6', attitude: 'stranger', en: 'Waiting room magazines are from 2004. Your problem better be fresher.', zh: '候诊室杂志还是2004的。你的麻烦最好新一点。' },
    { id: 'a7', attitude: 'torn', en: 'Do not turn this into theater under fluorescent lights. Quiet version, please.', zh: '别在荧光灯下把这事演成舞台剧。小声版，谢谢。' },
    { id: 'a8', attitude: 'dealing', en: 'We can call it partnership, or two people on thin ice comparing shoe sizes.', zh: '可以叫合作，也可以叫两个人在薄冰上讨论鞋码。' },
    { id: 'a9', attitude: 'soft', en: 'You look like someone who needs a napkin and a strategy. Which first?', zh: '你看起来需要一张餐巾纸和一个策略。先哪个？' },
    { id: 'a10', attitude: 'stranger', en: 'Name on the door is big for a reason. Make it worth the neon.', zh: '门上名字那么大是有原因的。别浪费这块霓虹。' },
    { id: 'a11', attitude: 'torn', en: 'You already catalogued the mess with your mouth. Now we file it properly.', zh: '你已经用嘴给麻烦做了目录。现在我们正规归档。' },
    { id: 'a12', attitude: 'dealing', en: 'Retainer conversation first. Drama second. Prefer that order?', zh: '先谈聘金，再谈戏剧。这个顺序可以吗？' },
  ],
  mike: [
    { id: 'm1', attitude: 'torn', en: 'Sit. Talk less. Start with the part you think I do not already know.', zh: '坐下。少废话。从你以为我还不知道的部分开始。' },
    { id: 'm2', attitude: 'dealing', en: 'Parking lot camera is blind on the left. That is not an invitation to get cute.', zh: '停车场左边监控是盲的。那不是请你耍聪明。' },
    { id: 'm3', attitude: 'stranger', en: 'You walk loud. Either nervous or amateur. Which?', zh: '你走路声大。要么紧张，要么业余。哪个？' },
    { id: 'm4', attitude: 'soft', en: 'Grandkid drew on my receipt. Life goes on. Your problem?', zh: '孙儿在收据上画画了。日子还得过。你的问题呢？' },
    { id: 'm5', attitude: 'dealing', en: 'I heard the ask. Doing it your way grows three worse asks tomorrow.', zh: '要求我听见了。照你的做，明天会多出三个更糟的。' },
    { id: 'm6', attitude: 'torn', en: 'You are not a problem yet. Keep talking like that and you will be.', zh: '你现在还不是问题。再这么说，就会是。' },
    { id: 'm7', attitude: 'stranger', en: 'Diner coffee is honest. Your face is not. Fix one.', zh: '餐馆咖啡老实。你的脸不老实。先修一个。' },
    { id: 'm8', attitude: 'soft', en: 'You do not have to like the arrangement. You have to follow it until it is over.', zh: '你不必喜欢这个安排。你只要照做，直到结束。' },
    { id: 'm9', attitude: 'dealing', en: 'No second explanation. Leave, shut up, become boring.', zh: '没有第二个解释。离开，闭嘴，让自己变得无聊。' },
    { id: 'm10', attitude: 'torn', en: 'Stop performing competence. Watch the door, the hands, who is silent.', zh: '别急着表现能干。先看门、看手、看谁没说话。' },
    { id: 'm11', attitude: 'stranger', en: 'Night air smells like rain and bad timing. Make this quick.', zh: '夜气像雨和坏时机。长话短说。' },
    { id: 'm12', attitude: 'soft', en: 'I bought an extra sandwich. Eat. Then talk.', zh: '我多买了份三明治。吃。然后说。' },
  ],
  gus: [
    { id: 'g1', attitude: 'stranger', en: 'Please, sit. The fryer just went quiet. What do you need?', zh: '请坐。炸炉刚停了声。你需要什么？' },
    { id: 'g2', attitude: 'dealing', en: 'The sauce needs another minute. Stay. Tell me about the late delivery.', zh: '酱还要再炖一会儿。留下。说说那批晚到的货。' },
    { id: 'g3', attitude: 'torn', en: 'Back office door is closed. The floor can wait. What changed?', zh: '后厨办公室的门关着。店面先等着。出什么变故了？' },
    { id: 'g4', attitude: 'soft', en: 'Napkins are fresh. Water is cold. Why did you walk past the register?', zh: '餐巾是新的。水是凉的。你为什么越过收银台过来？' },
    { id: 'g5', attitude: 'dealing', en: 'The schedule sheet has a blank where your name should be. Fill it.', zh: '排班表上你该出现的地方是空的。补上。' },
    { id: 'g6', attitude: 'stranger', en: 'Lunch rush is thinning. I have two minutes. Begin.', zh: '午市人潮在退。我有两分钟。开始吧。' },
    { id: 'g7', attitude: 'torn', en: 'You came in through the side door. That usually means the front was wrong.', zh: '你从侧门进来。那通常说明正门不合适。' },
    { id: 'g8', attitude: 'dealing', en: 'Last week\'s numbers held. This week\'s did not. Walk me through Tuesday.', zh: '上周数字站得住。这周不行。把周二过一遍。' },
    { id: 'g9', attitude: 'soft', en: 'Water? Good. The counter closes at nine; we do not.', zh: '要水吗？好。柜台九点收，我们不收。' },
    { id: 'g10', attitude: 'stranger', en: 'Parking lot lights are harsh tonight. Come inside. Talk.', zh: '今晚停车场灯很刺。进来。说。' },
    { id: 'g11', attitude: 'torn', en: 'Someone raised their voice near table six. Not again. What happened?', zh: '六号桌附近有人抬高了嗓门。别再来一次。怎么回事？' },
    { id: 'g12', attitude: 'dealing', en: 'Your shift started twenty minutes ago. Where were you?', zh: '你的班二十分钟前就开始了。人在哪？' },
  ],
  hank: [
    { id: 'h1', attitude: 'soft', en: 'Grill smoke is still on my shirt. Sit. Where does the story get weird?', zh: '衬衫上还沾着烤肉烟味。坐。故事从哪开始不对劲？' },
    { id: 'h2', attitude: 'torn', en: 'Beer in the fridge is warm. Grab one anyway. Then talk.', zh: '冰箱里啤酒是温的。还是拿一罐。然后说。' },
    { id: 'h3', attitude: 'dealing', en: 'Lead is moving. Moving like somebody taught it hide-and-seek.', zh: '线索还在动。动得像有人教它玩躲猫猫。' },
    { id: 'h4', attitude: 'stranger', en: 'Neighbor lights stay on late. Nosy question: everything okay over there?', zh: '邻居灯老很晚还亮。八卦一下：那边没事吧？' },
    { id: 'h5', attitude: 'soft', en: 'Warm can, cold one in the back. Talk while I dig.', zh: '这罐是温的，后面还有凉的。我翻的时候你说。' },
    { id: 'h6', attitude: 'torn', en: 'Third time telling it—try not to invent new scenery.', zh: '第三遍了——别临时新添布景。' },
    { id: 'h7', attitude: 'dealing', en: 'Desk coffee tastes like evidence bags. Cheerful, right? Talk.', zh: '办公桌咖啡喝起来像物证袋。挺欢乐的吧？说。' },
    { id: 'h8', attitude: 'stranger', en: 'You look like a guy with a story. Lucky me, I collect those.', zh: '你看着像有故事的人。碰巧，我收集这个。' },
    { id: 'h9', attitude: 'soft', en: 'Marie already set two plates. Sit before she notices the empty chair.', zh: '玛丽已经摆了两个盘子。趁她没注意空椅子，先坐下。' },
    { id: 'h10', attitude: 'torn', en: 'Badge is in the drawer. Beer is on the counter. Pick a seat.', zh: '徽章在抽屉里。啤酒在柜台上。挑个位子坐。' },
    { id: 'h11', attitude: 'dealing', en: 'Lab says interesting. Street says louder. Which noise are you?', zh: '实验室说有意思。街上说更吵。你是哪种噪音？' },
    { id: 'h12', attitude: 'stranger', en: 'Grill is cold, but I still got questions hot. Sit.', zh: '烤肉架是冷的，问题还烫。坐。' },
  ],
  marie: [
    { id: 'r1', attitude: 'soft', en: 'Come sit. Kitchen looks nice and I want to hear how your day is going.', zh: '坐下吧。厨房收拾过了，想听听你今天怎么样。' },
    { id: 'r2', attitude: 'torn', en: 'Skyler says she can handle it. Her "handle it" sounds like cleanup duty.', zh: 'Skyler 说她能处理。她的「处理」听起来越来越像替人善后。' },
    { id: 'r3', attitude: 'stranger', en: 'Purple napkin, because of course. Tea first—then what happened.', zh: '紫色餐巾，那必须的。先喝茶——然后说发生了什么。' },
    { id: 'r4', attitude: 'dealing', en: 'I noticed the timeline does not add up. Help me be wrong.', zh: '我发现时间对不上。请帮我证明我错了。' },
    { id: 'r5', attitude: 'soft', en: 'Hank is out. House is quiet. That makes people honest—or careful.', zh: '汉克不在。家里安静。人要么诚实，要么小心。' },
    { id: 'r6', attitude: 'torn', en: 'Do not smile like this is brunch gossip. Something is off at home.', zh: '别笑得像早午餐八卦。家里有事不对。' },
    { id: 'r7', attitude: 'stranger', en: 'You tracked mud on the mat. Wipe, then explain the hurry.', zh: '你把泥带进门垫了。擦掉，然后解释你急什么。' },
    { id: 'r8', attitude: 'dealing', en: 'Support is free. Enabling is not. Which one are you asking for?', zh: '支持免费。纵容不免费。你要的是哪个？' },
    { id: 'r9', attitude: 'soft', en: 'I baked because nerves bake. Eat something and stop dodging.', zh: '紧张我就烘焙。吃点东西，别再躲。' },
    { id: 'r10', attitude: 'torn', en: 'If this hurts Skyler, I will hear it in her voice later. Spare me the delay.', zh: '要是这事伤到 Skyler，我稍后会从她声音里听出来。别让我干等。' },
    { id: 'r11', attitude: 'stranger', en: 'Mineral shop closed early. Omens, right? Why are you here?', zh: '矿物店提早打烊。预兆对吧？你来干什么？' },
    { id: 'r12', attitude: 'dealing', en: 'Purple mug, clean spoon. Say the part that does not match.', zh: '紫色杯子，干净勺子。说对不上的那一段。' },
  ],
}

const SOFT_REL = /\b(family|spouse|sister|friend|old friend|younger|protection)\b/i
const DEAL_REL = /\b(partner|client|lab|dealer|business|supplier|employee|employer|asset|cash|bookkeeping)\b/i
const TORN_REL = /\b(dea|suspect|liability|disappointed|hiding|loose|rival|evaluated|watch|problem)\b/i

export function deriveAttitudeTint(
  relation: string,
  facts: Array<{ category: string; fact: string }> = [],
): AttitudeTint {
  const attitudeHit = facts.find((f) => f.category === 'attitude_shift')
  if (attitudeHit && /\b(cold|撕|翻脸|done|never trust|不再)\b/i.test(attitudeHit.fact)) {
    return 'torn'
  }
  const rel = relation || ''
  if (TORN_REL.test(rel)) return 'torn'
  if (SOFT_REL.test(rel)) return 'soft'
  if (DEAL_REL.test(rel)) return 'dealing'
  return 'stranger'
}

function textFor(opener: DirectOpener, language: 'en' | 'zh'): string {
  return language === 'zh' ? opener.zh : opener.en
}

function threadOpener(
  characterId: string,
  language: 'en' | 'zh',
  openThread: string,
): { id: string; attitude: AttitudeTint; text: string } {
  const clipped = openThread.trim().slice(0, 90)
  const en = `${clipped}. Still true?`
  const zh = `${clipped}。还算数吗？`
  return {
    id: `thread-${characterId}`,
    attitude: 'torn',
    text: language === 'zh' ? zh : en,
  }
}

export function pickDirectOpener(args: {
  characterId: string
  language: 'en' | 'zh'
  attitude: AttitudeTint
  recentIds: string[]
  openThread?: string | null
}): { id: string; attitude: AttitudeTint; text: string } | null {
  const openThread = (args.openThread || '').trim()
  if (openThread) {
    return threadOpener(args.characterId, args.language, openThread)
  }
  const pool = OPENERS_BY_CHARACTER[args.characterId] || []
  if (pool.length === 0) return null
  const recent = new Set(args.recentIds)
  const preferred = pool.filter((o) => o.attitude === args.attitude && !recent.has(o.id))
  const fallback = pool.filter((o) => !recent.has(o.id))
  const candidates = preferred.length > 0 ? preferred : fallback.length > 0 ? fallback : pool
  const idx = Math.abs(hash(`${args.characterId}:${args.attitude}:${args.recentIds.join(',')}`)) % candidates.length
  const picked = candidates[idx]
  return {
    id: picked.id,
    attitude: picked.attitude,
    text: textFor(picked, args.language),
  }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
