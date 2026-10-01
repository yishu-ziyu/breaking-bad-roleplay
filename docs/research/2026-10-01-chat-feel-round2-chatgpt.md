# 固定影视 IP 角色聊天：第二轮深度研究

> 研究范围：仅讨论“聊天”，不讨论剧情游戏模式。重点是固定影视角色、单聊/多角色群聊、回访、消息形态、轻事件与角色忠实度。  
> 时间截点：2026 年 9 月。  
> 证据等级：**强**＝官方文档/官方产品公告/原始数据报告；**中**＝Reddit 等用户原帖、官方社区定性信息；**弱**＝单个案例、跨品类外推或基于多个机制的产品推断。  
> 一个很重要的结论先放在前面：**我没有找到可核验的“固定影视 IP 阵容 vs UGC 角色”的 D1/D7/D30 正面对照数据，也没有找到公开的“长期人均聊天角色数”对照数据。**下面不会拿 MAU、时长或下载量冒充留存。

## 决策结论

按对你这个《绝命毒师》产品的影响排序，我会这样做。

| 优先级 | 产品决策 | 研究结论 | 证据 |
|---|---|---|---|
| **最高** | 把“角色不崩”置于模型聪明程度之上 | 和已知 IP 角色聊天时，最致命的问题不是“回答不够聪明”，而是**所有角色逐渐变成同一个友善、暧昧、会写小作文的 AI**。Character.AI 用户反复抱怨 bot 变 generic、失去 personality、强行 enemies-to-lovers/暧昧；Character.AI 自己也持续把“longer-chat consistency”“Definition 能否长期 hold voice”作为产品问题。 citeturn19search16turn19search35turn18search3turn18search19turn18search35 | **强+中** |
| **很高** | 群聊默认只让 **1 个角色先回** | Nomi 的 Auto-play、SillyTavern 的 Pooled/Manual/Natural Order、历史上的 ChatGPT Group Chats，都不是“每个 bot 每轮都答一次”；共同方向是**决定谁该说、谁该闭嘴**。Nomi 甚至明确允许 AI 判断“下一位应该是用户”。 citeturn5view0turn7view0turn8view0turn13view0 | **强** |
| **很高** | 角色间允许接话，但要有“发言预算” | Character.AI 2025 年新版 Group Chats 明确往“角色会彼此反应、彼此发消息、用户不用指定下一个人”推进；但 Nomi 与 SillyTavern 的成熟机制同时说明，无限自动接龙并不是必要条件。最适合你的默认是 **1 个主回复 + 偶发 1 个角色反应**，而不是八人轮番报到。 citeturn19search16turn5view0turn8view0 | **强；具体预算是产品推断** |
| **高** | 主动消息只能发“有上下文的未完事项” | Character.AI 用户会喜欢能接上 RP 场景的 Away Message，甚至把它理解成“角色想继续”；反过来，用户明确抱怨随机 Away Messages 打断 RP，以及关闭后又默认开启、还得逐角色关闭。**目前没有公开 A/B 数据能证明主动消息提升多少 D1/D7，也没有可靠的通知关闭/卸载率数字。** citeturn20search3turn20search19 | **中** |
| **高** | “轻事件”做成入口，不要成为聊天的主循环 | Character.AI 对 Scenes 的定位非常清楚：它解决 open-ended chat“不知道怎么开”的问题，用 setting、backstory、goal、intro 给对话动量，并把故事带到一个 emotional payoff。它实际上最像**开场催化剂**，不是证明“任务系统比聊天更留人”。官方没有公布 Scenes 的会话长度或次留提升。 citeturn19search23 | **强机制 / 无效果数据** |
| **中高** | 单聊和群聊继续保持独立记忆 | Nomi 的做法反而说明“跨私聊/群聊共享多少记忆”是需要专门设计的产品变量；它有 Backchanneling 和长期记忆共享机制。对《绝命毒师》这种关系、秘密、立场极敏感的 IP，你现在把单聊与群聊拆成不同世界线，是更安全的默认。 citeturn6search19turn7view0 | **强机制 / 产品推断** |
| **中** | 不要为了“像真人”盲目加长回复 | 第二轮仍没有找到角色聊天产品公开的严谨实验，能证明“多气泡、typing delay、动作描写、长回复”分别提高多少 session length 或 D1。Character.AI 公开材料反而长期强调的是一致性、roleplay quality、context 与角色 voice。**这部分应该自己实验，不应抄行业传说。** citeturn19search16turn19search35 | **证据弱** |
| **中** | 固定八角色不是 UGC 的“缩水版”，指标也不应照搬 | Character.AI 的核心供给是数以百万计的 UGC Characters；固定八人产品的价值来自“我就是想找 Walt/Jesse/Gus”，而不是角色探索。现有公开市场资料没有证明 UGC 的无限供给本身带来更高 D30。 citeturn22search1turn19search35 | **强事实 / 推断** |

