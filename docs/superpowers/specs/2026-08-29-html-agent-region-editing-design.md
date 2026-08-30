# HTML Agent 区域编辑、草稿预览与 Turn 级历史设计

> 日期：2026-08-29
>
> 状态：待实施
>
> 关联设计：
>
> - [技术栈与架构基线](../../../TECH_STACK.md)
> - [Asset 与资料工作台架构设计](./2026-07-27-asset-workbench-architecture-design.md)
> - [Agent Function Tool、Skill、MCP 与 Codex 能力适配设计](./2026-08-07-agent-function-tools-and-skills-design.md)
> - [统一 Workbench Conversation 架构](./2026-08-23-unified-workbench-conversation-design.md)

## 1. 背景与修正

HTML Workbench 需要让对话 Agent 修改当前 HTML 中的任意源元素，并在每次完整的
`begin -> replace` 后立即刷新页面。用户引用的元素只是本轮意图提示；没有引用时，模型也可
选择其他唯一元素。撤销历史按模型的一次完整回复计步，同一回复中的多个替换合并为一步，最多
保留 20 步。

原始方案让 `replace` 直接写真实 Asset，再用撤销历史承担审查和恢复。这与项目已确认的 Agent
Editing Session 基线冲突：Agent 只能读取原件、修改应用管理的草稿，用户之后主动同步时才可
复检 revision 并原子保存原件。因此本设计保留动态渲染体验，但把刷新来源改为草稿：

```text
原始 Asset（Agent 只读）
  -> 应用创建可恢复草稿
  -> html_begin_edit 冻结草稿中的目标
  -> 页面显示目标动效
  -> html_replace_edit 校验并原子更新草稿
  -> iframe 从草稿刷新一次
  -> 原生 Agent Turn 完成
  -> 本 Turn 的全部替换形成一个历史步骤
  -> 用户继续在草稿上查看、对话和编辑
  -> 用户可在之后任意时刻请求同步
  -> Main 在安全收口点复检原件 revision，并原子同步到真实 Asset
```

“动态刷新”和“写入原件”由此成为两个明确阶段。撤销不是安全审批的替代品；它作用于当前草稿，
用户仍然决定何时把草稿同步到原件。同步不是编辑会话的结束：同步完成后 iframe 和后续 Agent
仍然读取同一草稿，新的 Turn 可以继续在其上产生未同步修改。

## 2. 最终结论

1. HTML Feature 注册 `html_begin_edit` 与 `html_replace_edit` 两个应用 Function Tool。
2. 模型可定位当前根文档内任意有真实源码位置、且未超过安全大小限制的元素。
3. 用户引用的 `html.dom@1` Anchor 是推荐目标，不是权限边界。
4. `begin` 冻结 Asset、目标、scope 和草稿 revision；`replace` 不能重新指定这些内容。
5. replacement 中所有非 void HTML 元素必须显式闭合；校验失败不改草稿、不刷新。
6. 每次成功的 `begin -> replace` 原子更新草稿，并恰好触发一次 iframe 刷新。
7. 历史步骤直接使用 Provider 的不透明 execution identity；Codex Adapter 将其映射为原生
   `turn.id`，领域层不推断消息边界，也不保存 Codex DTO。
8. 同一 execution identity 中的所有成功替换合并为一步，最多保留 20 步。
9. Turn、GenerationTask 失败或取消时，回滚该 Turn 在草稿中的全部替换。
10. 真实 Asset 只在用户请求“同步到原文件”后写入；同步请求可异步排队，实际写入前重新校验
    稳定草稿、完整文档和 baseline revision。
11. 草稿、pending checkpoint 和历史 journal 位于应用 `recovery/` 目录，不把正文级历史放入
    Workbench StateData 或 GenerationTask 数据库。
12. HTML Workbench 拥有 parser、草稿、历史、预览、事件和工具语义；bootstrap 与 Codex
    Provider 不认识 HTML 操作。

## 3. 不变量与信任边界

### 3.1 Main 是唯一可信写入者

