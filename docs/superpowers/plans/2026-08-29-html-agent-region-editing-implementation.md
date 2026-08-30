# HTML Agent 区域编辑、草稿预览与 Turn 级历史实施计划

> 日期：2026-08-29
>
> 状态：待实施
>
> 设计规格：
> [HTML Agent 区域编辑、草稿预览与 Turn 级历史设计](../specs/2026-08-29-html-agent-region-editing-design.md)

## 1. 实施目标

在不突破现有 Agent Editing Session 边界的前提下，为 HTML Workbench 增加：

- `html_begin_edit` 与 `html_replace_edit`；
- 任意有真实源码位置的元素定位；
- 严格显式闭合校验；
- 每次成功 replace 后从应用草稿精确刷新一次；
- 按 Provider 原生 execution identity 聚合的 20 步 undo/redo；
- Turn 失败、取消和应用重启后的恢复；
- 用户查看变更、异步同步到原文件或放弃草稿；
- 重启后继续显示草稿，并仅在历史引用实际定位失败时提示原文已修改。

本计划不实现通用 Turn Effect 系统，不让 Agent 写真实 Asset，不把正文历史放进 SQLite，也不
创建 HTML 专用 GenerationTask 或聊天通道。

## 2. 实施顺序

```text
最小 Function Tool 上下文
  -> HTML parser/source edit engine
  -> recovery file 与草稿历史
  -> HTML Editing Service 和两个工具
  -> GenerationTask 生命周期收口
  -> Workbench preview/commands/events
  -> Renderer 动效、审查与刷新
  -> 集成恢复和完整门禁
```

前四项先用纯 Main/Node 测试闭环。Renderer 开始接入前，必须已经证明 replace 只可能得到完整
新草稿或结构化失败，且真实 Asset 从未被工具写入。

## 3. Task 1：补齐最小 Provider-neutral 工具上下文

主要文件：

```text
src/main/agents/function-tools/agent-function-tool.ts
src/main/agents/providers/codex-function-tools.ts
src/main/agents/providers/codex-function-tools.test.ts
src/main/generation/generation-agent-runner.ts
src/main/generation/generation-agent-executor.ts
src/main/generation/generation-agent-executor.test.ts
```

实施：

1. 给 `AgentFunctionToolExecutionContext` 增加 `callKey`、`executionId` 和只读
   `assetReferences`。
2. `PreparedGenerationTask.assetReferences` 经 Executor 传入 `GenerationAgentTurnRequest`；继续
   使用现有 clone/validate 函数，不传真实绝对路径。
3. Codex dynamic tool handler 使用已经通过 thread/turn 校验的 `activeTurnId` 填充
   `executionId`，并传当前 request 的 `callKey` 与 AssetReferences。
4. Codex Adapter 之外只把该值视为不透明 Provider execution identity；不出现
   `turn/started`、`item/tool/call` 等 Codex DTO。
5. 执行过 HTML 工具的 call checkpoint 必须返回与工具上下文相同的
   `providerExecutionId`；缺失或不一致由 HTML 恢复层失败关闭。
6. 不增加 effect registry、commit/rollback callback 或新的 runner 生命周期接口。

测试：

- handler 收到正确 taskId、callKey、projectId、executionId、AssetReferences 和 signal；
- 错误 thread/turn/call context 在工具执行前失败；
- AssetReferences clone 后只读，工具无法改变 prepared task；
- 没有额外工具的现有 Generation 行为不变；
- recovered Codex Turn 的 `providerExecutionId` 仍等于原生 Turn ID；
- 工具 `executionId` 与完成 checkpoint identity 不一致时不能提交 pending。

完成标准：HTML 工具能依赖稳定身份和受信任 Asset binding，而通用层没有获得 HTML 或事务
语义。

## 4. Task 2：实现 HTML parser 与 source edit engine

依赖和文件：

```text
package.json
pnpm-lock.yaml
src/workbenches/html/editing/html-document-parser.ts
src/workbenches/html/editing/html-fragment-validator.ts
src/workbenches/html/editing/html-source-editor.ts
src/workbenches/html/editing/html-source-editor.test.ts
src/workbenches/html/editing/html-fragment-validator.test.ts
```

实施：

1. 将 `jsdom@30` 从 devDependency 移到 runtime dependencies，并直接声明 `parse5@8`；检查
   锁文件没有为 jsdom 再安装第三份 parse5 8。
