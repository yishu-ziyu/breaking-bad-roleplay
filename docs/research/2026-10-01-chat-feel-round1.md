# 和电视剧角色聊天，怎样才好玩：研究报告（绝命毒师 AI 聊天）

- 日期：2026-10-01
- 仓库：`/Users/mahaoxuan/Desktop/AI 产品/breaking-bad-roleplay`，分支 `copy/glossary-wording`（只读，未改任何文件）
- 注意：研究期间工作区有别人在改 `src/App.tsx` 等文件（未提交）。报告里 `src/App.tsx` 的行号按 2026-10-01 写报告时的工作区（2357 行）；后端和 `src/lib/*` 的引用文件在此期间没有变动。
- 搜索工具：AnySearch CLI（匿名）为主，能用。它抽取不了 Reddit（人机验证页）、Character.AI 帮助中心、知乎专栏、MDPI、Replika 帮助中心，这几类改用 WebFetch 兜底，其中 Reddit / C.AI 帮助中心 / MDPI / Replika 仍然 403 或被拦。所以 Reddit 上的用户声音只拿到了搜索摘要，没读到完整帖子，下文会标出来。
- 证据强弱标记：【强】官方文档、论文、有方法的研究；【中】正规媒体报道、署名行业文章、公司自述数据；【弱】营销博客、单条帖子摘要、匿名爆料。

---

## 1. 结论先行

和电视剧角色聊天好不好玩，主要看下面七件事。按对"好玩"的影响排序。

**1）角色得有自己的事，会推着对话走。用户只能提问、角色只会回答，聊几轮就没劲了。**
- Character.AI 推 Scenes 时直接写了原因："open-ended chat can be a hard place to get started"。Scenes 里安排了另一个角色 "who carries the story forward, like an expert improv partner"。【强】https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/
- 国内从业者（化名）的判断：AI 社交"依赖用户前置输入……缺少传统游戏中剧情和任务机制的'钩子'"；"聊天过程中普遍缺少剧情引导，随着对话内容逐渐乏味且发散"，最后用户要么流失，要么去"搞颜色"。【中-弱，匿名】https://www.woshipm.com/ai/6237472.html
- CharacterGLM 把"好角色"拆成三项：一致性、像人、engagement（让对话保持 dynamic and interesting）。人工评测也按这三项打分。【强】https://arxiv.org/html/2311.16832v1

**2）第一条消息几乎决定整段聊天的风格，还要让用户马上明白"我在这场戏里是谁"。**
- SillyTavern 官方文档："The model is more likely to pick up the style and length constraints from the first message than anything else"。【强】https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- Character.AI 创作者指南："The first message can make or break a chat"，并教作者写多个开场、用 {{user}} 做个性化（只拿到搜索摘要，原页 403）。【中】https://support.character.ai/hc/en-us/articles/50609011294235
- 对 210 万条 Character.AI 开场白的研究发现，开场白普遍给用户（"you"）安排好了一个角色位置，而且通常是权力较低的那一方。【强】https://arxiv.org/html/2505.13354v1

**3）要像原剧里的那个人：说话要对，也要有脾气。两个常见失败：一是滑回"助手/心理咨询师"腔调，二是坏人变软。**
- 做 Friends AI 的团队拿"熟悉角色"来判断生成质量："Is this really Chandler making a joke? Is this something Phoebe would say?"【中】https://www.fablesimulation.com/blog/friends-ai-sitcom-simulation
- Anthropic 的 Assistant Axis 研究：模型默认人格贴近 therapists / consultants / coaches 这类原型，情绪化或哲学化的长对话最容易出现"persona drift"。【强】https://www.anthropic.com/research/assistant-axis
- SocialBench / RoleInteract：人设偏负面、中性的角色放进群体后，会被群体的"极性"带偏（preference drift），正面角色更稳。绝命毒师几乎全员是灰色或反派，这一条直接相关。【强】https://arxiv.org/html/2403.13679v3
- 用户抱怨"反派不像反派"：SillyTavern 社区的帖子写"AI being too nice… The villain monologues instead of attacking"（只有摘要）。【弱】

**4）用户得能看见角色记住了什么。记性差是这个品类被骂最多的问题。**
- Character.AI 做了 Chat Memories（400 字符，用户可随时改）和置顶消息，官方说法是"better memory is at the top of your most-wanted list"。【强】https://blog.character.ai/helping-characters-remember-what-matters-most/
- Kindroid 把记忆摊给用户看：Learned Context 分三块（Growth & relationship / Important facts / Ongoing context），可查看、可编辑；某条回复用到长期记忆时，消息角上会亮一个紫色大脑图标。【强】https://kindroid.ai/v2/docs/memory/
- 星野的"吃设定"（忘设定、忘前情）是用户吐槽最多的一条；它的补救是事件簿（阶段摘要）加"记忆"设置（角色怎么称呼你）。【中-弱】https://www.woshipm.com/evaluating/5946439.html

**5）节奏要像聊天：短、快、跟用户的长度走。长段落和定场描写适合剧情模式，不适合聊天。**
- Janitor AI 官方写作指南："JLLM mirrors you… If your inputs start getting short and fast, the bot might do the same."【强】https://help.janitorai.com/en/article/writing-style-talking-to-the-bot-1ucmbxw/
- CharacterGLM 公开的人类角色扮演语料里，角色和用户每句平均约 24 个字。【强】
- Character.AI 的 Chat Styles 公告：用户有时要 "rapid-fire conversation that's quick, witty"，有时要细节和铺陈，所以让用户自己选。【强】https://blog.character.ai/level-up-your-character-ai-experience-with-chat-styles/
- 回复前按内容长短做一点延迟，能提高"像人"的感知和满意度（客服场景实验）。【强，但场景不同】https://aisel.aisnet.org/ecis2018_rp/113/