- Renderer 不读取文件、恢复目录、SQLite 或原始 IPC。
- 模型不能在工具输入中传 `assetId`、绝对路径、revision、sessionId 或 projectId。
- 工具只能从本次 Prepared `source` AssetReference 推导真实 Asset 身份。
- Agent Workspace 的 `references/.../source.html` 始终是只读参考，不是提交目标。
- 工具只更新应用恢复目录中的草稿；用户发起的 Workbench command 才能写真实 ContentHandle。
- 真实写入必须使用 `expectedRevision` 和现有原子替换能力。

### 3.2 通用层只增加真实需要的上下文

Function Tool execution context 增加：

```ts
interface AgentFunctionToolExecutionContext {
  readonly taskId: string;
  readonly callKey: string;
  readonly projectId: string;
  readonly executionId: string;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly workspaces: PreparedAgentWorkspaces;
  readonly signal?: AbortSignal;
}
```

`executionId` 是 Provider-neutral 的不透明字符串。Codex Adapter 在动态工具回调中传当前已经
校验过的 `turn.id`；其他 Provider 可映射自己的原生执行身份。

一旦某次调用执行过 HTML 编辑工具，该调用完成 checkpoint 中的 `providerExecutionId` 必须与
工具上下文的 `executionId` 相同。缺失或不一致时 HTML pending 进入恢复冲突，不能按 taskId
猜测提交；这保证实时工具回调和持久化恢复引用的是同一个原生 Turn。

本功能不新增通用 `AgentFunctionToolTurnEffect`、commit/rollback registry 或事务协调器。
Function Tool 设计已明确延后细粒度 Effect 系统，而当前只有 HTML 有这项业务需求。HTML
Editing Service 使用上述稳定身份聚合操作，并由 GenerationTask 的持久化生命周期收口。

### 3.3 HTML 行为留在 Workbench 内

- HTML Contribution 创建并持有唯一的 `HtmlAgentEditingService`。
- HTML Function Tool、Conversation Context Provider、Main Workbench Provider 和 generation
  lifecycle observer 共享该服务。
- `WorkbenchSessionService` 不增加 HTML 专用查询，也不向工具返回 ContentHandle 或 Provider。
- HTML Provider 在 `open/close` 时把 `assetId <-> sessionId` 绑定交给编辑服务；服务只向当前
  匹配的 session 发布事件。
- Catalog 和 bootstrap 只传显式依赖并维持装配顺序，不硬编码 HTML tool ID 或事件。

## 4. 用户与 Agent 流程

### 4.1 首次编辑

```text
用户明确要求修改 HTML
  -> workbench.conversation@1 创建 GenerationTask
  -> HTML Context Provider 声明两个编辑工具
  -> Agent 读取只读 source reference
  -> begin(locator, scope)
  -> Main 读取或创建 HTML 草稿，解析并冻结目标
  -> Renderer 在目标上显示编辑动效
  -> replace(editId, html)
  -> Main 严格校验 replacement 和完整草稿
  -> 原子写 draft，记录 pending operation
  -> 发布 applied，Renderer 只刷新一次
  -> Agent 可继续 begin/replace 其他区域
  -> 原生 Turn 和 GenerationTask 完成
  -> pending operations 合并为一个历史 entry
  -> Renderer 显示草稿与同步状态
```

普通问答也可获得相同工具声明，但系统指令必须明确：只有用户明确要求修改、删除、添加或重排
HTML 时才能调用编辑工具。解释、总结和定位请求不得产生草稿修改。

### 4.2 用户审查

草稿是 HTML Workbench 持续显示和后续 Agent 持续读取的 working copy。草稿与最近一次同步的
原件不同时，HTML Workbench 显示紧凑状态条：

- 当前有多少个已完成 Turn 和多少个区域变更；
- 撤销、重做；
- 查看变更；
- 同步到原文件；
- 放弃草稿。

“查看变更”按 Turn 展示目标摘要和转义后的 before/after 源码，不把 HTML 作为可执行 DOM
插入 Renderer。用户可在动态预览和源码变更之间核对。

用户可在多个 Turn 之后一次同步，也可在生成进行中发起同步请求。若当前没有 pending Turn，
Main 立即在 per-Asset 串行队列中同步当前稳定 draft revision；若仍有 pending，先记录
`syncRequested` 并显示“等待同步”，待该 Turn 完成或回滚后同步届时最新的稳定草稿。不能把之后
可能整体回滚的半个 Turn 写入原件。