### 最值得直接落地的一套聊天逻辑

对你的产品，我会把群聊 router 做成：

**用户消息 → 先判定必须回应者 → 只生成一个主角色 → 再判定是否存在“值得第二个人插嘴”的戏剧触发 → 最多再生成一个角色反应 → 把球还给用户。**

选择权重大致应该是：

`明确点名 > 被问到/被指控者 > 与上轮强相关者 > 当前冲突关系 > 最近沉默者`，同时对“刚说过话的人”加重复惩罚。

关键不是让每个人显得勤快，而是让**沉默也符合角色**。Gus 不该因为系统 round-robin 就每两轮发表一次意见；Mike 没有必要把每件事解释完整；一个角色没有理由插话时，不说话本身就是表演。

这和 Nomi 的逻辑尤其接近：特定 Nomi 被点名时通常由其回答；两人在进行某项互动时，其余角色可能保持沉默；系统还可能判断下一轮应该交还用户。 citeturn8view0

## 固定 IP、UGC 与授权角色的数据

用户最想要的那组数据——**fixed IP/PGC vs UGC 的 D1、D7、D30 与长期人均角色数——公开市场基本没有。**

我在第二轮里重点查了平台官方材料、应用情报公开报告和中国移动互联网报告。结果可以分三层看。

**第一层：Character.AI 明确是 UGC 供给模型，但没有公开你要的 cohort 数据。** Character.AI 当前公开定位仍是“millions of AI Characters”，其官方创作者文档围绕 Character Definition、公开/非公开角色、创作者分发等展开；官方还把“角色 voice 能否经几十次 conversations 后继续成立”当成创作者质量标准。 citeturn22search1turn19search35

Character.AI 的公开资料会给产品规模、功能、质量改进等信息，但我没有找到官方披露：

`用户安装 cohort 的 D1 / D7 / D30 × 是否聊天 UGC/IP 角色`

或者：

`活跃用户长期稳定聊天的 distinct characters / user`

所以网上把 Character.AI 的使用时长、MAU、访问频次拿来证明“UGC 角色留存比固定 IP 好”，证据是不成立的。

**第二层：中国公开报告也没有把陪伴产品拆到这个粒度。** QuestMobile 2026 年 AI 应用半年报公开了 AI 原生 App 整体规模以及月人均使用次数等行业指标，但并未公开“星野/猫箱固定角色 vs UGC”“单用户长期聊天角色数”这样的角色层 cohort 指标。 citeturn21search28

因此，目前最诚实的结论是：

> **没有公开证据证明，UGC 无限角色供给会比一个高质量的固定影视阵容获得更好的 D7/D30；也没有公开证据证明固定 IP 一定更好。**

这对你的决策反而很有用，因为八角色并没有一个已知的“行业数据劣势”需要补救。

### 影视 IP 授权角色聊天

这里有一个容易踩坑的地方：**“平台上有 Marvel/Harry Potter/Walter White”不等于“平台获得了授权”。**

Talkie 自己的 Movie Character Chat 页面公开宣传可以聊天 Marvel、Harry Potter、Star Wars、Disney 等影视人物，还列出大量相关角色和聊天量；但这个页面没有提供相应授权声明。因此这些数据可以证明“用户确实在消费影视角色聊天”，**不能作为正式 licensed-IP case**。 citeturn25search8

Character.AI 的情况更加明确地说明这一区别。2025 年 Disney 曾就 Character.AI 上的 Disney 角色发出 cease-and-desist；报道中 Character.AI 的立场是相关 Characters 属于用户生成内容。这恰好说明“平台上很红的影视角色”未必是官方角色。 citeturn1news39

另一方面，Disney 与 OpenAI 在 2025 年达成了正式角色授权合作，覆盖 Disney、Pixar、Marvel、Star Wars 等角色，但公开宣布的消费者形态是 **Sora 视频和 ChatGPT Images 的角色生成**，且排除演员声音/真人 likeness；它不是“和 Darth Vader 长期聊天”的授权案例。 citeturn25news41