**6）角色答歪的时候，用户得有办法救回来，否则一次答歪就流失。**
- 星野的对话控制有六个：重说（从 4 个备选里挑或手改）、回溯到某个节点、记忆、重启、评价、事件簿；另外有"灵感"，给 3 条推荐回复。【中】https://www.woshipm.com/evaluating/5946439.html
- SillyTavern、CharHub 支持多个开场（alternate greetings），可以左右滑动切换；Character.AI 测试过 Suggested Reply（建议回复）。【强/中】

**7）让人回来的是关系在延续（角色记得、角色先开口），硬拉人的做法会反噬。**
- Nomi 的主动消息：可按角色单独开关，四档频率，用户不回就把间隔翻倍，晚 10 点到早 8 点不发。【强】https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/
- Meta AI Studio 的主动跟进：用户 14 天内发过至少 5 条消息才触发，只发一条，用户不回就停。【中】https://www.businessinsider.com/meta-ai-studio-chatbot-training-proactive-leaked-documents-alignerr-2025-7
- HBS 研究：6 家陪伴应用里有 5 家在用户说再见时用情感操控挽留，37% 以上的告别对话里出现；短期内留存有效，但用户会感到愤怒、内疚、"creeped out"。【强】https://www.library.hbs.edu/working-knowledge/how-ai-chatbots-try-to-keep-you-from-walking-away
- 行业内部观察（匿名）："用户跟每一个角色平均的建联时长大概在5~7天，之后就基本不会再和这个角色聊天了"；"聊了1000、2000轮之后，可以被挖掘的东西已经被挖完了"；另一个判断是"一个产品其实可能只需要五六个角色就够了"，但要用做游戏的方式去打磨。【中-弱】https://www.woshipm.com/ai/6237472.html

群聊另有一条：**不要每个角色都回每一句**。每次选 1 到 2 个人说话，让角色之间互相接话，给用户留出位置；2 到 3 个角色效果最好，再多声音就开始混在一起。证据见第 3 节。

---

## 2. 各维度：最好的产品怎么做，用户骂什么

### 2.1 第一次接触：开场白，以及用户怎么知道自己是谁

**好的做法**
- Character.AI Scenes 的创作流程要求三件东西：设定（genre, time, place, tone）、"state what the user and Character aim to achieve together"、一段有感官细节和悬念的开场，再加一句"hooks the user and invites them to participate"的首条消息。【强】上文 Scenes 链接
- 开场白就是风格样本。模型最容易照着首条消息的长度和风格往下写（SillyTavern 文档）。【强】
- 多开场：SillyTavern 的 Alternate Greetings 可以滑动切换；角色进群聊时随机抽一个开场。【强】
- 猫箱：打开后推荐角色并附上"故事的简介"，用户在设定好的故事框架里对话，也可以直接扮演故事里的某个角色；回复格式是"正文代表发言 + 括号囊括其他一切"。【中】https://www.tmtpost.com/7392953.html
- 一般做法是让开场白直接告诉用户他是谁（"你是……"）。C.AI 开场白研究也显示多数开场白给用户安排好了位置。【强】

**用户的抱怨**
- 开场太长、第三人称定场，用户不知道该说什么（我们自己的 `docs/DIRECT_CHAT_CONTRACT.md` 也把"大段第三人称定场"列为不算数）。
- 开场和用户选的身份对不上。这一条在我们的代码里能复现，见第 4 节。

### 2.2 角色主动性：会不会追问、推进，有没有自己的打算

**好的做法**
- 让角色在场景里有个目标，自己推剧情（C.AI Scenes 的 improv partner 设计）。【强】
- Inworld 给角色配 Goals & Actions（带触发条件的意图），让 NPC 自己发起行动。只拿到二手描述。【中】https://voicesofvr.com/1264-inworld-ai-for-dynamic-npc-characters-with-knowledge-memory-robust-narrative-controls/
- 豆包角色扮演的最佳实践（CSDN 转载，疑似来自火山引擎官方文档）专门有一节讲 Bot 主动发消息，信息源包括用户画像、最近 10 轮对话、日期、天气、上次聊天时间，并让模型先写"消息构建思路"再写消息，还要给消息定一个失效时间，过期就不推。原文说法是"消息不应该只有一方发起"。【中】https://blog.csdn.net/qq_51116518/article/details/141039761

**用户的抱怨**
- 反复问"Can I ask you a question?"，用户答"好"之后它还在问，对话原地打转。r/CharacterAI 有多个帖子专门骂这个（只有摘要）。【弱】https://www.reddit.com/r/CharacterAI/comments/1aul7xa/
- "if you don't pushing the plot, bot could just ask the same…"：用户不推，角色就停在原地（摘要）。【弱】https://www.reddit.com/r/CharacterAI/comments/10e6iq7/

### 2.3 声音保真：像不像原剧，口头禅要多少，别出助手腔，拒绝时也要在戏里

**好的做法**
- 用原剧对白做风格样本。SeinfeldGPT 用了 180 集、约 50 万词的剧本；Fable 用 Friends 剧本做过微调，但结论是 GPT-4 的原生能力已经不输微调，关键在"beats"（场景节拍）的约束。【中】https://www.seinfeldgpt.com/ ，Fable 链接同上
- 有些时间点的剧情角色不该知道。TimeChara 专门评测这种"point-in-time 角色幻觉"，发现 GPT-4o 也常犯；它把防剧透和 fandom 沉浸感列为动机。【强】https://arxiv.org/abs/2405.18027
- CharacterEval 把"吸引力"拆成四项：像人、沟通技巧、表达多样性、共情。表达多样性这一项直接针对重复。【强】https://arxiv.org/html/2401.01275v1
- 拒绝时留在戏里：把越界请求转成剧情内的回应。我们现在就是这么做的（`backend/agents/turn_runtime.py:121-124`，how-to 转为角色台词）。