同步在队列开始执行时冻结一个 draft revision，并只提交该快照。同步期间随后到达的 Agent 编辑
在队列中等待；同步完成后若又产生修改，状态自然重新变为未同步。同步不会删除草稿、关闭编辑
会话或让 iframe 切回原件。

用户点击同步就是对当前稳定草稿的审查与写入授权，不要求每个 Agent Turn 单独接受。

“放弃草稿”恢复当前真实 Asset，删除该 Asset 的草稿、pending 和历史恢复文件，并刷新一次。

## 5. 工具契约

### 5.1 `html_begin_edit`

输入：

```ts
interface HtmlBeginEditInput {
  readonly locator:
    | { readonly kind: 'dom-anchor'; readonly target: HtmlDomTarget }
    | { readonly kind: 'selector'; readonly selector: string };
  readonly scope: 'contents' | 'element';
}
```

行为：

- `dom-anchor` 复用 `html.dom@1` 的 frame URL、element-only path 和指纹；
- `selector` 使用标准 CSS selector，必须恰好命中一个元素；
- v1 只允许当前 Asset 的根文档，不编辑嵌套 frame 或远程页面；
- 浏览器或 parser 隐式生成且没有源码位置的节点不可编辑；
- `contents` 冻结 start-tag 结束到 end-tag 开始之间的源码区间；void 元素不支持此 scope；
- `element` 冻结完整元素源码区间，replacement 可以改变标签、属性和内容；
- 一个 execution 同时最多有一个未成功替换的 `editId`；
- begin 绑定 task、call、execution、project、Asset、target、scope 和 draft revision；
- 找到当前 HTML Workbench session 时发布 started 事件；没有打开页面不影响编辑。

输出：

```ts
interface HtmlBeginEditResult {
  readonly editId: string;
  readonly draftRevision: string;
  readonly scope: 'contents' | 'element';
  readonly resolvedTarget: HtmlDomTarget;
  readonly currentHtml: string;
}
```

目标区域超过工具输出上限时 begin 失败并要求模型选择更小的源元素，不截断 `currentHtml`。

### 5.2 `html_replace_edit`

输入：

```ts
interface HtmlReplaceEditInput {
  readonly editId: string;
  readonly html: string;
}
```

成功顺序：

1. 验证 `editId` 属于当前 task、call、execution 和 Asset；
2. 验证当前 draft revision 仍等于 begin 时的 revision；
3. 在目标上下文中解析 replacement，执行显式闭合、scope 和大小校验；
4. 只替换 begin 已冻结的源码区间；
5. 重新解析完整草稿并生成 replacement 后的新 Anchor；
6. 先持久化 pending journal/checkpoint，再原子替换 draft；
7. 持久化 after revision 和 operation；
8. 发布 applied 事件；
9. 消费 `editId`。

输出：

```ts
interface HtmlReplaceEditResult {
  readonly status: 'applied';
  readonly draftRevision: string;
  readonly resolvedTarget: HtmlDomTarget;
}
```

可修正的 parser、闭合和 scope 错误不改草稿，发布 rejected，保留 `editId` 供模型重试。revision
冲突、身份不匹配、已消费 ID 和恢复状态不确定时失败关闭，必须重新 begin。

## 6. HTML 解析与闭合规则

实现使用成熟 HTML5 parser，不用正则表达式匹配标签。首版使用 runtime `jsdom@30` 的
`includeNodeLocations` 提供标准 selector、DOM path 和源码位置，并直接声明同代 `parse5@8`
完成 context-aware fragment 校验；锁文件应让 jsdom 与直接依赖复用 parse5 8，仓库中 rehype
带来的 parse5 7 保持独立。

解析不执行脚本、不加载资源、不触发事件处理器。

### 6.1 Target 定位

- selector 非法、命中 0 个或多个元素均失败；
- DOM Anchor 先按 element-only path 定位，再校验 tagName、ID、role、ariaLabel 和 textQuote；
- 路径与强指纹冲突时不做模糊匹配；
- 明确写在源文件中的 `html/head/body/tbody` 可编辑，parser 隐式补出的同名节点不可编辑；
- offset 使用 JavaScript UTF-16 code unit；编码只在 TextContentAdapter 边界处理。