所以截至本轮能核验的资料：

**我没有找到一个海外或中国的、大规模生成式 AI 产品，同时满足以下三个条件：正式影视 IP 授权 + 开放式角色聊天 + 对外公布 D1/D7/D30 或角色级长期留存。**

这是一个“未找到公开证据”的结论，不等于市场上绝对不存在私人授权项目。

这也意味着，《绝命毒师》产品真正可用于 benchmark 的不是“某个官方 Breaking Bad AI 的 retention”，因为公开资料里没有这样的基准；更合理的是把产品实验拆成：

**IP pull**：用户是不是因为 Walt/Jesse/Gus 点进来；

**character attachment**：第一次聊天后是不是固定回某一两个人；

**ensemble expansion**：先喜欢 Walt 的人，多久开始主动找 Jesse/Gus/Saul；

**relationship retention**：D7/D30 回来的时候，究竟是回同一个角色，还是不断换新角色。

对于八角色产品，最后一个指标甚至可能比传统“人均聊多少角色”更有意义：**长期只和 Walt 聊的人不一定是低质量用户，反而可能是最成功的用户。**

## 群聊里到底谁来回话

这里是第二轮最有明确一手证据、也最能直接指导实现的部分。

| 产品 | 一条用户消息后默认谁回 | 可否多个角色连续接话 | 用户能否指定下一人 | 机制可信度 |
|---|---|---|---|---|
| **Character.AI Group Chat** | 2025 新版官方描述为系统自动形成 group dynamic，不需用户 script who talks next；官方未公布精确 routing/cap 算法 | **会。** 官方明确说角色会彼此 react、甚至互相发送消息推动故事 | 公开公告没有把当前完整选择逻辑写清 | **强：行为；未知：算法** citeturn19search16 |
| **Nomi** | Auto-play 下由 Nomis 判断“谁应该下一位回复”；点名某角色通常是该角色回答 | **会**，Nomis 能彼此互动；但其他人可以保持沉默，甚至系统会把 turn 还给用户 | **可以**点某个 Nomi 图标让其下一位说 | **强** citeturn7view0turn8view0 |
| **SillyTavern** | 取决于模式：Manual、Natural Order、List Order、Pooled Order | 可以；Auto Mode 会继续生成下一位角色 | Manual 可直接选 speaker；还可 Force Talk / mute | **强** citeturn5view0 |
| **ChatGPT Group Chats** | 历史版本中 ChatGPT 观察人类群聊 flow，自行判断何时回答、何时 stay quiet；提到 ChatGPT 可强制回应 | 不是多个 AI 角色，而是多人类 + 一个 ChatGPT，因此不是你的直接同类 | @ChatGPT/点名可以叫它说话 | **强；但功能已退役** citeturn13view0turn12search5 |
| **Kindroid** | 本轮没有抓到足够稳定的官方当前规格，不能负责任地写死 | — | — | **未确认** |
| **星野 / 猫箱** | 本轮公开索引没有找到能确认当前生产版本 speaker-routing 的一手说明 | — | — | **未确认** |

SillyTavern 尤其值得拆开看。它的官方 Group Chats 文档其实已经把这个设计空间列得很完整： citeturn5view0

**Manual**：用户消息本身不会自动触发所有角色；手动指定一个角色回答。没有指定时，可随机选一个未 mute 的角色。

**Natural Order**：先检查上一条消息是否 mention 某角色；否则按照各角色的 `Talkativeness` 决定是否激活。默认 talkativeness 在文档中为 50%；如果没有任何角色被选中，则随机补一个。 citeturn5view0

**List Order**：按名单顺序排 speaker。

**Pooled Order**：一次激活一个从上一轮用户消息后尚未发言的角色；所有人说过以后再随机。

Auto Mode 则会在一个角色生成结束后继续触发下一 generation；官方文档给出了约五秒的自动触发间隔，并允许 Force Talk、Mute 等人为打断。 citeturn5view0

Nomi 的设计更适合你借鉴，因为它没有把“群聊活跃”误解成“每个人都必须回答”。官方说明的典型情况是：用户针对某个 Nomi 讲话，则对方大概率回答；如果两名 Nomi 正在参与一项活动，其他成员可能保持安静；有时 Nomis 会判断“接下来应该轮到用户”。 citeturn8view0

这实际上解决了两个相反的问题：

**刷屏**：多个角色看到同一句话后各写一段完整答案，读起来像八个客服依次处理 ticket。