2. `jsdom` 使用 `includeNodeLocations`，禁用脚本执行和外部资源加载。
3. 实现唯一 CSS selector 定位和 `html.dom@1` path + 指纹定位；不做模糊回退。
4. 只接受拥有真实 source location 的节点；区分显式与 parser 隐式生成的
   html/head/body/tbody。
5. 计算 `contents` 和 `element` 的 UTF-16 source range，并生成 replacement 后的新 DOM Anchor。
6. 用 context-aware parse5 fragment 校验所有非 void 元素显式闭合、单根 scope、namespace、
   raw-text、template、table/select 和 foster parenting。
7. 替换后重新解析完整文档；不接受 parser 自动修复才成立的结果。
8. 通过现有 TextContentAdapter 保留编码、BOM 和换行，并验证目标编码可逆。
9. 为 selector、replacement、target source 和完整文档建立常量上限；工具 schema 与 handler
   使用同一组限制，任何超限都显式失败。

最低测试：

- selector 非法、0 个、1 个和多个命中；
- DOM path 越界以及 tag/id/role/aria/text 指纹漂移；
- 显式与隐式 html/head/body/tbody；
- contents 多根、element 单根和多根失败；
- `<div><span>x</div>`、孤立结束标签、省略 `</li>`/`</p>`；
- void、自闭合 foreign element、script/style/template、SVG/MathML；
- table/select/list context 和 foster parenting；
- outer replacement 修改 tag/id 后的新 Anchor；
- Unicode surrogate、CRLF、UTF-8 BOM、非 UTF-8 可逆与不可逆编码；
- parser 不执行脚本、不请求网络；
- 每个大小边界的等于、加一和空值情况。

完成标准：纯函数输入 source、target、scope、replacement 后，只返回完整新文档和元数据，或在
写入前返回结构化失败。

## 5. Task 3：实现 recovery file、草稿与 20 步 journal

主要文件：

```text
src/main/paths/app-paths.ts
src/main/paths/app-paths.test.ts
src/workbenches/html/editing/html-editing-session.ts
src/workbenches/html/editing/html-editing-session-file.ts
src/workbenches/html/editing/html-edit-history.ts
src/workbenches/html/editing/*.test.ts
```

实施：

1. `AppPaths` 增加通用 `<userData>/recovery`，bootstrap 只传该根路径。
2. HTML file adapter 使用 projectId/assetId 稳定摘要创建目录，并在 manifest 中复核真实 ID。
3. `session.json`、`draft.html`、pending checkpoint 和 journal 全部使用同目录原子写入。
4. session decode、schema version、路径、revision、cursor、entry/pending identity 全部失败关闭。
5. 首次 begin 从 ContentHandle 读取原件，记录 source revision/编码/BOM/换行并创建 draft。
6. replace 采用 write-ahead 顺序：pending checkpoint/journal -> draft -> after revision/journal。
7. 同一 execution 的 operations 保存在一个 pending；settle 后形成一个 entry。
8. rollback 使用 Turn 前 checkpoint 恢复完整 draft；commit 删除 checkpoint 并保留可逆 operations。
9. undo/redo 验证相邻 revision 后整步应用；新分支删除 redo；裁剪到 20 步。
10. sync 更新 source/synced draft revision 但保留草稿和历史；有 pending 时持久化
    `syncRequested`，待 Turn 收口后再同步稳定 revision。
11. discard 删除整个 Asset recovery session，并重新显示当前原件。
11. 所有临时文件、文件句柄和失败后的 staging 有明确清理；删除失败不报告成功。

测试：

- manifest round-trip、损坏 JSON、未知版本、ID 摘要碰撞复核；
- write-ahead 每个故障点重启后的可判定状态；
- 同 Turn 三次 replace 只生成一个 entry；
- rollback 同时撤销三次 replace；
- 20 条裁剪、cursor、undo/redo、新分支截断；
- synced revision 前后 undo/redo 只改变 draft；
- pending 期间请求 sync 会排队，完成/回滚后只同步稳定草稿；
- revision mismatch 标记 conflict，不覆盖 recovery 文件；
- Windows 路径、并发原子替换和清理失败。

完成标准：任意进程中断点都不会让真实 Asset 改变；恢复目录能够判定完成、回滚、等待或冲突，
不会靠猜测补成功记录。