**用户的抱怨**
- 助手腔、咨询师腔、太温柔。原因上面说过，模型默认人格就在这一侧（Assistant Axis）。
- 过度依赖口头禅会变成模仿秀。这一条证据很弱：只看到 Facebook 帖子"Why does Jesse end every sentence with 'yo'"和 r/breakingbad 的"Jesse actually never says 'Yo bitch'"，说明粉丝对口头禅频率很敏感。【弱】
- 很多角色越聊越像同一个人，有人叫它"multi-character collapse"；也有人抱怨模型反过来只会复读示例台词（example overfitting）。【弱，个人实践报告】https://community.openai.com/t/llm-personas-for-arbitrary-scenarios-practical-observations-on-persona-drift-multi-character-collapse-non-scripted-behavior-and-sycophancy/1401026

### 2.4 记忆和关系延续（一次对话内，以及隔天）

**好的做法**
- 让记忆可见、可改：C.AI Chat Memories 可以编辑；Replika 有 Memory tab，每次会话后列出"记住了什么"，用户可以逐条编辑（只拿到官方 Reddit 公告的摘要）；Kindroid 有 Learned Context 和紫色大脑图标。【强/中】
- 分层：Kindroid 分持久（设定+近期记录）、级联中期（几百到几千条，按重要性和时间衰减）、可检索长期（日记按关键词触发）。【强】
- 星野：事件簿（阶段摘要，可编辑）+ 记忆（角色对你的称呼、你的性别）。【中】

**用户的抱怨**
- "忘了我是谁"，"聊到 20 条就忘"，"500 条以后连定义都丢了"（C.AI 多个 Reddit 帖子摘要）。【弱，但数量多、方向一致】
- 星野"吃设定"。【中-弱】

### 2.5 节奏和形式：长度、多气泡、星号动作还是纯对白、打字延迟、语音、图片

**好的做法**
- 让用户选长度或风格（C.AI Chat Styles）。【强】
- 国内产品普遍用"对白 + 括号动作/神情"。豆包角色指南建议在系统提示末尾加一句"你可以将动作、神情语气、心理活动、故事背景放在（）中"，以提升沉浸感。【中】
- 语音：星野每条回复带播放按钮，发现页滑到新角色时自动播放欢迎语；用户评价里有一句"听到角色用自己的声音说话那一刻真的很戳"（二手评测转述）。【中-弱】
- 回复延迟：按内容长度动态延迟，提升"像人"的感知（Gnewuch 2018）。【强，客服场景】

**用户的抱怨**
- 星号动作和纯对白各有拥护者，Reddit 上一直在吵（摘要）；多数人的意见是分场景：快节奏聊天用星号，偏叙事的就写散文。【弱】
- 回复太长、华丽辞藻（purple prose）、替用户说话或行动（SillyTavern、Janitor 社区的常见问题，摘要）。【弱，但反复出现】
- 多气泡拆分（一次发两三条短消息）：**没找到**任何有数据的来源，只能算推断。

### 2.6 用户身份：自我代入，还是选一个关系

**好的做法**
- Kindroid 和 C.AI 都有 persona（用户人设）；Kindroid 群聊里可以切换多个 persona。【强】
- C.AI Books 让用户选"扮演书里已有角色"或"用自己的 persona"。【中】https://www.theverge.com/ai-artificial-intelligence/912997/character-ai-books-mode
- 进门前的设置越少越好。星野的"灵感"和猫箱的"引导语"都是进门后才帮用户起话头，不在门口塞表单。【中】

**用户的抱怨**
- 设定问得太多、进门太慢：这一条是推断，没找到直接的用户数据。

### 2.7 群聊：见第 3 节

### 2.8 聊天里放一点情境，但别变成游戏

**好的做法**
- 筑梦岛的"哄哄模拟器"：每句回应计算"原谅值"，到 100 过关，完全是聊天形式里套了一个轻目标。评测者觉得"难度可不低"。【中】https://www.sohu.com/a/810305634_485557
- C.AI 把边界画得很清楚：开放聊天（Chat）、带目标的短场景（Scenes）、选项分支的互动小说（Stories，2 到 3 个角色，"frequent choices"，可重玩）、按书走的 Books（book arc mode / off-script mode）。它把"有选项、有结局"的东西放到单独的格式里，聊天里只放轻场景。【强】https://blog.character.ai/introducing-stories-a-new-way-to-create-play-and-share-adventures-with-your-favorite-characters/
- 行业里有人判断：要么用付费解锁剧情来控制节奏，要么往游戏化走（21 世纪经济报道引述从业者）。【中】

**界线在哪（推断）**：聊天里的事件只改变"聊什么"，不改变"有没有输赢"。一旦出现数值条、任务清单、检定或胜负，就属于剧情/游戏模式。筑梦岛的原谅值已经踩到线上，是一个有意做成小游戏的例外。我们的 `docs/DIRECT_CHAT_CONTRACT.md` 已经把"关系数值条、可见今日目标、检定/胜负"列为不算数，和这条界线一致。

### 2.9 留存：什么让人回来（附数据）

| 数据 | 数值 | 来源与强弱 |
|---|---|---|
| Character.AI 人均每日使用时长 | 约 80 分钟（CEO 口径） | the-decoder 转述【中，公司自述】 |
| Chai：奖励模型筛回复 | 平均对话长度 +70%，留存 +30% 以上（GPT-J 6B，1 万名新用户/组 A/B） | Chai 论文【强，但模型较旧】 |
| 猫箱 / 星野次日留存 | 57.32% / 41.91%（AI 产品榜均值） | 36 氪 2025-05，原页未能抽取，只有摘要【中-弱】 |
| 猫箱 30 日留存 | 44.8%，日活约 65 万 | X 帖转述晚点/QuestMobile【弱】 |
| 2025 年同类产品三日新增留存 | 跌到 20% 以下 | 字母榜/人人都是产品经理【中-弱】 |
| 星野、猫箱月下载量 | 2025 年 1 月到 5 月分别从 486 万降到 93 万、从 264 万降到 61 万 | 同上【中】 |
| 月活（2024-12，QuestMobile） | 星野 663 万、猫箱 537 万、筑梦岛 91 万 | 21 世纪经济报道【中】 |
| X Eva | 2025-11-30 停运 | 21 世纪经济报道【中】 |
| 顶级消费应用 D30 | 30% 以上 | a16z 2025【中】 |