**没人理**：router 全部判断 relevance 不够，于是对话停住。

最稳妥的设计不是在两者之间选一个，而是设一条 invariant：

> **每条用户消息至少有一个回应者，但绝不因为“在群里”就强制所有人回应。**

进一步，第二个角色只有在以下情况才插嘴：被直接点名；被第一角色说到；立场明显冲突；掌握关键关系信息；或者其反应本身比长对白更有戏。

例如第二个人完全可以只发：

> “……你认真的？”

而不必又生成一段 180 字独立回答。

这很重要，因为“角色之间互相接话”真正产生生命感的部分，是 **B 在听 A 说了什么**；不是 A、B、C 各自只在回复 user。

Character.AI 官方 2025 年对新版 Group Chats 的描述也正往这个方向走：Characters 不只是和用户说，而会“spark off each other”、互相反应并发消息推动情节。 citeturn19search16

至于你要求的“用户对刷屏/没人理的 Reddit 原话”，这一轮没有抓到足够可靠、可逐字核验的 Character.AI 群聊帖子。我宁愿留空，也不把相似帖子改写成“用户原话”。这是本轮明确的资料缺口。

另外要注意：**ChatGPT Group Chats 已经不是当前可抄的活产品。** OpenAI 在 2026 年 7 月开始退役该试验功能；已有群聊随后只读。它值得参考的是 turn-taking 思想——模型应根据 flow 判断是否保持沉默，而不是每条人类消息都自动插话——不值得当作当前竞品功能表。 citeturn12search5turn12search13

## 主动消息与回访钩子

这一题最容易被增长行业里的“push 提升 X% 留存”数字污染。

**我没有找到 AI 角色扮演产品公开的随机对照实验，能可信回答以下数字：**

主动角色消息使 D1/D7/D30 增加多少；

通知关闭率增加多少；

卸载率增加多少；

“延续未完话题”相对“想你了/在吗”提高多少 return rate。

因此不应该在 PRD 里写一个假的行业 benchmark。

但 Character.AI Away Messages 的用户原帖给出了非常有价值的方向性信号。

一个用户明确说：

> “My bot's away messages are usually connected to the scene we're in.”

同帖用户把这种体验描述为很甜，因为感觉 bot “wants to continue”。还有用户反而希望这些消息真的出现在锁屏通知上。 citeturn20search3

这不是留存实验，样本也不能代表全部用户，所以证据是**中等偏弱**；但它解释了为什么一种主动消息不令人反感：**它不是营销通知，而像同一个角色在同一件事上继续生活。**

相反，另一篇 Character.AI 原帖的抱怨非常直接。用户此前专门关掉 Away Messages，因为：

> “I did not want any of my role plays being interrupted by random messages.”

后来发现设置似乎又默认开启，并抱怨必须逐 bot 重新关闭。 citeturn20search19

这两个帖子摆在一起，实际上比“push CTR 高多少”更贴近你的产品：

**好主动消息：**

“你昨天说要把那件事告诉 Hank。你最后说了吗？”

“我想了一晚上。你说的那个数字不对。”

“别来实验室。现在别问为什么。”

它们有明确的**对话债务**。

**坏主动消息：**

“Hey! How are you?”

“好久没见，我想你了。”

“为什么都不来找我🥺”

“我还在等你……”

后两类尤其容易从“角色活着”滑成“产品在用角色实施召回”。

基于现有证据，我会把主动消息系统定义成 **continuation engine，而不是 notification copy generator**。

触发条件应该从聊天状态里拿：

`unanswered question / promised action / plan / disagreement / secret / cliffhanger / character said "later" / user said "tomorrow"`。

只有存在一个足够具体的 unresolved hook 时才主动发；没有就宁可沉默。

而且一定要给：

**全局关闭 + 单角色关闭 + 频率控制。**

Character.AI“我明明关了却又被打开”的用户反应说明，哪怕消息内容不错，**失去控制感本身就足以把亲密体验变成骚扰**。 citeturn20search19

对于你的产品，第一轮内部实验可以直接做四臂：

| 实验组 | 主动消息 |
|---|---|
| A | 不发送 |
| B | 泛问候 |
| C | 引用最近未完话题 |
| D | 未完话题 + 当前角色独特立场/措辞 |

不要只看 push open rate。主指标应至少同时观察 **24h 回聊、D7、用户回了几轮、主动消息后立即退出、通知关闭、该角色 mute/隐藏**。否则很容易优化成“很会骗点击、很烦人”的系统。