### 6.2 Replacement 规则

- 所有 HTML namespace 下的非 void 元素必须有显式结束标签；
- void 元素不要求结束标签；
- 不接受孤立或多余结束标签；
- 不接受依赖隐式闭合、隐式插入、重排或 foster parenting 才成立的片段；
- `contents` 允许多个顶层节点和文本；
- `element` 必须恰好产生一个顶层 Element，顶层外只允许空白；
- `script`、`style`、`template`、SVG 和 MathML 服从 parser 的 namespace/raw-text 规则；
- 片段必须在真实 context element 中解析，覆盖 table、select、列表等上下文；
- 替换后重新解析完整文档，确认没有由本次替换产生的隐式结构异常。

首版设置明确上限并在工具 schema 与 handler 双重校验：selector、replacement、当前区域和完整
文档都必须有界。具体字节值在实现时以 Codex 动态工具 payload、内存占用和 Electron 真机测试
确定，不允许静默截断。

## 7. 草稿、历史与恢复文件

### 7.1 事实来源

新增通用应用路径：

```text
<userData>/recovery/
```

HTML Feature 在其下管理：

```text
recovery/html-agent-editing/<project-key>/<asset-key>/
├── session.json
├── draft.html
├── pending/<execution-key>.checkpoint
└── journal/<entry-key>.json
```

目录 key 由 projectId/assetId 的稳定摘要生成，manifest 内保存并复核真实 ID，避免把领域 ID
直接当作路径片段。所有写入使用同目录临时文件加 rename。恢复文件是正文和历史的事实来源；
Workbench State 只保存小型 UI 状态，不复制 draft 或 journal。

`session.json` 至少保存：

```ts
interface HtmlAgentEditingSessionV1 {
  readonly format: 'learning-companion/html-agent-editing';
  readonly version: 1;
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly draftRevision: string;
  readonly syncedDraftRevision: string;
  readonly syncRequested: boolean;
  readonly cursor: number;
  readonly entries: readonly HtmlEditTurnEntry[];
  readonly pending: readonly HtmlPendingTurn[];
}
```

每个 history entry 保存 taskId、callKey、不透明 executionId、时间、目标摘要和可逆源码
operations。pending 额外保存 Turn 前完整 draft checkpoint；因此进程退出后仍可整体回滚半轮
修改。Turn 完成后删除 checkpoint，只保留可逆 journal。任何正文都不进入 GenerationTask
snapshot 或跨进程事件。

### 7.2 20 步语义

- 一个 history entry 恰好对应一次成功完成且实际产生替换的 Provider execution；
- 同一 execution 的多个 replace 按成功顺序放在一个 entry 中；
- 没有成功 replace 的 Turn 不占步骤；
- undo 逆序应用一个 entry 的全部 operation；redo 正序应用；
- undo/redo 只改变草稿，不创建 Agent 历史步骤；
- cursor 不在末尾时产生新 Turn，删除 redo 分支；
- 最多保留 20 个 entry，同时保留足以验证当前 cursor 的 revision 链；
- 所有操作要求当前 draft revision 与 journal 预期一致，否则标记恢复冲突并停止写入。

### 7.3 Turn 收口

GenerationTask 是任务完成、取消、失败与恢复的事实来源。HTML Feature 在 `start()` 中订阅现有
GenerationTaskService：

- `task-completed`：从已持久化 `agentCalls` 找到 executionId，把匹配 pending 合并为 entry；
- failed/cancelled/discarded：回滚该 task 的 pending checkpoint，清除未消费 editId；
- 应用启动或 Asset 首次访问：用 GenerationTask snapshot 审计遗留 pending；
- 已完成 call 在恢复时由 stable `callKey` 返回，不重新调用工具；原 pending 可由相同
  executionId 正确提交；
- 如果同一 task/call 启动了新的 executionId，先回滚无法再完成的旧 pending，再接受新 begin；
- 状态未知时不伪造成功，不写原件，保留诊断信息并进入恢复冲突。