## 6. Task 4：实现 HtmlAgentEditingService 与两个工具

主要文件：

```text
src/workbenches/html/editing/html-agent-editing-service.ts
src/workbenches/html/editing/html-edit-function-tools.ts
src/workbenches/html/editing/html-edit-tool-contracts.ts
src/workbenches/html/generation/main.ts
src/workbenches/html/main-contribution.ts
src/main/workbench/main-workbench-contribution.ts
src/workbenches/catalog/register-main-workbenches.ts
src/main/bootstrap/create-application-runtime.ts
```

实施：

1. HtmlAgentEditingService 按 Asset 建串行队列，统一执行 begin、replace、settle、rollback、
   undo、redo、sync、discard 和 recovery audit。
2. 从 `assetReferences.source` 要求恰好一个 `text/html` reference，验证 project/asset 仍匹配；
   永远不信任模型路径或 assetId。
3. begin/replace 实现设计规格中的 editId、identity、scope、revision、重试和消费规则。
4. 每个 execution 同时最多一个 active edit；成功 replace 后才允许再次 begin。
5. 注册两个工具；模型可见失败只包含可修正原因，不泄漏路径、HTML 全文或内部异常。
6. HTML feature-local factory 创建唯一 editing service，并显式共享给工具、Context Provider、
   Workbench Provider 和 lifecycle observer。
7. 调整 Function Tool 注册顺序：基础 Asset/Workbench/recovery/event 依赖可用后注册，随后创建
   AgentProvider；IPC 仍最后注册。
8. `MainWorkbenchAgentToolContext` 只增加初始化领域工具确实需要的显式接口，不传大而全的
   `services` 对象。
9. 重复初始化、缺失初始化和 dispose 后访问全部失败关闭并有测试。

Context Provider：

- 真实 HTML 不可读写或恢复状态冲突时，不声明编辑工具，普通问答继续可用；
- 工具可用时声明两项 required Function Tool；
- 系统提示只允许在用户明确提出修改请求时调用工具；
- 当前 `html.dom@1` 以完整受信任 JSON 作为推荐 locator，不成为权限边界；
- 提示 Agent 后续编辑以 begin 返回的 `currentHtml`/draft revision 为准。

完成标准：模拟 dynamic tool loop 可修改 recovery draft，但断言真实 ContentHandle 的
`writeBytes` 从未被两个工具调用。

## 7. Task 5：接入 GenerationTask 收口与崩溃恢复

主要文件：

```text
src/workbenches/html/editing/html-edit-generation-observer.ts
src/workbenches/html/editing/html-edit-generation-observer.test.ts
src/workbenches/html/generation/main.ts
```

实施：

1. HTML Feature `start()` 订阅 GenerationTaskService，不改变公共 TaskDefinition。
2. task-completed 使用持久化 agentCalls 中的 taskId/callKey/providerExecutionId 提交匹配
   pending。
3. failed、cancelled 和 discarded 调度整 Turn rollback，并清除 active edit/动效。
4. 首次访问 Asset recovery session 时通过 GenerationTaskService snapshot 审计 pending。
5. 已持久化完成 call 的恢复不重放工具；相同 executionId 只 commit 一次。
6. 同 task/call 出现新 execution 前，回滚无法完成的旧 pending。
7. task 状态缺失、旧 checkpoint 与当前 draft 不匹配时进入 recovery conflict，不伪造成功。
8. observer dispose 后不再调度新操作，并等待已接纳队列安全结束或取消。

测试场景：

- completed、failed、cancelled、discarded；
- completed checkpoint 写入后、task-completed 事件前崩溃；
- replace draft 写入后、工具响应前崩溃；
- recovered completed Turn 不重放工具并提交原 pending；
- 未恢复旧 execution 后开始新 execution；
- 重复/乱序事件幂等；
- Project unload 与应用 shutdown。

完成标准：历史步骤的边界来自真实 Provider execution，并由 GenerationTask 持久化事实收口，
不从 assistant 文本、消息间隔或工具数量推断。

## 8. Task 6：接入 HTML Workbench 草稿预览与用户命令

主要文件：

```text
src/workbenches/html/main.ts
src/workbenches/html/main.test.ts
src/workbenches/html/shared.ts
src/workbenches/html/shared.test.ts
src/workbenches/html/editing/html-preview-content-handle.ts
src/workbenches/html/editing/html-edit-frame-script.ts
```

