# 统一 Workbench Conversation 架构

日期：2026-08-23
状态：已实现

> 2026-08-30：ConversationPanel 的 Project 布局归属由
> [Project 右侧插槽与 Audio 布局收敛设计](./2026-08-30-project-right-panel-and-audio-layout-design.md)
> 补充。Project 始终提供可用的全局问答；Workbench Contribution 只提供可选媒体上下文，
> 不拥有聊天或历史。打开的问答与生成中心互斥复用同一个右侧插槽，UI 历史统一由后端
> Project Conversation Store 持久化。

## 1. 最终结论

所有 Workbench 即时问答只使用一个任务定义：

```text
workbench.conversation@1
```

具体 Workbench 不再创建自己的聊天 Instruction、Processor 或 TaskDefinition。它只在
Renderer 声明如何呈现媒体上下文，并在 Main 注册同 ID 的 Context Provider 来解释这份
上下文。公共 TaskDefinition 负责 Agent Session、Provider 调用、运行事件、最终结果和可选
回答提交。

```text
Workbench 采集 Anchor / Context
  -> Renderer ConversationContribution
  -> 公共 GenerationTask request
  -> workbench.conversation TaskDefinition
  -> Main ContextProvider.prepare()
  -> TaskAgentSession.call()
  -> AgentProvider
  -> 公共 Conversation result
  -> 可选 ContextProvider.commitAnswer()
  -> Renderer Conversation Controller
```

这条链路没有 Provider 直连 IPC 或媒体专用任务通道。应用级
`project_conversations` 表只保存 UI 消息投影，不替代 Provider Session 中的真实模型历史。

## 2. 三层职责

### 2.1 Renderer Workbench ConversationContribution

只负责浏览器侧和媒体 UI 语义：

- 声明 `contextProviderId`；
- 决定首次提问是否必须有 Context；
- 校验 Context 是否属于当前 Asset 版本；
- 描述、定位和清理 Anchor；
- 通过 `sourceAssetMode` 决定只传 Asset identity，还是把源 Asset 作为引用送入工作区；
- 决定本轮回答是否需要提交为 Attachment；
- 可选提供 Context 对应的回答动作。

它不再构造媒体专用 TaskDefinition request，也不解析媒体专用任务结果。

### 2.2 Main Workbench ConversationContextProvider

负责媒体特有的 Agent 输入语义：

- 校验不透明的 Workbench Context；
- 解析 Asset、Anchor、选区文字、帧或其他输入；
- 组合本轮系统提示词和用户消息；
- 声明本轮需要的工具、Skill 与 MCP；
- 在需要时生成 Agent 可读的临时材料；
- 可选地把最终回答提交为 Workbench 自己的 Attachment。

Context Provider 不创建 GenerationTask，不拥有 Session，也不直接调用 AgentProvider。

### 2.3 公共 workbench.conversation TaskDefinition

统一负责：

- 解析和校验 `WorkbenchConversationInstruction`；
- 使用 `conversationId` 作为稳定 Workspace instance key；
- 通过 Workbench Provider Selector 选择 AgentProvider；
- 调用匹配的 Context Provider 准备本轮输入；
- 通过 `TaskAgentSession.call()` 执行一次 Agent Turn；
- 投影 runtime/assistant 事件；
- 校验最终回答并形成统一结果；
- 在明确请求时调用 `commitAnswer()`。

统一结果结构为：

```ts
interface WorkbenchConversationTaskResult {
  answer: string;
  title?: string;
  providerId: string;
  modelId: string;
  contextResult?: JsonValue;
}
```

`contextResult` 只承载可选的媒体副作用结果，例如 `{ attachmentId }`。普通聊天不要求
产生文件或 Attachment。

## 3. 注册与发现

Renderer 和 Main 通过稳定的 `contextProviderId` 对齐：

```text
Renderer Contribution.contextProviderId
  == Main ConversationContextProvider.id
```

Main 侧的注册仍由 Workbench 自己完成：

```ts
registerGeneration({ conversationContexts }) {
  conversationContexts.register(new XxxConversationContextProvider(...));
}
```

应用 bootstrap 只创建公共 Registry、遍历 Workbench contributions，并在最后注册一次
`workbench.conversation@1`。bootstrap 不知道 EPUB、Image 或 Video 的提示词与处理细节。

## 4. Session 与历史

