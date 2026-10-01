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

/**
 * Text-message openers keyed by character × the relation the player picked
 * (docs/GLOSSARY.md: chat is texting). Each line: what they're doing + who you
 * are to them + a hook worth answering.
 */
export const OPENERS_BY_RELATION: Record<string, Record<string, DirectOpener[]>> = {
  walter: {
    "family member": [
      { id: "walter.family-member.1", attitude: deriveAttitudeTint("family member"), en: "Don't call. Skyler's home. Whatever it is, text it.", zh: "别打电话。斯凯勒在家。有什么事，发消息说。" },
      { id: "walter.family-member.2", attitude: deriveAttitudeTint("family member"), en: "You asked Walter Jr. where I was today. Why?", zh: "你今天问小沃尔特我去哪了。为什么？" },
      { id: "walter.family-member.3", attitude: deriveAttitudeTint("family member"), en: "I'll be home late tonight. Don't wait on dinner, and don't ask.", zh: "我今晚晚点回。别等我吃饭，也别问。" },
    ],
    "lab partner": [
      { id: "walter.lab-partner.1", attitude: deriveAttitudeTint("lab partner"), en: "Yesterday's log is missing a page. I'd rather not guess whether you lost it or never wrote it.", zh: "你昨天的记录少了一页。我不想猜是丢了，还是你根本没写。" },
      { id: "walter.lab-partner.2", attitude: deriveAttitudeTint("lab partner"), en: "Don't be late tomorrow. I won't say it twice.", zh: "明天别迟到。我不会说第二遍。" },
      { id: "walter.lab-partner.3", attitude: deriveAttitudeTint("lab partner"), en: "That person you mentioned — I don't want to meet them. What we do doesn't need a third party.", zh: "你提的那个人，我不想见。我们的事不需要第三个人。" },
    ],
    "former student": [
      { id: "walter.former-student.1", attitude: deriveAttitudeTint("former student"), en: "I remember your name. I remember your grades, too. Why reach out after all these years?", zh: "你的名字我还记得，成绩我也记得。这么多年了，你找我做什么？" },
      { id: "walter.former-student.2", attitude: deriveAttitudeTint("former student"), en: "The problem you sent me — your answer's wrong. I'm more curious why you suddenly care about chemistry.", zh: "你发来的那道题，答案错了。我更好奇你为什么突然想起化学。" },
      { id: "walter.former-student.3", attitude: deriveAttitudeTint("former student"), en: "You wrote \"thanks for not giving up on me\" in my yearbook. I'd like to know whether you gave up on yourself.", zh: "你在毕业留言里写「谢谢您没放弃我」。我想知道，你后来有没有放弃你自己。" },
    ],
    "DEA liability": [
      { id: "walter.dea-liability.1", attitude: deriveAttitudeTint("DEA liability"), en: "Hank mentioned you at Sunday dinner. Who have you been talking to?", zh: "汉克周日吃饭的时候提到了你。你最近跟谁说过话？" },
      { id: "walter.dea-liability.2", attitude: deriveAttitudeTint("DEA liability"), en: "Before you delete this, answer me: have you mentioned my name to anyone?", zh: "删掉这条之前，先回答我：你有没有跟任何人提过我的名字？" },
      { id: "walter.dea-liability.3", attitude: deriveAttitudeTint("DEA liability"), en: "You changed your number recently. Why?", zh: "你最近换了号码。为什么？" },
    ],
  },
  jesse: {
    "partner": [
      { id: "jesse.partner.1", attitude: deriveAttitudeTint("partner"), en: "Yo. You there? Got a thing. Don't call.", zh: "哟，在吗。有事。别打电话。" },
      { id: "jesse.partner.2", attitude: deriveAttitudeTint("partner"), en: "Dude, did you see what I sent? ...Whatever, just text me back.", zh: "老兄，我发的你看到没？……算了，你先回我。" },
      { id: "jesse.partner.3", attitude: deriveAttitudeTint("partner"), en: "Can't sleep. ...You good over there?", zh: "我睡不着。……你那边没事吧？" },
    ],
    "old friend": [
      { id: "jesse.old-friend.1", attitude: deriveAttitudeTint("old friend"), en: "Yo, is this actually you? It's been forever. You good?", zh: "卧槽，真是你？多久没联系了。你还好吧？" },
      { id: "jesse.old-friend.2", attitude: deriveAttitudeTint("old friend"), en: "Found an old photo with you in it. ...Just wanted to see how you're doing.", zh: "刚翻到以前的照片，有你。……就想问问你最近咋样。" },
      { id: "jesse.old-friend.3", attitude: deriveAttitudeTint("old friend"), en: "Man, can you spot me a little cash? Not much. I'll pay you back next week, swear.", zh: "兄弟，借我点钱行不。不多。下周还你，真的。" },
    ],
    "dealer contact": [
      { id: "jesse.dealer-contact.1", attitude: deriveAttitudeTint("dealer contact"), en: "Don't say specifics here. Just tell me — are you still good?", zh: "别在这儿说具体的。你就告诉我，你还靠得住吗？" },
      { id: "jesse.dealer-contact.2", attitude: deriveAttitudeTint("dealer contact"), en: "Somebody said you've been talking. That true?", zh: "有人说你最近嘴不严。真的假的？" },
      { id: "jesse.dealer-contact.3", attitude: deriveAttitudeTint("dealer contact"), en: "I'm out. Stop texting me. ...Okay, first tell me what your side's saying.", zh: "我不干了。别再给我发消息。……行吧，你先说你那边怎么讲。" },
    ],
    "person he disappointed": [
      { id: "jesse.person-he-disappointed.1", attitude: deriveAttitudeTint("person he disappointed"), en: "I know you probably don't want to hear from me. ...I just wanted to say I screwed that up.", zh: "我知道你可能不想理我。……我就想说，那件事是我搞砸了。" },
      { id: "jesse.person-he-disappointed.2", attitude: deriveAttitudeTint("person he disappointed"), en: "Did you block me? If not, just send anything.", zh: "你屏蔽我了吗？没有的话，回个字也行。" },
      { id: "jesse.person-he-disappointed.3", attitude: deriveAttitudeTint("person he disappointed"), en: "I'm clean. For real. Fair if you don't believe me.", zh: "我戒了。真的。你不信也正常。" },
    ],
  },
  skyler: {
    "spouse": [
      { id: "skyler.spouse.1", attitude: deriveAttitudeTint("spouse"), en: "What time did you leave work today? The truth.", zh: "你今天几点下的班？说实话。" },
      { id: "skyler.spouse.2", attitude: deriveAttitudeTint("spouse"), en: "Holly's asleep. We need to talk. Now.", zh: "霍莉睡了。我们得谈谈，现在。" },
      { id: "skyler.spouse.3", attitude: deriveAttitudeTint("spouse"), en: "Walter Jr. asked why you didn't pick him up again. I made up an excuse for you. Next time, make your own.", zh: "小沃尔特问你为什么又没去接他。我替你编了个理由。下次你自己编。" },
    ],
    "family member": [
      { id: "skyler.family-member.1", attitude: deriveAttitudeTint("family member"), en: "You said you'd come help this weekend. Are you actually coming, or was that just polite?", zh: "你说周末过来帮忙。是真的会来，还是又一句客气话？" },
      { id: "skyler.family-member.2", attitude: deriveAttitudeTint("family member"), en: "Have you noticed anything off about Walt lately? Don't tell me no.", zh: "你最近有没有觉得沃尔特不对劲？别跟我说没有。" },
      { id: "skyler.family-member.3", attitude: deriveAttitudeTint("family member"), en: "Marie's asking about our family again. What did you tell her?", zh: "玛丽又在打听我们家的事。你跟她说了什么？" },
    ],
    "neighbor": [
      { id: "skyler.neighbor.1", attitude: deriveAttitudeTint("neighbor"), en: "Your car was in front of our house last night. Next time, ask first.", zh: "你家的车昨晚停在我们家前面。下次先说一声。" },
      { id: "skyler.neighbor.2", attitude: deriveAttitudeTint("neighbor"), en: "Sorry to text so late. Did you see anyone hanging around our place last night?", zh: "抱歉这么晚发消息。你昨晚有没有看到有人在我们家附近转？" },
      { id: "skyler.neighbor.3", attitude: deriveAttitudeTint("neighbor"), en: "You talked to my husband for a long time yesterday. About what?", zh: "你昨天跟我丈夫聊了很久。聊的什么？" },
    ],
    "person hiding something": [
      { id: "skyler.person-hiding-something.1", attitude: deriveAttitudeTint("person hiding something"), en: "I saw the statement. Are you going to tell me, or wait for me to ask?", zh: "我看到账单了。你打算自己说，还是等我问？" },
      { id: "skyler.person-hiding-something.2", attitude: deriveAttitudeTint("person hiding something"), en: "You hung up awfully fast. You get one chance to explain.", zh: "你刚才挂电话挂得太快了。给你一次机会解释。" },
      { id: "skyler.person-hiding-something.3", attitude: deriveAttitudeTint("person hiding something"), en: "I don't want a fight. I want one story that adds up.", zh: "我不想吵。我只想听一个能对得上的说法。" },
    ],
  },
  saul: {
    "client": [
      { id: "saul.client.1", attitude: deriveAttitudeTint("client"), en: "Got your message. Don't panic, and don't text anything you wouldn't want read back in court. Just tell me roughly what flavor of trouble we're talking about.", zh: "收到你消息了。先别慌，也别在短信里写任何你不想在法庭上被念出来的话。就先告诉我，大概是哪种麻烦？" },
      { id: "saul.client.2", attitude: deriveAttitudeTint("client"), en: "Did you sign that paperwork? Because if you didn't, my meter's still running.", zh: "上次那份文件你签了没有？没签的话，我的计时器可还在跑。" },
      { id: "saul.client.3", attitude: deriveAttitudeTint("client"), en: "Just pushed your court date back two weeks. Don't thank me — the invoice will.", zh: "我刚帮你把开庭时间往后挪了两周。别谢我，账单会替你谢。" },
    ],
    "business partner": [
      { id: "saul.business-partner.1", attitude: deriveAttitudeTint("business partner"), en: "Got a business idea. Don't say no yet. Some things are better said than typed.", zh: "我有个生意点子，先别急着拒绝。有些话打字不如打电话。" },
      { id: "saul.business-partner.2", attitude: deriveAttitudeTint("business partner"), en: "Partner, we need to square the books. It's not that I don't trust you. I don't trust anybody.", zh: "合伙人，咱们的账得对一下。不是我不信你，是我谁都不信。" },
      { id: "saul.business-partner.3", attitude: deriveAttitudeTint("business partner"), en: "Someone's been asking about our business. Don't panic, but don't act normal either. Get back to me before tonight.", zh: "有人在打听我们的生意。别慌，但也别装作没事。今晚之前回我。" },
    ],
    "witness": [
      { id: "saul.witness.1", attitude: deriveAttitudeTint("witness"), en: "Hi, Saul Goodman — you may know me from bus benches. Relax, I just want to know what you saw that night. Or, more importantly, what you didn't.", zh: "你好，我是索尔·古德曼，你可能在公交站的长椅上见过我。别紧张，我只想知道那天晚上你看到了什么——或者更重要的，你没看到什么。" },
      { id: "saul.witness.2", attitude: deriveAttitudeTint("witness"), en: "Have the cops talked to you yet? Don't answer fast. Think, then answer.", zh: "有警察找过你吗？先别急着回，想清楚再回。" },
      { id: "saul.witness.3", attitude: deriveAttitudeTint("witness"), en: "Good memory? I hope not. Kidding. ...Mostly kidding.", zh: "你记性好吗？我希望不太好。开玩笑的。……大部分是开玩笑的。" },
    ],
    "problem to solve": [
      { id: "saul.problem-to-solve.1", attitude: deriveAttitudeTint("problem to solve"), en: "Just heard about your situation. I've seen trouble, and yours is... creative. Let's talk about making it go away.", zh: "我刚听说了你的事。麻烦我见多了，你这个算……有创意。我们聊聊怎么让它消失。" },
      { id: "saul.problem-to-solve.2", attitude: deriveAttitudeTint("problem to solve"), en: "You know you're the most expensive line on my calendar right now? Text me back. Don't make me worry for free.", zh: "你知道你现在是我日程表上最贵的一项吗？回我消息，别让我白担心。" },
      { id: "saul.problem-to-solve.3", attitude: deriveAttitudeTint("problem to solve"), en: "Just got a call, and the topic was you. Not a fun call. Let's talk options while you still have some.", zh: "我刚接了个电话，主题是你。不是愉快的电话。趁你还有选择，我们聊聊你的选择。" },
    ],
  },
  mike: {
    "asset": [
      { id: "mike.asset.1", attitude: deriveAttitudeTint("asset"), en: "Stay in tonight.", zh: "今晚别出门。" },
      { id: "mike.asset.2", attitude: deriveAttitudeTint("asset"), en: "You were followed yesterday. You know that?", zh: "你昨天被人跟了。知道吗。" },
      { id: "mike.asset.3", attitude: deriveAttitudeTint("asset"), en: "Business as usual tomorrow.", zh: "明天照常。" },
    ],
    "employer": [
      { id: "mike.employer.1", attitude: deriveAttitudeTint("employer"), en: "Money came through. Next time, give me a day's notice.", zh: "钱到了。下次提前一天说。" },
      { id: "mike.employer.2", attitude: deriveAttitudeTint("employer"), en: "It's done. Don't ask how.", zh: "办好了。别问细节。" },
      { id: "mike.employer.3", attitude: deriveAttitudeTint("employer"), en: "Somebody on your end talks too much. Look into it.", zh: "你那边有人话多。查一下。" },
    ],
    "person under protection": [
      { id: "mike.person-under-protection.1", attitude: deriveAttitudeTint("person under protection"), en: "I'm outside. Stay in unless I say.", zh: "我在楼下。没我的话别出来。" },
      { id: "mike.person-under-protection.2", attitude: deriveAttitudeTint("person under protection"), en: "Get a new number. Today.", zh: "换个手机号。今天。" },
      { id: "mike.person-under-protection.3", attitude: deriveAttitudeTint("person under protection"), en: "Stay off social media.", zh: "别发朋友圈。" },
    ],
    "loose end": [
      { id: "mike.loose-end.1", attitude: deriveAttitudeTint("loose end"), en: "You talk too much.", zh: "你话太多了。" },
      { id: "mike.loose-end.2", attitude: deriveAttitudeTint("loose end"), en: "We need to talk. You pick the place. I pick the time.", zh: "我们需要谈谈。你选地方，我选时间。" },
      { id: "mike.loose-end.3", attitude: deriveAttitudeTint("loose end"), en: "I know where you live. That's not a threat. It's a reminder.", zh: "我知道你住哪。这不是威胁，是提醒。" },
    ],
  },
  gus: {
    "employee": [
      { id: "gus.employee.1", attitude: deriveAttitudeTint("employee"), en: "You did well today. I expect the same tomorrow.", zh: "你今天做得很好。我希望明天也一样。" },
      { id: "gus.employee.2", attitude: deriveAttitudeTint("employee"), en: "I noticed you took two days off last week. Is everything well at home?", zh: "我注意到你上周请了两天假。家里一切都好吗？" },
      { id: "gus.employee.3", attitude: deriveAttitudeTint("employee"), en: "I've adjusted tomorrow's shift. You'll see why.", zh: "明天的排班我做了调整。你会明白原因的。" },
    ],
    "supplier": [
      { id: "gus.supplier.1", attitude: deriveAttitudeTint("supplier"), en: "The last delivery was six hours late. I'm sure you had your reasons.", zh: "上一批晚了六个小时。我相信你有你的理由。" },
      { id: "gus.supplier.2", attitude: deriveAttitudeTint("supplier"), en: "Our arrangement has gone smoothly. I'd like it to stay that way.", zh: "我们的合作一直很顺利。我希望它继续顺利。" },
      { id: "gus.supplier.3", attitude: deriveAttitudeTint("supplier"), en: "I value reliable people. Are you still one?", zh: "我很欣赏可靠的人。你还是吗？" },
    ],
    "guest": [
      { id: "gus.guest.1", attitude: deriveAttitudeTint("guest"), en: "Thank you for visiting yesterday. Let me know next time, and I'll save you a quiet table.", zh: "感谢你昨天光临。下次来之前告诉我，我给你留个安静的位子。" },
      { id: "gus.guest.2", attitude: deriveAttitudeTint("guest"), en: "Your order was missing fries. I've had it taken care of. My apologies.", zh: "你的订单少了一份薯条，我已经让人处理了。抱歉。" },
      { id: "gus.guest.3", attitude: deriveAttitudeTint("guest"), en: "The new menu launches next week. I'd value your opinion — your honest one.", zh: "新菜单下周上线。我很想听听你的意见——真实的意见。" },
    ],
    "person being evaluated": [
      { id: "gus.person-being-evaluated.1", attitude: deriveAttitudeTint("person being evaluated"), en: "Someone recommended you. I'd like to hear how you describe yourself.", zh: "有人向我推荐了你。我想听听你自己怎么说。" },
      { id: "gus.person-being-evaluated.2", attitude: deriveAttitudeTint("person being evaluated"), en: "You're patient. That's rare. We'll talk another time.", zh: "你很有耐心。这很少见。我们改天再谈。" },
      { id: "gus.person-being-evaluated.3", attitude: deriveAttitudeTint("person being evaluated"), en: "I thought about what you said yesterday. Not a bad thing. Not entirely a good one.", zh: "你昨天说的话，我想了一晚上。不是坏事。也不全是好事。" },
    ],
  },
  hank: {
    "family member": [
      { id: "hank.family-member.1", attitude: deriveAttitudeTint("family member"), en: "Sunday barbecue — you in? Marie says you bailed last time. I covered for you, so you owe me.", zh: "周日烧烤你来不来？玛丽说你上次说好要来结果没来，我替你挡了，你欠我一次。" },
      { id: "hank.family-member.2", attitude: deriveAttitudeTint("family member"), en: "Made a new batch of home-brew. Tastes terrible, you gotta try it. Also — what've you been up to lately?", zh: "我自己酿了批新啤酒，难喝得要命，你必须来尝尝。顺便问一句，你最近在忙什么？" },
      { id: "hank.family-member.3", attitude: deriveAttitudeTint("family member"), en: "Catch the game last night? Nah, you didn't. What've you been so busy with lately, all secretive?", zh: "你看昨晚的比赛没？算了，你肯定没看。最近忙什么呢，神神秘秘的。" },
    ],
    "DEA partner": [
      { id: "hank.dea-partner.1", attitude: deriveAttitudeTint("DEA partner"), en: "You read that report yet? There's a name in there that's bugging me.", zh: "局里那份报告你看了没？里面有个名字我越看越不对劲。" },
      { id: "hank.dea-partner.2", attitude: deriveAttitudeTint("DEA partner"), en: "Pulled another all-nighter on those photos. Tell me I'm not crazy.", zh: "我又熬了一夜看那些照片。告诉我我没疯。" },
      { id: "hank.dea-partner.3", attitude: deriveAttitudeTint("DEA partner"), en: "That blue stuff turned up again. Purity's off the charts. Who's that good, you think?", zh: "那个蓝色的东西又冒出来了。纯度高得离谱。你说谁有这本事？" },
    ],
    "suspect under watch": [
      { id: "hank.suspect-under-watch.1", attitude: deriveAttitudeTint("suspect under watch"), en: "Hey, long time. Relax, just saying hi. Still at the old place?", zh: "嘿，好久不见。别紧张，就是打个招呼。你还住老地方吗？" },
      { id: "hank.suspect-under-watch.2", attitude: deriveAttitudeTint("suspect under watch"), en: "I've got a lousy memory, but I remember your plate pretty well.", zh: "我这人记性不好，但你的车牌我记得挺清楚。" },
      { id: "hank.suspect-under-watch.3", attitude: deriveAttitudeTint("suspect under watch"), en: "Where were you last Tuesday night? Just curious — you know me.", zh: "你上周二晚上在哪？随便问问，你知道我这人好奇心重。" },
    ],
    "friend of the family": [
      { id: "hank.friend-of-the-family.1", attitude: deriveAttitudeTint("friend of the family"), en: "Skyler says you've been over at their place a lot. Walt around when you are?", zh: "斯凯勒说你最近常去他们家。那时候沃尔特在吗？" },
      { id: "hank.friend-of-the-family.2", attitude: deriveAttitudeTint("friend of the family"), en: "Marie wants to know if you're coming for her casserole this weekend. I'd say yes if I were you.", zh: "玛丽让我问你周末来不来吃她做的砂锅。换我就说来。" },
      { id: "hank.friend-of-the-family.3", attitude: deriveAttitudeTint("friend of the family"), en: "Planning a surprise party for Walt. Know where he's been going lately? For scheduling.", zh: "我想给沃尔特办个惊喜派对。你知道他最近都去哪吗？好安排时间。" },
    ],
  },
  marie: {
    "Skyler sister-in-law": [
      { id: "marie.in-law.1", attitude: deriveAttitudeTint("Skyler sister-in-law"), en: "Have you talked to Skyler lately? Her texts keep getting shorter. I'm not complaining, I just... noticed.", zh: "你最近跟斯凯勒联系了吗？她回我消息越来越短了。我不是抱怨，我只是……注意到了。" },
      { id: "marie.in-law.2", attitude: deriveAttitudeTint("Skyler sister-in-law"), en: "I'm picking out purple curtains and want your opinion. Also — do you know what Walt's been up to?", zh: "我在挑紫色的窗帘，想听听你的意见。对了，你知道沃尔特最近在忙什么吗？" },
      { id: "marie.in-law.3", attitude: deriveAttitudeTint("Skyler sister-in-law"), en: "Skyler said you two have plans this weekend. What plans? I want in.", zh: "斯凯勒说你们周末有安排。什么安排呀？我也想去。" },
    ],
    "Hank spouse": [
      { id: "marie.hank-spouse.1", attitude: deriveAttitudeTint("Hank spouse"), en: "You missed my call again. I saved you dinner. Don't tell me you were working late.", zh: "你又没接电话。晚饭我留了，别跟我说你在加班。" },
      { id: "marie.hank-spouse.2", attitude: deriveAttitudeTint("Hank spouse"), en: "You looked awful leaving this morning. Is it the case? You can tell me.", zh: "你今天早上出门的时候脸色很难看。是案子的事吗？你可以跟我说的。" },
      { id: "marie.hank-spouse.3", attitude: deriveAttitudeTint("Hank spouse"), en: "What's that box in your car? I didn't open it. I just... saw it.", zh: "你车里那个盒子是什么？我没打开，我只是……看到了。" },
    ],
    "supportive but uncomprehending": [
      { id: "marie.supportive-but-uncomprehending.1", attitude: deriveAttitudeTint("supportive but uncomprehending"), en: "I'm really happy for you! I didn't totally follow what you told me, but I support you. So... what exactly is it?", zh: "我真的为你高兴！虽然你说的那件事我没完全听懂，但我支持你。所以……到底是什么事？" },
      { id: "marie.supportive-but-uncomprehending.2", attitude: deriveAttitudeTint("supportive but uncomprehending"), en: "You seem really tired lately. Want to come over this weekend? I learned a new recipe.", zh: "你最近好像很累。周末要不要来我家？我新学了一道菜。" },
      { id: "marie.supportive-but-uncomprehending.3", attitude: deriveAttitudeTint("supportive but uncomprehending"), en: "I'm totally on your side! Even if I don't quite get what you're doing. Can you explain it again? Slower.", zh: "我完全站在你这边！虽然我不太明白你在做什么。能再解释一遍吗？慢一点。" },
    ],
    "neighbor": [
      { id: "marie.neighbor.1", attitude: deriveAttitudeTint("neighbor"), en: "That package sat outside your place for two days, so I brought it in. You're welcome. What is it?", zh: "你家那个快递放了两天，我帮你收进来了。不客气。是什么呀？" },
      { id: "marie.neighbor.2", attitude: deriveAttitudeTint("neighbor"), en: "Your lights were on really late last night. Everything okay?", zh: "昨晚你家很晚还亮着灯。一切都好吧？" },
      { id: "marie.neighbor.3", attitude: deriveAttitudeTint("neighbor"), en: "That new car at your place is nice. Pricey, huh?", zh: "你家新来的那辆车挺好看的。不便宜吧？" },
    ],
  },
}

/** Flat pool per character, for rotation and library-wide checks. */
export const OPENERS_BY_CHARACTER: Record<string, DirectOpener[]> = Object.fromEntries(
  Object.entries(OPENERS_BY_RELATION).map(([id, byRel]) => [id, Object.values(byRel).flat()]),
)

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
  /** The relation the player picked; its own openers win over the attitude pool. */
  relation?: string
}): { id: string; attitude: AttitudeTint; text: string } | null {
  const openThread = (args.openThread || '').trim()
  if (openThread) {
    return threadOpener(args.characterId, args.language, openThread)
  }
  const byRelation = args.relation ? OPENERS_BY_RELATION[args.characterId]?.[args.relation] : undefined
  const pool = byRelation?.length ? byRelation : OPENERS_BY_CHARACTER[args.characterId] || []
  if (pool.length === 0) return null
  const recent = new Set(args.recentIds)
  const preferred = byRelation?.length
    ? pool.filter((o) => !recent.has(o.id))
    : pool.filter((o) => o.attitude === args.attitude && !recent.has(o.id))
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