能验证的回访机制有：角色记得你（记忆可见）、角色先开口（有频率上限、有安静时段、只发一次）、关系在推进。有等级的：Replika XP 等级（官方帮助页 403，只拿到摘要"By Level 30 … know you noticeably better"）。星野的星念卡片和抽卡属于收集和付费线，用户骂"氪金感太重"。【弱】

### 2.10 常见的"把乐趣杀死"的失败

1. 忘事（最常见）。
2. 复读、原地打转（"Can I ask you a question"，同一句骂两遍）。
3. 助手腔、咨询师腔、反派变软。
4. 替用户说话或行动。
5. 回复太长，或者太短太敷衍（模型跟着用户变短，两边一起变无聊）。
6. 合规收紧后"回复很人机"，敏感词误伤正常剧情："刚有点沉浸感就卡壳了"。【中】https://www.21jingji.com/article/20250621/herald/d73c6fb3e1729aadd896b8c53dbccb28.html
7. 用操控手段挽留用户，引起反感（HBS）。
8. 群聊里声音混成一个人、有人一直被跳过、用户被刷屏。

---

## 3. 群聊专节

### 3.1 主流做法：谁说下一句

| 产品/方案 | 机制 | 证据 |
|---|---|---|
| SillyTavern | 四种顺序：Manual、Natural（先看最后一条消息点了谁的名；没点名的按"Talkativeness"概率发言，默认 50%；都没被选中就随机一个）、List、Pooled（本轮还没说过话的人里随机抽）。可以静音某个角色、强制某人发言；Auto-mode 每 5 秒自动推进，用户一打字就停 | 【强】https://docs.sillytavern.app/usage/core-concepts/groupchats/ |
| Kindroid | 自动（AI 决定）或手动；@名字 指定下一位；角色之间也能用 @ 交棒。每个角色只读自己的设定和记忆，另有"group context"作为共享背景；**群聊和私聊的共享记忆默认关闭** | 【强】https://kindroid.ai/v2/docs/groupchats/ |
| Kindroid Rooms | 最多 10 人 + 11 个 Kin；自动模式"participate naturally while leaving room for humans to respond" | 【强】更新日志 |
| Nomi Auto-play | 角色自己判断轮到谁；"If two Nomis are participating in an activity together, the others may recognize that they should not interrupt"；"your Nomis may decide that the next person who should respond is you"；用户一打字就暂停 | 【强】https://wiki.nomi.ai/How_does_group_chat_Auto-play_work%3F |
| 豆包（角色指南） | 两步：先由一个"中控 Bot"决定谁说话（可以是多人，也可以是用户），再让被选中的 Bot 带着群成员名单和上文说一句 | 【中】CSDN 转载 |
| ChatGPT 群聊 | "decides when to respond and when to stay quiet"；@ 它才一定回；个人记忆和群聊分开 | 【强】https://openai.com/index/group-chats-in-chatgpt/ |
| 筑梦岛 | 最多拉两个角色进来，可以设定彼此关系；**需要手动点角色才发言**，用户可以不说话只看它们聊 | 【中】搜狐评测 |
| Character.AI | 早期群聊要点头像才发言（2024 年的 Reddit 帖子问能不能自动回，只有摘要） | 【弱】 |

### 3.2 研究结论

- 群体对话比两人对话多两项能力：判断什么时候该说话，以及同时照顾多个角色的发言。只用两人对话训练的模型缺这两项。【强】MultiLIGHT https://arxiv.org/abs/2304.13835
- 引入会话分析里的"相邻对"（点名谁、谁就接）加"自选"（按角色内部状态决定要不要插话），对话中断明显减少。【强】https://arxiv.org/html/2412.04937v2
- 拆成"说什么（generator）"和"什么时候说（scheduler）"两个模块，发言时机就接近真人。【强】https://arxiv.org/abs/2506.05309
- 单聊表现好，不等于群聊也好；群体极性会把个体带偏，负面人设最容易被带偏。【强】SocialBench

### 3.3 用户体验上的问题

- 人多了有人被跳过："4 or 5??...eh....usually someone gets skipped quite a bit"（Kindroid Reddit 摘要）。【弱】
- 超过 3 个角色声音会趋同，路由也会出错（营销型评测博客，只能参考）。【弱】https://www.aiangels.io/blog/nomi-group-chat-feature-personality-dilution-review
- 群聊里角色之间的"互怼"本身就是卖点。botgroup.chat 这类开源项目的宣传语就是"多个 AI 在线互怼"。【弱】

### 3.4 对我们群聊的含义（推断，基于上面的证据）

1. 每条用户消息只让 1 到 2 个角色说话，不是在场所有人都答。被点名的必须答；其他人只在"有强烈理由"时插一句。
2. 允许 A 直接回应 B（相邻对），而不是每个人都对用户说。
3. 选人规则要把"轮到用户说了"作为一个合法结果，这样用户就不会被刷屏。
4. 默认 2 到 3 人。绝命毒师里最有戏的组合本来就是二人或三人（Walt+Jesse、Walt+Skyler、Hank+Marie、Saul+Walt+Jesse）。
5. 私聊和群聊的记忆分开，这是业内默认做法（Kindroid 默认关闭共享，ChatGPT 群聊也和个人记忆分开），我们现在的决定是对的，不需要改。