订阅回调只调度 HtmlAgentEditingService 的 per-Asset 串行队列。begin、replace、Turn settle、
undo、redo、sync、discard 和恢复审计全部走同一队列，避免工具与用户命令交错写 draft。

## 8. 预览和 AssetReference

HtmlAgentEditingService 为 HTML Provider 创建只读 preview ContentHandle：

- 有有效草稿时，`openByteStream/readBytes/getByteLength` 读取 draft；
- 没有草稿时委托当前真实 Asset ContentHandle；
- 不向 Renderer 或 Agent 暴露恢复文件路径；
- Workbench close 时撤销 session/event 绑定，但不删除待审查草稿。

HTML Provider 将 preview handle 注册到现有 `ContentResourceService`。因此 content URL 不变，
Renderer 只需增加 `frameRevision` 即可在下一次请求中取得最新草稿。

HTML Provider 同时实现 `materializeContent()`：有草稿时把 draft 作为下一轮只读 source
AssetReference；没有草稿时返回真实 HTML。这样连续多轮编辑不会让 Agent 继续读取旧原件。
Prepared reference 仍只是只读副本，工具始终通过其中的 `assetId` 回到 HtmlAgentEditingService。

## 9. 同步、放弃和外部冲突

### 9.1 异步同步

用户可以随时发出 sync command。Main 只在没有未收口 pending operation 的安全点执行实际
写入；有 pending 时持久化同步意图，并在 Turn settle/rollback 后自动继续。实际同步必须满足：

1. 没有 active edit、pending Turn 或恢复冲突；
2. 当前 draft revision 与 session manifest 一致；
3. 完整草稿再次通过 HTML 文档和编码可逆性校验；
4. 重新解析真实 Asset，当前 revision 等于 session `sourceRevision`；
5. 使用原编码、BOM、换行风格和 expected revision 原子写入；
6. 写入成功后更新 session `sourceRevision` 与 `syncedDraftRevision`，清除本次同步意图；
7. 通过 TrackedContentHandle 让 Asset updatedTime 沿用现有更新链。

写入原件前的任何失败都保留草稿且不修改原件。若原件的原子写入已成功、但进程在 session
manifest 更新前退出，重启时仅在持久化了 `syncRequested`、没有 pending 且原件解码内容与当前
draft 完全一致时补完 `sourceRevision`/`syncedDraftRevision`；其他 revision 变化仍进入 conflict。
UI 提供“放弃草稿并重新载入原文件”；v1 不自动 merge 或 rebase。同步完成后 preview handle 和
`materializeContent()` 继续读取草稿；同步只是更新原件 checkpoint。

### 9.2 放弃

discard 重新读取真实 Asset，撤销当前 session/event 状态，删除恢复目录并刷新一次。删除失败时
不谎报成功；保留可诊断恢复文件，但真实 Asset 不受影响。

### 9.3 Undo/Redo

undo/redo 原子更新 draft 并各刷新一次。若 draft revision 回到 `syncedDraftRevision`，状态为
synced；否则状态为 unsynced。它们不会绕过 sync 写原件。

## 10. Workbench 协议与 Renderer

HTML shared contract 增加运行时校验后的命令：

```text
html.agent-edit.review
html.agent-edit.sync
html.agent-edit.discard
html.agent-edit.undo
html.agent-edit.redo
```

以及事件：

```text
html.agent-edit.started
html.agent-edit.rejected
html.agent-edit.applied
html.agent-edit.rolled-back
html.agent-edit.session-changed
```

事件只携带 session-safe 的 edit/execution identity、resolved target、状态、revision、计数和
`canUndo/canRedo`；不携带完整 HTML、replacement、绝对路径或内部异常。review command 可按需
返回有界、转义显示的 before/after 片段。

区域动效与用户引用高亮是两个独立状态。动效脚本：

- 由现有 sandbox frame script executor 执行；
- 使用单例 style 和稳定 data attribute；
- 不改变布局，`pointer-events: none`；
- 尊重 `prefers-reduced-motion`；
- reload、close、rollback 和下一次 begin 时可靠清理；
- 视觉定位失败不反向判定已经验证的 draft 写入失败。