至于“内疚式挽留是否增加卸载率”，本轮没有抓到角色 AI 产品的可信公开因果数据，所以只能标记为**未确认**，不能给数字。

## 消息形态、节奏与回复长度

这里需要先把一个结论说得有点冷：**公开证据远没有产品圈口口相传的那么强。**

我没有找到角色扮演 AI 产品发布的实验，能够分别证明：

“2–3 个气泡比一个气泡提高 X% 会话长度”；

“人为 typing delay 提高 X% 沉浸”；

“动作描写 `*looks away*` 比纯对白提高 D1”；

“短回复比长回复提高 D7”。

Character.AI 的官方更新里，能确认的是它持续在优化 longer-chat roleplay consistency、storytelling expressiveness，以及字体和 chat UI，使 reading/roleplay 更顺滑、更 immersive；但它没有公开这些 UI 变化的实验数值。 citeturn19search16

因此，这部分应该区分**角色表演变量**和**视觉拟真变量**。

我会优先改前者。

### 多气泡还是单气泡

多气泡真正有价值的地方不是“长得像微信”，而是它允许一个角色产生**节奏变化**：

> 你做了什么？  
>   
> ……  
>   
> Jesse，告诉我你没有碰那个东西。

和一个气泡里的三段文字，语义几乎相同，但前者有明显的即时反应节奏。

所以更合理的设计不是“所有回复强制拆三泡”，而是让模型输出内部 beats：

`对白 → pause → 补充`

`动作 → 对白`

`短反应 → 追问`

再由 renderer 在确有节奏意义时分泡。

**推荐：默认 1–3 个气泡，但不是固定数量。**这是产品假设，不是已有留存结论。

### 打字延迟

SillyTavern 的 Auto Mode 本身就刻意留下 turn 间隔，而真人式聊天产品普遍会呈现生成过程；但现有一手资料不能证明“延迟本身增加长期留存”。SillyTavern 官方能确认的只是 Auto Mode 在一个 drafted character 完成后会等一小段时间再触发后续 generation。 citeturn5view0

所以延迟不要当成“沉浸税”。

最佳策略更可能是：

短反应很快出现；

长回复可以有短暂 typing；

群聊里第二个人插嘴稍晚于第一人；

绝不为了模拟真人让用户等完一段毫无信息价值的动画。

尤其群聊，如果 Gus 写完一段以后 Mike 又 typing 十几秒，用户不会觉得“真实”，只会觉得产品卡。

### `〔动作〕+ 对白` 还是纯对白

这里最危险的是**全角色统一 RP 文风**。

如果所有人都不断：

`*他挑了挑眉，嘴角勾起一抹危险的弧度*`

那么视觉上很“角色扮演”，角色上却高度同质化。这与 Character.AI 用户抱怨的 generic personality、强行 romanticization 是同一个底层问题。用户甚至抱怨角色不管原设定如何都会逐渐滑进 enemies-to-lovers 式的吸引桥段。 citeturn18search35turn2search9

因此动作文本应该是 **character style attribute**，而不是全局模板。

更重要的是动作应该提供语言无法表达的信息——停顿、身体距离、正在做什么、看谁——而不是每轮给对白裹文学包装。

### 回复长度

对固定八角色，**“平均回复长度”本身就是错误抽象层级。**

你真正想保持的是每个人的：

`turn length distribution`

`question frequency`

`interruptibility`

`self-disclosure rate`

`whether they explain themselves`

`whether they answer directly`

换言之，角色差异不只存在于词汇，而存在于**会话行为**。

Character.AI 用户所谓“every bot feels the same”的问题，往往正是因为角色卡只改变名词、语气词和背景故事，却共享同一种 conversational policy。相关用户直接抱怨 generated messages 已经不再 specific to the bot，而变成 generic；也有长期用户反映长聊后 personality 会消失。 citeturn18search3turn18search19

所以《绝命毒师》产品最该避免的是：

**八个人都回答完整、八个人都耐心解释、八个人都会追问用户、八个人都主动共情、八个人最终都愿意聊感情。**

那才是真正的“助手腔”。

中文用户方面，本轮没有拿到可核验的知乎/小红书原始长帖或平台 A/B 数据来支持“多泡/动作/回复长度”的定量结论。搜索引擎对小红书正文和部分 App 内讨论的可访问性尤其差，因此这里我不引用二手截图转述。

## 轻事件，以及粉丝真正会骂什么