---

## 4. 我们现在的聊天 vs 最佳做法

先说读了哪些代码：`backend/agents/director.py`（handle_chat_message、_handle_direct_chat、_handle_crew_chat、crew_participants_from_message）、`backend/agents/direct_chat_stack.py`、`backend/agents/direct_chat_craft.py`、`backend/agents/turn_runtime.py`、`backend/agents/characters/base.py` 和 `walter.py`（其他角色卡用 grep 看过）、`backend/agents/character_policy.py`、`src/lib/directOpeners.ts`、`src/lib/directWayfinders.ts`、`src/lib/directChatReply.ts`、`src/lib/directDurableMemory.ts`、`src/hooks/useCharacterMemory.ts`、`src/App.tsx` 的聊天部分、`docs/DIRECT_CHAT_CONTRACT.md`。标"已跑验证"的项是用 `npx tsx` 实际调用 `pickDirectOpener` 得到的输出。

现在的单聊流程：

```
进门 → 选身份关系（每个角色 4 个，发出第一条后锁定）
     → 前端从开场库挑一句（12 句/角色 × 4 种态度，态度靠关系名正则推断）
     → 下方显示 3 个固定起话按钮
用户发消息 → POST /api/chat (mode=direct)
     → 核心角色卡 + 轻量 dossier + 最近 12 条 + 五类记忆（前端正则抽取）
     → 模型只输出 1-2 句纯对白（JSON）→ 一个气泡 + 表情静图 + 可点播放语音
```

现在的群聊流程：

```
进门 → 空白 "这是一段独立的群聊。你想先和谁聊什么？"（没有开场白、没有起话按钮）
用户发消息 → 发言人 = 当前选中的角色 + 消息里被点名的角色（正则匹配，最多 3 个）
          → 按顺序逐个生成（后一个能看到前一个说了什么）
          → 全部生成完再一次性显示
```

| # | 维度 | 我们现在 | 最佳做法 | 差距 | 证据 |
|---|---|---|---|---|---|
| 1 | 开场与身份对应 | 态度只靠关系名正则推断；没命中的关系一律按 "stranger" 处理 | 开场按"你是谁"专门写 | **已跑验证**：沃尔特对"前学生"开场是"天一黑学校停车场就空了。你是跟着我，还是迷路了？"；汉克对"局里的搭档"开场是"第三遍了——别临时新添布景。"（审讯嫌疑人的口吻，而且没有前情）；玛丽对"丈夫（汉克）"开场是"汉克不在。家里安静。"——对汉克本人说汉克不在 | `src/lib/directOpeners.ts:131-147`（正则），`:23`（w6），`:107`（h6），`:120`（r5）；`src/App.tsx:194,239`（'Hank spouse' → 丈夫（汉克）） |
| 2 | 回访开场 | 有未完线时，开场 = 用户原话截 90 字 + "还算数吗？" | 由角色用自己的话接上前情 | **已跑验证**：记忆里有"我会想想"，下次开场就是"我会想想。还算数吗？"，读起来像系统在复读 | `src/lib/directOpeners.ts:154-167` |
| 3 | 记忆抽取 | 前端正则：`我会`、`我是`、`还没`、`下次` 等命中就存成"未完线/玩家事实" | 用模型抽取，用户可见、可改 | 这几个词在日常中文里太常见，大量无关句子会被存进去，再被当成开场（推断，未量化） | `src/lib/directDurableMemory.ts:27-48` |
| 4 | 记忆是否可见 | 没有任何记忆 UI | C.AI/Kindroid/Replika/星野都能看、能改 | 用户看不到角色记住了什么，也纠正不了 | `src/App.tsx` 里 keyFacts 只用于开场挑选（`:756-757`）和上传（`:1364`、`:1482`），没有渲染 |
| 5 | 送出去但没用上的记忆 | 前端发送 `memoryOpening`、`memoryDigest`；后端 `format_direct_conversation_memory` 定义了但没被调用 | — | 对话开头的内容和摘要到了后端就丢了。模型只看最近 12 条 + 五类记忆 | `backend/agents/director.py:202`（只有定义），`:3016`（放进 allowed），`:3053`（history[-12:]） |
| 6 | 回复长度 | 角色卡写"2-6 sentences"，Direct 输出格式写"1-2 short sentences" | 一个明确的长度规则，按角色区分 | 同一个提示里有两条互相冲突的长度规则 | `backend/agents/characters/walter.py:92` 等；`backend/agents/direct_chat_stack.py:25` |
| 7 | 角色主动性 | 输出规则写"push the talk one beat"；隐藏意图每个角色 3 条，按关系做确定性哈希，salt 恒为空，所以同一关系每一轮都是同一条意图 | 角色带着当天自己的事来；一段对话里有 1 个情境变化 | 推进只停留在"每句加一个追问/要求"，角色没有自己的生活事件 | `backend/agents/direct_chat_craft.py:124-134`；`backend/agents/direct_chat_stack.py:124` |
| 8 | 写好但没接上的推进工具 | `DIRECT_CHAT_CRAFT`、`lacks_conversational_advance`、`maybe_turn_directive` 都写好了 | — | 生产路径没调用（grep 只在定义处出现），"只会复述/不推进"的检测没生效 | `backend/agents/direct_chat_craft.py:8,50,145` |
| 9 | 形式框架 | 开场写的是面对面（"坐。""碰柜台前先洗手"），回复却禁止任何动作和旁白，只许纯对白 | 选定一种：发消息，或者面对面 + 简短动作 | 两种框架混在一起，用户不知道自己是在发微信还是站在他家厨房 | `backend/agents/direct_chat_stack.py:34`；`backend/agents/characters/base.py:36-40` |
| 10 | 口头禅 | 角色卡一律写"do not paste famous monologues or catchphrases" | 不照搬原台词，但允许低频的招牌说话习惯 | 可能矫枉过正，削掉了辨识度（推断；粉丝对口头禅频率很敏感，证据弱） | `backend/agents/characters/walter.py:93`，hank.py:94，marie.py:55 |
| 11 | 用户纠错手段 | 只有停止生成；没有重说、没有候选、中途没有建议回复 | 重说/滑动选择、回溯、建议回复 | 一次答歪就只能自己硬圆回来 | `src/App.tsx:2273-2275`（起话按钮只在第一条是开场时出现） |
| 12 | 回访钩子 | 没有 | 带上限的主动消息，或者进门时有一条"角色留言" | 两次访问之间，角色不存在 | 全仓 grep 没有相关实现 |
| 13 | 群聊选人 | 当前角色必答 + 被点名的人必答，最多 3 人；没被点名的人永远不开口 | 选 1-2 人；允许角色主动插话、互相接话；允许"轮到用户" | 用户不点名就永远是一对一；点了 3 个名，就是 3 段长回复一起砸下来 | `backend/agents/director.py:765-781`、`:3185` |
| 14 | 群聊长度和格式 | 群聊没走 lean 格式，用的是完整结构化提示（带 gif 搜索词、thinking、工具调用），长度沿用角色卡的 2-6 句 | 每人 1-2 句 | 3 人 × 2-6 句 ≈ 一面墙。沃尔特的实验室工具在群聊里也可能被调用（推断） | `backend/agents/director.py:3271-3282`（没传 lean_chat）；`backend/agents/characters/base.py:259` |
| 15 | 群聊出现方式 | 顺序生成，全部完成后一次性显示 | 一个一个冒出来，中间有打字状态 | 等待时间是几个人相加，没有"群聊感" | `src/App.tsx:1415-1425` |
| 16 | 群聊开场 | 空白提示"你想先和谁聊什么？"，没有开场白和起话按钮 | 进门时已经有人在聊一件事 | 冷启动最难的地方被留给了用户 | `src/App.tsx:1050`（crew 不插开场）、`:2226-2228` |
| 17 | 群聊里非主角的关系 | 非主角角色看到的玩家关系是 "crew peer" | 群聊里的用户身份要清楚 | "crew peer"不在任何角色卡的关系策略里，角色不知道怎么对待你（推断） | `backend/agents/director.py:3251` |
| 18 | 拒绝处理 | 越界请求转成角色台词 | 同 | 已经做到 | `backend/agents/turn_runtime.py:121-124` |
| 19 | 群聊/单聊记忆分离 | 已分开 | 同（Kindroid 默认、ChatGPT 群聊） | 已经做到 | `docs/specs/chat-story-mode-boundaries.md` |