实施：

1. HTML Provider 为每个 session 注册 preview ContentHandle；有草稿读 draft，否则委托 source。
2. open/close 在 editing service 注册/注销 asset-session binding；不修改 WorkbenchSessionService。
3. 实现 `materializeContent()`：有有效草稿时让下一轮 source AssetReference 读取 draft。
4. bootstrap payload 增加 editable、draft status、change count、canUndo/canRedo 和 conflict 状态。
5. 增加 review/sync/discard/undo/redo 命令和全部 runtime validators。
6. sync command 可随时受理；有 pending 时只记录同步意图，无 pending 时重新读 source，复检
   baseline revision、完整 HTML、编码可逆性后通过 `writeBytes(expectedRevision)` 原子保存。
7. 同步成功后保留 draft 作为 preview/materialization 来源，只更新 source/synced revision；
   后续 Agent 修改会再次进入 unsynced。
8. 应用重启时先解析真实 Asset revision，再恢复 recovery session：baseline 一致则显示 draft，
   不一致则显示 conflict，不能静默改用原件或覆盖草稿。
9. discard/undo/redo/rollback 各自只发布一次需要刷新的状态事件。
10. started/rejected/applied/rolled-back/session-changed 事件只发送安全元数据。
11. frame script 在 sandbox 内按 resolved Anchor 显示独立编辑动效，不复用用户引用高亮状态。

完成标准：Workbench 当前预览和下一轮 Agent reference 都读取同一 draft；重启后继续恢复该
draft；用户同步前真实文件字节保持不变，外部修改会阻止 sync。

## 9. Task 7：实现 Renderer 刷新、动效与审查 UI

主要文件：

```text
src/workbenches/html/renderer.tsx
src/workbenches/html/renderer.test.tsx
src/workbenches/html/renderer-actions.ts
src/workbenches/html/renderer-actions.test.ts
src/workbenches/html/editing/HtmlEditIndicator.tsx
src/workbenches/html/editing/HtmlEditReview.tsx
```

实施：

1. 订阅 HTML edit events，并校验 type/payload 后更新本地状态。
2. begin 显示非布局型动效；rejected 保留目标并显示短暂失败态；applied 进入刷新队列。
3. 每个 applied event 恰好执行一次：保存 Anchor -> `frameRevision + 1` -> 等待 onLoad ->
   重装 source-copy runtime -> reveal -> 清理动效。
4. 多个 applied 事件使用显式串行队列，不依赖 React state batch；不能漏刷新或重复刷新。
5. rollback、discard、undo、redo 使用同一 reload primitive；sync 内容相同，只更新
   synced/unsynced/syncing/queued 状态。
6. 增加紧凑草稿状态条和 overflow actions：撤销、重做、查看变更、同步、放弃。
7. review modal 只用文本节点/`pre` 显示 before/after，不使用 `dangerouslySetInnerHTML`。
8. AI Turn active、active edit、pending settle 或 command busy 时禁用冲突操作。
9. 动效 `pointer-events: none`、不改变布局、尊重 reduced motion；reload/close 后无残留。
10. 所有按钮文本、disabled reason 和错误使用现有 Workbench action/AppError 投影。
11. 历史记录中的“查看原文位置”继续调用现有 Anchor resolver；仅用户主动定位且结果为
    `found: false` 时提示“引用原文已被修改，无法定位到原位置。”，成功定位不提示，结构化
    command error 继续显示原错误。
12. replace/reload 不主动扫描历史、不写 stale 标记，也不因后台视觉定位失败弹出引用提示。

完成标准：用户看到的每次页面变化都能对应一个成功 draft operation，并能在之后任意时刻请求
同步或放弃；同步不切换显示来源，历史引用只在真实查找失败时提示。

## 10. Task 8：集成、边界与 PR 门禁

集成测试：