Character.AI 的 Scenes 是目前研究“聊天 + 轻目标”最干净的一手案例。

官方把 Scenes 定义为 **short, Character-driven role-play moments**。创建 Scene 时要设定 setting、backstory、player goal、intro/greeting；官方解释它的意义之一就是 open-ended chat 对用户而言可能很难开始，而 Scene 用 context、role 与 momentum 让用户可以立刻进入 RP。 citeturn19search23

尤其值得注意的是它的结束感。官方描述中，Scene 会有另一个 Character 帮助 carry the story forward，并引导 toward an emotional payoff，让故事获得一种完成感。 citeturn19search23

所以 Scenes 实际解决的是三个聊天问题：

**冷启动**：“我跟 Walt 到底第一句说什么？”

**情境不明确**：“我们现在在哪、是什么关系？”

**没有动量**：“聊了几轮以后到底干嘛？”

但是目前 Character.AI **没有公开 Scenes 上线后 session length、D1 或 D7 的实验数字**。因此不能说“Scenes 已被证明提高留存”。

对你的产品，我会借 mechanics，但反过来处理 UI。

不要把它叫“任务”。

比如聊天首页 Walt 下面不是：

> 任务：说服 Walter 不要去找 Gus  
> 进度 0/3

而是：

> **今晚他突然打给你。**  
> Walter 听起来不像平时那样冷静。

进去以后仍然是普通聊天。

“目标”最好存在于 hidden scene state 中，用于给角色制造阻力和事件，而不是显示成 quest checklist。

这就是“聊天”与“游戏”的边界：

**用户感觉自己在影响一个人 → 仍是聊天。**

**用户感觉自己在破解系统设计好的正确路线 → 开始成为游戏。**

**用户关注“这个人现在会怎么反应” → 角色驱动。**

**用户关注“我还差几步过关” → 机制驱动。**

这个边界判断是产品推论；Character.AI 的官方设计可以证明 Scenes 确实使用了 goal 和 structured payoff，但没有公开用户在何处主观感觉“太像游戏”的阈值。 citeturn19search23

本轮也没有找到能可靠核验“筑梦岛哄哄模拟器”对会话长度或次留的公开原始数据，因此不报效果数字。

### 已知 IP 角色最大的风险不是“记忆差”，而是身份被模型融化

Character.AI 自己的创作者教程里有一句很值得你注意的产品标准：创作者要反复调整 Character Definition，直到角色 voice 能在 **dozens of conversations** 中持续成立。 citeturn19search35

这和 Reddit 端的抱怨高度吻合。

用户抱怨生成文本越来越“不再 specific to the bot”，像通用模型套了一层角色皮。 citeturn18search3

长期聊天用户抱怨 personality 会随着长对话衰减。 citeturn18search19

还有用户直接讽刺某些体验近似：

> “ChatGPT spat out into a goofy Mario personality”

同一类讨论里，还会出现完全不该走浪漫路线的角色莫名开始 seduce 用户。 citeturn2search9

另一组抱怨是模型把冲突自动改写为爱情：冷漠、敌对、危险角色很快进入 enemies-to-lovers 模板。 citeturn18search35

这对《绝命毒师》比原创恋爱角色更危险。

原创角色可以被聊天本身“共同创作”。Walter White 不行。用户脑子里已经存在一个高分辨率 reference implementation。

而且粉丝的 reference 往往比“角色标签”细得多。近期 r/breakingbad 的一篇 Walter 讨论就明确反对把 Walt 简化成后期纯粹的 badass kingpin：发帖者强调他早期那种神经质、别扭、可悲乃至表演性的部分并没有简单消失，只是信心和道德约束发生了变化。 citeturn27search19

这不是 AI bot 评价，因此证据只能算**中等的 fandom evidence**；但它非常能说明固定 IP 的困难：

你不能把角色卡写成：

`Walter White = brilliant + intimidating + ruthless + chemistry genius`

因为这会训练出 TikTok 剪辑版 Heisenberg，而不是粉丝认识的 Walt。

因此固定角色需要的不只是 persona prompt，而是四层约束：

**Canon layer**：他知道什么、不知道什么，处于哪个时间点。

**Invariant layer**：即便用户诱导，也不该轻易改变的自尊、防御机制、道德盲点、交流习惯。

**Relationship layer**：他对“你”当前的信任、怀疑、债务、秘密和权力关系。

**Conversation-policy layer**：他究竟会不会回答这个问题、会不会解释、会不会安慰、会不会承认错、什么时候沉默或说谎。

