# 发现报告

## 用户画像

- **谁**：
  - 主要：Breaking Bad 粉丝（18-35 岁），中英文双语，想跟 Walter/Jesse 等角色深度互动
  - 次要：AI 角色扮演爱好者，用过 Character.ai / SillyTavern，想要更有结构感的叙事
  - 潜在：中文用户想用母语跟英文 IP 角色对话

- **现状**：
  - 用 Character.ai 自创角色，但 Character.ai 不能扮演 Breaking Bad 的官方角色（版权限制）
  - 用 SillyTavern + 本地模型，但配置复杂、移动端差
  - 用普通 LLM（ChatGPT/Claude）手动 prompt，没有结构化叙事

- **不满**：
  - Character.ai 版权墙：不能扮演知名 IP 角色
  - 普通 LLM 容易出戏（忘记人设、跳出角色）
  - 没有"导演模式"——只有 1v1 聊天，没有多角色互动剧情
  - 移动端体验差（SillyTavern 是桌面端为主）

## 问题验证

- **证据**：
  - Character.ai 禁止扮演受版权保护的角色（用户社区大量抱怨）
  - SillyTavern GitHub 31k stars，说明强需求但工具门槛高
  - AI roleplay 是 LLM 应用 Top 3 用例（仅次于编程和写作）
  - Reddit r/CharacterAI 200k+ 用户，r/airoleplay 活跃

- **频率**：高频（daily/weekly 用户留存 Character.ai 约 60%）

- **严重程度**：中高——有替代品但各有硬伤，没有"完美的 Breaking Bad 角色扮演工具"

## 竞品扫描

| 竞品 | 方案 | 优势 | 劣势 |
|------|------|------|------|
| Character.ai | 通用角色聊天 + 社区分享 | 用户量大、移动端好、角色生态丰富 | 不能扮演版权角色、付费墙（Nitro $9.9/月）、单角色聊天 |
| SillyTavern | 开源本地前端 + 任意 LLM | 完全免费、高度自定义、无版权限制 | 配置复杂、仅桌面端、无移动端 |
| Poe.com | 多模型聚合 + Bot 商店 | 模型选择多、响应快 | 角色生态弱、无结构化叙事 |
| Replika | AI 情感伴侣 | 记忆系统强、关系深度 | 不搞角色扮演、有伦理争议 |
| Chai | 移动端角色聊天 | 移动端体验好 | 质量参差、社区 UGC 为主 |

## 机会判断

- **值得做**：是
- **理由**：
  1. 版权角色是一个明确的空白——Character.ai 不做，没有人做得好
  2. 结构化叙事（Story 模式）是差异化——竞品只有 1v1 聊天
  3. 中文支持是护城河——竞品几乎无中文优化
  4. 黑客松已有可运行原型，验证了技术可行性
- **我们的优势**：
  - 具体 IP（Breaking Bad）= 自带角色设定，不需要用户创建
  - 多模式（Chat + Crew + Story）= 比竞品丰富
  - 中文双语 = 覆盖 Character.ai 没服务好的用户群
  - Vercel 部署 = 零运维成本
- **不做的代价**：竞品迟早会补版权角色，窗口期有限（估计 6-12 个月）