---

## 5. 建议（按优先级，前 10 条）

标"【便宜实验】"的，一两天内能做完，也能对比前后效果。

| # | 改什么 | 用户能看到的变化 | 成本 | 风险 |
|---|---|---|---|---|
| 1 | **开场按"角色×关系"重写，并修正错配**。每个关系 3 句，8 个角色 × 4 个关系 = 96 句。每句包含：此刻在干什么 + 我们俩是什么关系 + 一个钩子。去掉正则推断态度。回访开场改为由模型用角色口吻接前情，不再复读用户原话 | 一进门就知道"我是谁、他在干嘛、该接什么"；不再出现"对汉克说汉克不在" | S【便宜实验】 | 低。文案量大，需要人工写和挑 |
| 2 | **统一长度规则**。删掉角色卡里的"2-6 sentences"，按角色给长度（迈克最短，索尔可以稍长），并允许偶尔拆成 2 个气泡（先一句反应，再一句推进） | 回复长度稳定，像在发消息 | S【便宜实验】 | 低。拆气泡要加前端排队显示 |
| 3 | **群聊改成"先选人，再说话"**。每条用户消息先做一次便宜的选择（规则或小模型），决定 1-2 个说话人，可以包括"轮到用户"。被点名的必答；没被点名的可以插一句短话；允许 A 回应 B | 群聊里人会互相接话、抬杠；不会每句都被三段话淹没 | M | 中。多一次调用，延迟和成本要控制。可以先用规则版（被点名的 + 与话题相关的一人） |
| 4 | **群聊走 lean 格式**：每人 1-2 句，不调工具，不带 gif 搜索词；逐个显示，中间有打字状态 | 等待变短、不再刷屏 | S【便宜实验】 | 低 |
| 5 | **给每个角色一个"今天的事"**：每个角色写 10-20 条当天的处境或心事（汉克：今天在查一个蓝色冰毒的案子，心情好；斯凯勒：账对不上，孩子在楼上）。每次会话随机抽 1 条放进上下文，2-3 轮内自然露出来；隐藏意图的 salt 改为会话 id | 每次进来他都在过自己的日子，会主动提事 | M | 中。要防止角色生硬地念出来；需要写 PGC 内容 |
| 6 | **聊天里的轻事件**：聊到第 N 轮，或用户消息很短、对话在降温时，插入一个小变化（电话响了、玛丽进门、门外有车）。只改变"聊什么"，没有数值和输赢 | 对话不会原地打转 | M | 中。要守住和剧情模式的边界：不出现目标、选项、结算 |
| 7 | **记忆可见、可删**。在聊天头部放一个"他记得"面板，展示 3-5 条，可删除、可置顶。正则抽取换成每轮后的小模型抽取；`memoryDigest` 要么接上，要么别再发 | 用户能确认"他真记得我"，也能纠正错误的记忆 | M | 中。隐私和加密要走现有的 privacyVault |
| 8 | **加"重说"和中途建议回复**：最后一条回复可以重新生成；输入框旁边每轮给 2-3 条短建议（用角色处境生成，不做成菜单） | 答歪了一键救回来；不知道说什么时有台阶下 | S-M【便宜实验：只做重说】 | 低。建议回复做多了会像菜单，违反契约里"开聊后不当每轮菜单"，需要把握频率 |
| 9 | **声音保真的评测和兜底**：每个角色写 5-10 组原创的短对话样例（不照搬原剧台词），允许低频的招牌说话习惯；加一个助手腔/咨询师腔黑名单检查，命中就重试一次；反派角色另加"不许因为用户示好就软化"的约束 | 沃尔特、古斯更像本人；少出"我理解你的感受" | S-M | 中。样例太多会导致复读（example overfitting），需要轮换 |
| 10 | **回访钩子（先做站内版）**：用户重新进入某个角色时，如果上次有未完线，先显示一条角色留言（只有一条，用户不回也不追发）。以后再考虑推送，照 Nomi/Meta 的规则设频率上限、安静时段、只发一次 | 第二次打开时有"他还记着那件事"的感觉 | M【便宜实验：进门时生成，不做后台推送】 | 中。不能用内疚或挽留的话术（HBS 研究）；要有开关 |