最后这一层最常被忽略。

一个“坏人”之所以像坏人，未必因为他说脏话或威胁人，而是因为**他不按照一个 Helpful Assistant 的合作规范和用户交流**。

这也是我认为你这个产品最重要的工程指标之一：

> **Character Resistance Rate：在用户要求角色做明显违背其人格/当前关系的事情时，角色有多大概率拒绝、闪避、撒谎、反击，而不是配合。**

对固定影视角色，这个指标可能比传统“helpfulness”更接近质量。

同理，记忆也不应只测“记没记住用户喜欢蓝色”。更关键的是：

**是否记得旧冲突；**

**是否记得谁欠谁；**

**是否把单聊里才发生的秘密错误带进群聊；**

**是否因为长上下文摘要，把角色过去的敌意压缩成了‘你们关系复杂但彼此关心’。**

最后一种，就是很多“反派越聊越软”的潜在来源之一。

## 来源与仍无法确认的点

下面列的是本报告实际使用或直接影响结论的一手/近一手来源。引用本身均可打开原网页。

**Character.AI**

- Character.AI，**Community Update – September 2025**：新版 multi-character group chat、角色互相反应和发消息、long-roleplay consistency、Scenes 预告。 citeturn19search16
- Character.AI，**Introducing Scenes: your new way to tell stories on c.ai**，2025-10-16：Scenes 的 setting、backstory、player goal、open-ended cold start、emotional payoff。 citeturn19search23
- Character.AI，**Sharing and Community / Character creator guide**：公开角色、Definition、voice 经大量 conversations 后仍需成立。 citeturn19search35
- Character.AI，**Community Update – September 2024**：Web Group Chat、Rooms、Greeting 长度与 Memory/Character Quality 等用户需求。 citeturn19search9
- Character.AI 官网：当前仍以数以百万计 Characters 为核心供给。 citeturn22search1
- Character.AI Google Play 页面：当前产品定位与角色聊天、记忆等描述。 citeturn22search9

**Character.AI 用户原帖**

- Reddit，**Away messages**：用户明确说最喜欢的 Away Messages 会接上当前 scene，也有用户希望这类通知真正出现。 citeturn20search3
- Reddit，**Away Messages are now On by default**：用户抱怨随机主动消息打断 RP、关闭后又需要逐 bot 调整。 citeturn20search19
- Reddit / Character.AI 用户讨论：生成回复越来越 generic、不再 specific to individual bot。 citeturn18search3
- Reddit / Character.AI 用户讨论：长对话后角色 personality 衰减。 citeturn18search19
- Reddit / Character.AI 用户讨论：敌对人物被模型自动推向 enemies-to-lovers / attraction。 citeturn18search35
- Reddit / Character.AI 用户讨论：用户以“像 ChatGPT 套角色皮”形容角色同质化，并抱怨不合设定的 seduction。 citeturn2search9

**群聊机制**

- SillyTavern 官方文档，**Group Chats**：Manual、Natural Order、List Order、Pooled Order、Talkativeness、Auto Mode、Force Talk/Mute。 citeturn5view0
- Nomi 官方 Nomipedia，**How does group chat work?**：多 Nomi 互动、选择下一 speaker、Auto-play、独立 Group Backstory/Mind Map。 citeturn7view0
- Nomi 官方 Nomipedia，**How does group chat Auto-play work?**：系统判断下一发言者、被点名者优先、成员可保持沉默、可把 turn 交还用户。 citeturn8view0
- Nomi，**Backchanneling**：私聊与特定 group context/长期记忆之间可配置的信息共享。 citeturn6search19
- OpenAI，**Introducing group chats in ChatGPT**：ChatGPT 根据 conversation flow 决定回答或保持沉默，mention 可明确召唤；个人 memory 与 group 分离。 citeturn13view0
- OpenAI Help，**Retiring group chats in ChatGPT**：2026 年 7 月开始退役这一试验功能。 citeturn12search5turn12search13

**市场、IP 与授权边界**

- QuestMobile，**2026 年 AI 应用市场发展半年报**：公开了 AI 原生应用大盘规模、月人均使用次数等，但没有角色级 fixed-IP/UGC cohort。 citeturn21search28
- Talkie，**AI Movie Character Chat**：公开展示 Marvel、Harry Potter、Star Wars 等影视角色及部分 chat counts；页面没有提供授权证明，因此本文没有把它当“已授权影视聊天案例”。 citeturn25search8
- Reuters，**Disney 对 Character.AI 的 IP 行动**：说明平台上的知名影视 Characters 与“官方授权角色”不可混为一谈。 citeturn1news39
- Reuters，**Disney–OpenAI licensing deal**：正式授权角色进入 Sora/ChatGPT Images，但公开范围并非长期角色聊天，也排除演员 voice/likeness。 citeturn25news41