- 一次用户发送对应一个 GenerationTask；
- 同一 Conversation 的多个 GenerationTask 使用相同 `conversationId`；
- `conversationId` 映射到相同 Workspace instance 与 Provider Session；
- Provider Thread/Session 是模型上下文的事实来源；
- `project_conversations` 以 `conversationId + projectId` 保存标题和 Renderer 消息投影；
- Renderer 只通过统一 Project Conversation IPC 读写，不再由各 Workbench 使用 `localStorage`
  或 Workbench State 保存第二份历史；
- Renderer 历史不会重新拼回 Prompt；
- 新 Conversation 使用新的 `conversationId`，因此形成新的 Session 边界。

当前 Project 运行期间，公共 Conversation Runtime 按
`projectId + assetId + contributionId + conversationPartitionKey` 仅在内存中保留当前选中的
UI Conversation。`conversationPartitionKey` 是 Workbench 提供的可选不透明键；例如 Image
和 Video 使用自己的内容版本，公共层不解释版本含义。这样 Workbench Session 因刷新、
切换或重挂载而变化时，Controller 仍继续使用原 `conversationId`，而内容分区变化时不会
恢复旧 Conversation；关闭 Project 或重启应用后这份运行期选择自然消失。

Runtime 的当前 Conversation 状态是可订阅的，包含单调 `revision`、当前 UI 投影、可选的
pending start operation、已绑定但尚未终止的 active task 和启动失败后的 UI 恢复数据。
Controller 发出 GenerationTask 请求但尚未取得 task ID，或取得 task ID 后尚未确认任务终态
时，新挂载的 Controller 都会立即继承 busy 状态，不能并发发送、重试、重新回答或切换当前
Conversation。

每次 pending start 都有唯一 operation ID。旧 Controller 晚到的成功或失败只能通过匹配
operation 的 Runtime 原子更新生效：成功在 Runtime 当前 revision 上合并 task ID，不覆盖
较新的消息，并把 task ID、目标 Assistant 消息和回答模式登记为 active task；失败恢复该
operation 的 draft、Context 与错误；当前 Conversation 指针已切换或目标消息已不存在时，
晚到任务会被拒绝并取消。新 Controller 先从 active task 同步恢复 busy 和事件绑定，再按
task ID 异步查询 GenerationTask；任务终止后清除 active task，原 Conversation 可以继续下一
轮。切出 Workbench 不会取消任务，GenerationTask 继续在后台运行。

`taskId` 只是一轮执行的易失句柄，不是 Conversation、Workspace、Agent Session 或 Codex
thread 的身份。一个 Conversation 可以依次包含多个 Task；它们始终使用同一个
`conversationId` 作为 Session 分区。持久化 UI History 不参与运行期 active task 交接，
Provider 历史仍只以 Agent Session/Codex thread 为准。

普通打开、附加新 Context 和后续追问都不传 `conversationId`，也不会从持久化历史中猜测
“最近一次”会话。只有用户主动选择某条历史记录时，Renderer 才显式传入该记录的
`conversationId` 来恢复对应 Provider Session；记录中的旧消息仍然只用于 UI 展示，不会作为
模型消息重新发送。

Context 只在用户创建新 Anchor 时传入。后续追问可以不再附带 Context，Context Provider
会提示 Agent 继续使用同一 Session 中已有的媒体语境。

## 5. AssetReference 策略

是否以及如何使用当前源 Asset 由 Renderer contribution 的 `sourceAssetMode` 显式声明：

- 文档、HTML 和静态图片使用 `reference`，把验证后的源引用物化进 Workspace；
- EPUB 和视频帧问答使用 `identity`，传递 Asset id 但不复制完整媒体；
- Project 默认聊天不声明 source Asset，因此当前选中资料不会被隐式附加；
- Context Provider 可以在 Main 中生成最小、可信的派生输入。

这不是公共层对媒体的猜测，也不需要为不同媒体增加 TaskDefinition。

## 6. Video 右键框选问答

Video Workbench 的首轮链路为：

```text
右键按下并拖动
  -> video.frame-region Anchor
  -> timeSeconds + 归一化矩形 + 原始帧尺寸
  -> 公共 Conversation request（不带完整视频 AssetReference）
  -> VideoConversationContextProvider
  -> 现有媒体组件中的 FFmpeg 在精确时间点截取一帧
  -> 若已有字幕 Artifact，读取当前时间附近最多五个真实 Cue
  -> 完整帧 + 标框完整帧 + 带邻域的局部放大图
  -> 可选的原文字幕 + 已完成译文字幕
  -> 公共 TaskAgentSession
```