Renderer 对每个 applied event 建立串行刷新队列，不能依赖 React 合并 state。流程为：记录新
Anchor、增加一次 `frameRevision`、等待 iframe onLoad、重装 source-copy runtime、定位新目标、
清理动效。非法 replacement 没有 applied event，因此不刷新。

### 10.1 历史引用按需校验

HTML 内容被草稿编辑后，旧对话记录保存的 `html.dom@1`、`html.quote`、旧版 element 或 link
引用可能漂移。本功能不在每次 replace 后扫描历史、不预先标记 stale，也不改写已保存 Anchor。

只有用户点击历史记录中的“查看原文位置”时，才使用现有 sandbox Anchor resolver 在当前草稿
中查找：

- `found: true`：正常 reveal/highlight，不显示任何额外提示；
- `found: false`：显示“引用原文已被修改，无法定位到原位置。”；
- command/parser error：继续走现有结构化错误提示，不误报为内容已修改。

这条提示只由用户主动定位历史引用触发。草稿刷新、后台恢复和普通编辑动效找不到视觉目标时，
都不得弹出该提示。历史记录本身继续保留，用户仍可查看当时保存的引用摘要和问答。

## 11. 装配顺序

保留 Registry 提前创建、外部请求最后进入的不变量，但把具体工具注册移动到其依赖可用之后：

```text
create AgentFunctionToolRegistry
create Project / Asset / Workbench state / Workbench event 基础设施
registerMainWorkbenchAgentFunctionTools(显式 Main 依赖)
create AgentProviderService（持有已经完成注册的 Registry）
register Workbench generation contexts
create GenerationTaskService
register Main Workbench providers
start Main Workbench contributions
register IPC
```

HTML contribution 使用 feature-local factory 让 tool、context provider、provider 和 lifecycle
observer 获得同一个 HtmlAgentEditingService。初始化顺序和重复初始化必须有单元测试；不引入全局
Service Locator，也不把 HTML service 放进通用 ApplicationRuntime 公共 API。

`AppPaths` 只增加通用 `recoveryDirectory`。HTML 子目录命名和文件格式仍由 HTML Feature 拥有。

## 12. 明确不做

- 不逐 token 修改 draft 或 live DOM；
- 不让模型直接写真实 Asset 或 Workspace 参考副本；
- 不把用户 Anchor 变成唯一允许修改的区域；
- 不编辑远程页面、嵌套 frame 或外部资源文件；
- 不实现多用户协作、三方 merge 或自动 rebase；
- 不新增通用 Agent Effect/Transaction 框架；
- 不新增 HTML 专用 GenerationTask、聊天 IPC 或第二套对话历史；
- 不把草稿正文和历史存进 SQLite；
- 不在 v1 提供完整 20 步时间线管理器，审查视图只展示当前保留步骤和区域变更；
- 不因为结构编辑而额外禁止 script/style/事件属性，运行隔离继续由 sandbox 与现有导航策略承担。

## 13. 核心验收条件

- 模型能通过用户 Anchor 或唯一 selector 编辑任意有源码位置的当前草稿元素；
- replace 不能改变 begin 冻结的 Asset、目标或 scope；
- 未显式闭合的 replacement 工具失败，draft、真实文件和 iframe 均不改变；
- 每次成功 begin/replace 只刷新一次，失败 replace 不刷新且可重试；
- 同一 Codex `turn.id` 的多次替换恰好形成一个历史步骤；
- Turn/Task 失败或取消会整体回滚其草稿修改；
- 崩溃恢复不会重复执行已完成工具，也不会伪造 commit；
- undo/redo 按 Turn 操作草稿，最多保留 20 步；
- 用户同步前真实 Asset 字节不变；同步请求可排队，但只写稳定草稿，revision 冲突会失败关闭；
- 连续多轮 Agent 读取当前草稿的只读 materialization，而不是旧原件；
- 历史引用只有在用户主动定位且 resolver 返回 `found: false` 时提示原文已修改；
- 只读 HTML 继续可以阅读和问答，但不声明编辑工具或审查命令；
- HTML 语义不进入 bootstrap、Codex DTO、通用 Workbench Host 或 GenerationTask 业务协议；
- 所有跨进程 payload 有运行时 validator，测试和 Electron 真机验收全部通过。