1. assistant -> begin -> replace -> final -> task-completed 完整闭环；
2. 同 Turn 三个区域、三次刷新、一个历史 entry；
3. 两个 Turn 两个 entry，undo/redo 每次移动一整轮；
4. 未闭合 replace 失败、无刷新、同 editId 修正后成功；
5. Turn 失败/取消后回滚已成功的多次 replace；
6. 应用重启后 recovered Turn 提交原 pending；
7. 草稿存在时下一轮 prepared source reference 等于 draft；
8. sync 前真实 Asset 不变，sync 后只写一次且 iframe 仍读 draft；
9. pending Turn 中请求 sync，确认先排队、settle 后同步稳定 draft；
10. sync 前外部修改导致 revision conflict，草稿仍可审查/放弃；
11. active begin 尚未 replace 时同步只持久化意图，并在 replace settle 或 Turn 失败后同步稳定草稿；
12. sync intent 写入后、原件写入前重启会继续同步；原件写入后、manifest 更新前重启会按内容一致性补完同步状态；
11. 切走 Workbench 后 Agent 可完成 draft，事件不发给无关 session；重新打开显示 draft；
12. 重启应用后 Asset 仍解析原件，但 HTML preview 和下一轮 Agent 恢复读取 draft；
13. 历史 Anchor 在当前草稿找到时正常定位，找不到时才提示原文已修改；
14. 只读 HTML 继续可阅读问答，没有 edit tools 和同步动作；
15. recovery 损坏不影响 HTML 只读打开，但编辑与同步失败关闭。

Electron 真机验收：

1. 引用元素后要求修改，确认 begin 动效和 replace 后一次刷新；
2. 不引用元素，要求模型按唯一 selector 修改另一个元素；
3. 一轮修改三个区域，确认三次刷新、审查视图一个 Turn、一次 undo 全部恢复；
4. 构造未闭合 replacement，确认页面和 draft 不变化，模型可重试；
5. 取消生成，确认当前 Turn 的视觉修改回滚；
6. 完成后查看 before/after，确认原文件尚未变化；
7. 同步后确认原文件写入和 Asset updatedTime，页面仍由 draft 提供；
8. Agent 生成中点击同步，确认显示等待同步并在 Turn 收口后完成；
9. 外部改文件后同步，确认冲突模态且不覆盖；
10. 重启应用，确认 draft、cursor、20 步和同步状态恢复；
11. 修改历史引用对应内容后点击定位，确认只有查找失败时提示原文已修改；
12. reduced motion、窄屏、长 selector/错误文本和连续刷新无重叠或布局抖动。

验证命令：

```powershell
pnpm vitest run src/main/agents/function-tools src/main/agents/providers/codex-function-tools.test.ts src/main/generation/generation-agent-executor.test.ts
pnpm vitest run src/workbenches/html/editing src/workbenches/html/main.test.ts src/workbenches/html/renderer.test.tsx src/workbenches/html/renderer-actions.test.ts
pnpm typecheck
pnpm lint
git diff --check
pnpm check
```

实现完成后使用仓库 `review-learning-companion-pr` 流程检查源码 diff、架构所有权、边界测试、
Electron 证据和 CI 风险。任何相关测试缺失、弱化、跳过或失败时不得标记 PR ready。

## 11. 建议提交边界

1. `feat(agent-tools): pass execution and asset context`
2. `feat(html): add strict source region editor`
3. `feat(html): persist agent editing drafts and history`
4. `feat(html): register draft editing tools`
5. `feat(html): settle edits from generation lifecycle`
6. `feat(html): preview and review agent drafts`
7. `test(html): cover edit recovery, sync, and stale anchors`

每个提交至少通过对应 targeted tests。不要把 parser、recovery、Provider adapter 和 Renderer
压进一个不可独立审阅的提交；不自动 push。

## 12. 最终完成标准

- 两个工具只能修改应用草稿，不能直接覆盖真实 Asset；
- 用户 Anchor 是意图提示，模型仍可按用户要求选择任意有效源元素；
- replace 必须闭合、scope 正确、revision 匹配，否则无写入无刷新；
- 每个成功 replace 精确刷新一次；
- 同一原生 Turn 的全部替换精确形成一个历史步骤，最多 20 步；
- Task 失败、取消、恢复和新 execution 都有确定、幂等的 pending 处理；
- 用户可随时请求同步，但只在安全点复检 revision 并原子保存稳定草稿；
- 重启和同步后 iframe、后续 Agent 都继续读取 recovery draft，Asset 原文件仍是持久化事实来源；
- 历史引用只有在用户主动定位且 resolver 确认找不到时提示原文已修改；
- 连续 Turn 的 Agent 和 iframe 都读取当前 draft；
- HTML 领域所有权、Main 信任边界、共享 validator 和 Composition Root 约束保持成立；
- targeted tests、`pnpm check`、`git diff --check` 与 Electron 人工验收全部通过。