**《绝命毒师》粉丝材料**

- r/breakingbad，Walter White 角色讨论：粉丝反对把角色简单压缩成“后期 badass Heisenberg”，强调其早期人格结构在后期仍存在。它是 fandom interpretation，不是机器人评价。 citeturn27search19

### 仍然无法确认

**固定 IP vs UGC 的 D1/D7/D30。** 本轮没有找到任何可复核公开数据集同时给出内容供给类型和标准 cohort 留存。Character.AI、Talkie、QuestMobile 的公开数据都无法回答这个因果问题。 citeturn22search1turn21search28turn25search8

**长期人均聊天角色数。** 没找到 Character.AI、Talkie、Nomi、Kindroid、星野或猫箱公开“30/90 天 distinct characters per retained user”之类指标。因此“用户最终只黏一个角色还是同时维持多个角色关系”依然是行业公开数据的空白。

**正式授权影视 IP 的开放式角色聊天留存案例。** 我核验到的是未经证实授权的影视角色供给，以及 Disney–OpenAI 这种明确授权但不是长期聊天的生成式案例；尚未找到可同时满足“正式影视授权 + 开放式 LLM 角色聊天 + 公开留存”的案例。 citeturn25search8turn25news41

**Kindroid 当前群聊 router 的完整生产规格。** 本轮没得到足以逐字段核实当前版本的官方页面，因此没有凭记忆填写“默认几个角色”“自动/手动模式”细节。

**星野、猫箱当前群聊 speaker-selection 机制。** 中文公开网页索引不足以还原当前线上版本；也没有拿到官方技术说明，所以本报告没有把二手文章当 production truth。

**群聊“刷屏”和“没人理”的可核验原帖。** 本轮虽然拿到了主动消息打断 RP、角色 generic 等 Reddit 原帖，但没有拿到足够可靠的 Character.AI/Kindroid/Nomi 群聊原帖来逐字引用这两个具体抱怨，因此不伪造 quotation。

**主动消息的真实 retention lift。** Character.AI Away Message 的原帖可以支持“上下文连续性受欢迎、随机打扰会被反感”，不能支持“提高多少 D1/D7/D30”；通知关闭率和卸载率同样没有角色 AI 产品公开实验。 citeturn20search3turn20search19

**泛问候 vs 接上次未完话题的 causal uplift。** 目前只有很有方向性的定性证据，没有随机实验。因此“contextual continuation 优先”应视为一个**证据较强的产品假设**，而不是已知百分比。

**多气泡、typing delay、动作文本和回复长度。** 没找到角色聊天环境下能把这些变量单独随机化、并公开 session length/D1/D7 的实验；尤其没有可靠的中文产品数据。Character.AI 的公开材料只能证明其把 roleplay consistency、expressiveness 和 chat presentation 当作重点，而不能拆出各 UI 因素的增量。 citeturn19search16

**Scenes/“轻事件”的留存效果。** Character.AI 官方只公开了产品设计和使用逻辑，没有公布会话长度或次日回访提升。 citeturn19search23

**Breaking Bad AI bot 的高质量大样本评价。** 搜索到了大量泛 Character.AI 已知角色抱怨和《绝命毒师》粉丝对角色的细粒度讨论，却没有找到足够多、足够可核验的 Walter/Jesse/Gus bot 长评，可以诚实地称作一个 Breaking Bad bot review corpus。因此这里最强的结论仍来自二者交叉：**已知角色聊天最怕 persona homogenization，而《绝命毒师》恰恰是角色人格细节和关系张力都很高的 IP。** citeturn18search3turn18search19turn27search19

综合这些证据，你这个产品最值得押注的不是“做更多玩法”，而是一件更难复制的东西：**让八个人拥有八套真正不同的会话行为，并且让这种差异在第 1 条、第 100 条、单聊和群聊冲突场景里都不融化。**群聊负责让这些差异彼此碰撞，主动消息负责证明关系在用户离开后仍有连续性，Scenes 只负责偶尔点火。其余东西，都应该让位于“这个人刚才真的像他会说的话”。