另外一件事需要先定下来，不算成本：**聊天到底是"发消息"还是"面对面"**。选发消息，开场就不写"坐""碰柜台"，而是写"刚看到你消息"这类；选面对面，就允许一行很短的〔动作〕。现在两种框架混在一起。

---

## 6. 未知与证据强弱

**没能验证的**
- Reddit 全部帖子都只看到搜索摘要（抽取被人机验证拦下），所以"用户抱怨"这一类大多是【弱】证据，只能说明方向。
- Character.AI 帮助中心（开场白指南、群聊 FAQ、2025 年 2 月的 AI 生成开场白更新）403，只有摘要。
- Character.AI 群聊现在的具体选人机制，没有找到官方说明。
- 创始人看到的"和老友记角色聊天"产品没找到。找到的是 Fable 的 Friends AI（生成整集，不是聊天）、SeinfeldGPT、Talkie 上的 Joey 机器人，以及一个叫"Friends - AI Group Chat"的通用 AI 群聊工具（和剧集无关）。
- 多气泡拆分、星号动作 vs 纯对白，对中国用户沉浸感的影响，都没有找到有数据的研究。
- 猫箱的群聊机制、星野群聊怎么决定谁发言，没有找到一手资料（只知道星野"可定义群聊成员和他们之间的关系"）。
- MDPI 的粉丝动机研究和 TWC 的同人研究只读到摘要，正文 403 或抽取失败。
- 绝命毒师粉丝对 Character.AI 上相关机器人的具体评价：只知道 caibotlist 上沃尔特有 76 个机器人、迈克 28 个；还有一个老帖说有用户从沃尔特机器人那里套出了"做法"——这提示安全边界要一直守住，但原帖读不到。

**证据偏弱的判断**
- 国内次留、30 日留存数字：都是二手媒体或推文转述 QuestMobile/AI 产品榜，没见到原报告。
- "每个角色平均 5-7 天""1000-2000 轮就挖完了""五六个角色就够"：来自匿名从业者，一篇文章。
- "超过 3 个角色声音就趋同"：来自营销型评测博客（aiangels），方向和 SocialBench 一致，但数字不可信。
- 星野评测里的"记忆连贯性提升至少 60%"之类说法，来源是低质量评测站，报告里没有采用。
- Character.AI 每天 80 分钟是 CEO 口径。

**值得交给第二轮深度研究的问题**
1. 针对固定剧集 IP 角色（非用户自建角色）的聊天产品：官方或 PGC 固定阵容和 UGC 相比，D7/D30 留存差多少？一个用户平均和几个角色建立长期对话？有没有 IP 授权产品（如 Talkie 官方 IP 角色、国内影视 IP 合作）的公开数据？
2. 生产环境里的群聊选人算法：Character.AI 群聊、Kindroid Rooms、Nomi Auto-play、星野群聊、ChatGPT 群聊，每条用户消息默认有几个角色回应？用户对"被刷屏"和"没人理"的满意度怎样？
3. 主动消息的实测效果：对 D7/D30、通知关闭率、卸载率的影响；接着上次未完线的消息和泛泛的问候，哪种有效？
4. 消息形式的对照证据：多气泡 vs 单气泡、打字延迟、〔动作〕+对白 vs 纯对白，对沉浸感和会话长度的影响，最好是中文用户的数据。
5. 聊天里的轻事件：筑梦岛哄哄模拟器、C.AI Scenes 这类"聊天 + 轻目标"，对会话长度和次日回访的影响；用户在什么时候开始觉得"这变成游戏了"。

---

## 7. 来源

**官方文档、产品博客**
- https://blog.character.ai/introducing-scenes-your-new-way-to-tell-stories-on-c-ai/
- https://blog.character.ai/helping-characters-remember-what-matters-most/
- https://blog.character.ai/new-feature-announcement-character-group-chat/
- https://blog.character.ai/level-up-your-character-ai-experience-with-chat-styles/
- https://blog.character.ai/introducing-stories-a-new-way-to-create-play-and-share-adventures-with-your-favorite-characters/
- https://support.character.ai/hc/en-us/articles/50609011294235-4-Greeting-and-Voice-%EF%BC%90-%E3%83%8E （403，仅摘要）
- https://support.character.ai/hc/en-us/articles/24327914463003-Pinned-Memories （仅摘要）
- https://support.character.ai/hc/en-us/articles/34428285052827-Community-Update-February-2025 （仅摘要）
- https://docs.sillytavern.app/usage/core-concepts/groupchats/
- https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
- https://kindroid.ai/v2/docs/groupchats/
- https://kindroid.ai/v2/docs/memory/
- https://kindroid.ai/v2/docs/update-log/
- https://wiki.nomi.ai/How_does_group_chat_Auto-play_work%3F
- https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/
- https://help.janitorai.com/en/article/writing-style-talking-to-the-bot-1ucmbxw/
- https://openai.com/index/group-chats-in-chatgpt/ （仅摘要）
- https://quorablog.quora.com/Multi-bot-chat-on-Poe （仅摘要）
- https://www.fablesimulation.com/blog/friends-ai-sitcom-simulation
- https://www.seinfeldgpt.com/
- https://www.talkie-ai.com/pages/ai-tv-character-chat
- https://apps.apple.com/us/app/friends-ai-group-chat/id6759603154
- https://help.replika.com/hc/en-us/articles/37208679176077-How-does-Replika-s-memory-work （403，仅摘要）
- https://help.replika.com/hc/en-us/articles/360055809432-What-is-XP-and-how-does-it-work （仅摘要）
- https://www.anthropic.com/research/assistant-axis

