# Direct / Crew / Story 产品边界修复交付

基线：`55df802` 上的统一工作树。模式边界修复与网络恢复修复已停止并行写入；本文件最后一节记录针对同一冻结快照执行的整仓终验。提交前状态仍未 deploy。

## 改动

- Direct / Crew 的正文、Direct durable memory、关系锚点、草稿、请求状态与错误状态按模式隔离。
- 本地与云端使用一致的 `chat-v2:<mode>:<NPC id>` 线程键。云端继续使用现有 TEXT `character_id` 列、user_id RLS 与客户端加密；模型接口继续收到 canonical NPC id。本轮无新增数据库迁移。
- 旧裸角色键记录原样保留，合并本地/云端副本后只在 Legacy conversations / 旧版聊天记录里回看。旧版未标模式，不能可靠推断哪些内容是私聊；因此不自动回填或注入新会话。旧记忆同样不删除、不自动入模。
- Story 玩家身份单独保存，恢复或切换玩家不会改写聊天对象；Story 去掉聊天关系选择与 Direct 语气锚点注入。
- 只有进入 Story 才自动恢复旧剧情。useStoryStream 仅新增 autoResume 入口开关与守卫，没有修改其他任务的恢复算法。
- 模式与聊天角色即时持久化，避免切换后立即刷新又回旧模式。
- 切换模式/对象会取消旧聊天请求。旧回复、错误或回滚只能影响原线程，不改写新草稿。
- 后端 handle_chat_message 白名单过滤独立聊天上下文，不把 Story session/world 信息或数据库工厂带入单聊/群聊。Crew 不接收 Direct 私聊记忆。
- 首页结构、插画不变；文案与 CLAUDE / README / AS_BUILT 已明确「三个模式，只有 Story 是游戏循环」。

## 证据与验证

先复现并保留测试：Direct 私密台词出现在 Crew；Story 恢复把 Saul 聊天对象改成 Jesse；打开 Direct 时自动读取 Story；切换模式立即刷新回退。前三项有 RED 运行，刷新问题在全站测试中抓出，没有放宽断言。

最终本轮验证：

- 前端：231 passed。
- 后端：730 passed；最终使用不可达的测试 DATABASE_URL 覆盖，1 条 Starlette 依赖弃用 warning。此前并发负载下有一次 AST walker 的 2 秒时间断言失败；未改阈值，隔离环境复跑通过。
- TypeScript/Vite build：通过；既有 bundle >500 kB advisory 仍在。
- ESLint：通过，0 warning。Ruff（本轮后端文件）：通过。git diff --check：通过。
- mode-boundaries.spec.ts：4 个用例通过，覆盖模式隔离、旧记录只读、迟到回复隔离、Story 激活边界；生成了桌面/手机截图。
- Auth E2E（fake Supabase）：3 passed，新增真实应用读写链路的模式键、user_id 与密文断言。
- 冻结快照全站 E2E：`npx playwright test` **69 passed / 3 skipped / 0 failed**；跳过的 3 条均为 Auth 契约。`npm run test:e2e:auth` 使用 fake Supabase 单独执行 **3 passed / 0 failed**。

本机日志：`/tmp/abq-mode-final-checks.log`、`/tmp/abq-mode-isolated-back.log`、`/tmp/abq-mode-final-e2e.log`、`/tmp/abq-mode-auth.log`、`/tmp/abq-mode-replay.log`。

## 终验状态

最终冻结快照已重新执行：前端 231、后端 730、默认 E2E 69/3 skip、Auth E2E 3/3、build、lint、Ruff、`git diff --check` 与 PostgreSQL Alembic offline chain，全部通过。模式边界与网络恢复现在处于同一个可提交快照。

本次假模型/假 Supabase 验证的是接口、状态与隔离契约，不代表真实模型文学质量或生产 Supabase/VM 已验收；生产部署仍需单独执行 migration + smoke。