短距离右键点击退化为“选择整帧”。框选完成后保留可见选区；从聊天历史定位 Context 时，
Video Workbench 负责跳回对应时间并恢复矩形。视频内容版本变化后，旧 Context 不会被用于
新内容。

字幕是可选增强：问答只读取已经完成并通过版本校验的 Artifact，不触发转写或翻译，也不
复制整条字幕。当前画面与最近 Cue 相距超过 15 秒时不附加字幕；附加时保留真实 Cue
时间戳，并明确提示 Agent 转写和翻译可能有误。

临时选区遵循公共 Context 释放生命周期：右键菜单打开时点击框外或按 Esc 会取消；附带
Context 被删除、成功发送或聊天关闭时也会取消。旧请求晚到的释放通知必须与当前 Context
匹配，不能清掉用户随后创建的新选区。

选择“解释当前画面”只附加这个画面 Context 并打开公共聊天输入框，不预填、更不会自动
发送默认问题。用户输入的问题才会创建 GenerationTask；该首轮回答会提交为
`video.ai-explanation` Attachment，问题、回答与 `video.frame-region` Anchor 一起保存。
同一聊天内不再携带 Context 的后续追问不会重复创建标注。

视频不复制 Image Workbench 的左键框选模式，也不增加第二个选择状态。右键拖动仍是唯一的
画面框选入口。已完成与执行中的首轮回答通过现有 GenerationTask/Attachment 投影为编号
标注；顶部只提供标注索引与显隐操作。点击索引会暂停视频、跳转到 Anchor 的真实
`timeSeconds` 并恢复归一化矩形。为了避免伪造时间范围，画面标记只在对应时间点附近显示，
不会根据文本长度猜测持续时间。

截帧与图像预处理都发生在本轮任务的工作区中，并沿用现有媒体外部组件与公共视觉区域
处理器。资源不可用、版本变化和取消都会在进入 Agent 调用前终止。

## 7. Attachment 边界

Attachment 是可选结果，不是聊天执行协议：

- EPUB 和 Image 的默认“解释并留下 Note”会设置 `commitAnswer`；Video 的右键框选首轮
  问答同样会提交为带真实时间点的标注；
- Main Context Provider 在 Agent 返回有效答案后创建 Attachment；
- 无 Anchor 的普通追问不设置 `commitAnswer`，不会额外造 Note；
- Attachment 的 pending/failed/retry 状态仍由 GenerationTask 投影，不增加 Attachment Job；
- Document 的“附着回答”也可以继续作为 Renderer 中的显式用户动作。

## 8. 新 Workbench 接入步骤

1. 在 Workbench 的 shared/renderer 侧定义可验证的 Context 数据；
2. 创建一个 `WorkbenchConversationContribution`，声明 Context 展示、定位与源 Asset 策略；
3. 在该 Workbench 的 Main 目录实现 `WorkbenchConversationContextProvider`；
4. 通过该 Workbench 的 `registerGeneration()` 注册 Provider；
5. 如需持久结果，在 Provider 内实现 `commitAnswer()` 并复用 AttachmentService；
6. 测试首轮 Context、无 Context 追问、版本变化、取消、Session 延续与可选 Attachment；
7. 不创建 Workbench 专用聊天 TaskDefinition、历史 Store、聊天 IPC、聊天表或 Provider 直连路径。

## 9. 已移除的重复实现

以下旧任务协议已经删除，不再作为兼容入口：

- `document.question`；
- `html.assistant`；
- `epub.explain-selection`；
- `image.explain-region`。

EPUB 与 Image 的既有 Attachment 视图和 Service 得以保留，但它们现在只观察统一
GenerationTask 的 `contextProviderId + context + commitAnswer`，不拥有第二套 Agent 执行链。

## 10. 核心验收条件

- 所有 Workbench 聊天都创建 `workbench.conversation@1`；
- Main Registry 中每个 `contextProviderId` 唯一且可发现；
- 同一 Conversation 跨 Task 复用同一 Provider Session；
- 新 Conversation 和 Project 之间不串上下文，Asset 版本只约束当轮 Workbench Context；
- Renderer 历史不作为模型历史回灌；
- 不带真实 delta 的 Provider 仍以最终任务结果正确结束；
- Provider 未配置、取消、失败、迟到结果均进入统一 UI 状态；
- Video 不复制完整媒体，精确截帧后才进入 Agent；
- EPUB/Image/Video 的 Attachment 提交不影响无 Anchor 的普通追问；
- 新 Workbench 不需要触碰 bootstrap、公共 TaskDefinition、Project Conversation Store 或聊天 IPC。