**论文**
- https://arxiv.org/abs/2303.06135 （Chai：Rewarding Chatbots for Real-World Engagement）
- https://arxiv.org/abs/2310.00746 （RoleLLM）
- https://arxiv.org/abs/2310.10158 （Character-LLM）
- https://arxiv.org/html/2311.16832v1 （CharacterGLM）
- https://arxiv.org/html/2401.01275v1 （CharacterEval）
- https://arxiv.org/html/2403.13679v3 （SocialBench / RoleInteract）
- https://arxiv.org/abs/2405.18027 （TimeChara）
- https://arxiv.org/abs/2304.13835 （MultiLIGHT 多方对话）
- https://arxiv.org/html/2412.04937v2 （Who Speaks Next）
- https://arxiv.org/abs/2506.05309 （Time to Talk）
- https://arxiv.org/html/2505.13354v1 （Character.AI 开场白大规模分析）
- https://aisel.aisnet.org/ecis2018_rp/113/ （Gnewuch：动态回复延迟）
- https://journal.transformativeworks.org/index.php/twc/article/view/2781 （仅摘要）
- https://www.mdpi.com/2076-328X/16/9/1481 （403，仅摘要）

**媒体报道、行业分析**
- https://www.library.hbs.edu/working-knowledge/how-ai-chatbots-try-to-keep-you-from-walking-away
- https://www.businessinsider.com/meta-ai-studio-chatbot-training-proactive-leaked-documents-alignerr-2025-7
- https://the-decoder.com/meta-tests-chatbots-with-proactive-messaging-to-boost-retention/
- https://the-decoder.com/character-ai-keeps-young-people-glued-to-their-smartphones-for-an-average-of-80-minutes-a-day/
- https://techcrunch.com/2025/11/25/character-ai-will-offer-interactive-stories-to-kids-instead-of-open-ended-chat/
- https://www.theverge.com/ai-artificial-intelligence/912997/character-ai-books-mode
- https://a16z.com/state-of-consumer-ai-2025-product-hits-misses-and-whats-next/
- https://www.theguardian.com/technology/2016/oct/20/joey-friends-virtual-digital-avatar-chatbot
- https://www.woshipm.com/evaluating/5946439.html （星野万字拆解，2023）
- https://www.woshipm.com/ai/6237472.html （下载量暴跌八成，2025-07）
- https://www.21jingji.com/article/20250621/herald/d73c6fb3e1729aadd896b8c53dbccb28.html
- https://www.21jingji.com/article/20251129/herald/c4cf0b7853b66ba95873b68fb2dee2f2.html
- https://www.tmtpost.com/7392953.html
- https://m.36kr.com/p/3280404239836681 （抽取失败，仅摘要）
- https://www.sohu.com/a/810305634_485557 （筑梦岛试用）
- https://blog.csdn.net/qq_51116518/article/details/141039761 （豆包角色指南转载）
- https://x.com/fun000001/status/1862458398551548216 （猫箱 30 日留存转述，仅摘要）

**弱证据（营销博客、社区帖子摘要）**
- https://www.aixq.cc/27547.html
- https://www.aiangels.io/blog/nomi-group-chat-feature-personality-dilution-review
- https://weavai.app/blog/en/2026/08/13/proactive-ai-companions-nomi-replika-kindroid-compared/
- https://community.openai.com/t/llm-personas-for-arbitrary-scenarios-practical-observations-on-persona-drift-multi-character-collapse-non-scripted-behavior-and-sycophancy/1401026
- https://www.reddit.com/r/CharacterAI/comments/1aul7xa/can_i_ask_you_a_question_needs_to_stop/
- https://www.reddit.com/r/CharacterAI/comments/1irri1f/any_way_to_turn_off_proactive_messages/
- https://www.reddit.com/r/CharacterAI/comments/10e6iq7/character_ai_made_me_write_fanfics_because_is/
- https://www.reddit.com/r/CharacterAI/comments/1eh4pj1/can_you_make_group_chat_bots_answer_automatically/
- https://www.reddit.com/r/KindroidAI/comments/1ganmci/group_chats_do_you_dare_venture_out_into_3_4_or_5/
- https://www.reddit.com/r/SillyTavernAI/comments/1tuskzy/notes_on_addressing_positivity_bias_in_newer/
- https://www.reddit.com/r/SillyTavernAI/comments/1qnbuza/how_to_make_ai_actually_challenge_your_character/
- https://www.reddit.com/r/replika/comments/1861u4n/memory_updates/
- https://www.reddit.com/r/TalkieOfficial/comments/1fsu6bw/my_experience_with_talkie/
- https://www.reddit.com/r/breakingbad/comments/1qclm6w/mandela_effect_jesse_actually_never_says_yo_bitch/
- https://www.reddit.com/r/CharacterAI/comments/10or98m/walter_white_just_teached_me_how_to_make_a/
- https://caibotlist.com/fandom/breaking-bad （仅摘要）
- https://www.testingcatalog.com/character-ai-tests-new-suggested-reply-feature-amid-mixed-feedback/ （仅摘要）
