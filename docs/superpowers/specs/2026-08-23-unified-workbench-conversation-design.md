# 统一 Workbench Conversation 架构

日期：2026-08-23
状态：已实现

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

这条链路没有新增聊天数据库表、Provider 直连 IPC 或媒体专用任务通道。

## 2. 三层职责

### 2.1 Renderer Workbench ConversationContribution

只负责浏览器侧和媒体 UI 语义：

- 声明 `contextProviderId`；
- 决定首次提问是否必须有 Context；
- 校验 Context 是否属于当前 Asset 版本；
- 描述、定位和清理 Anchor；
- 决定是否需要把源 Asset 作为引用送入工作区；
- 决定本轮回答是否需要提交为 Attachment；
- 提供只用于 UI 展示的 Conversation History Store。

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
- Renderer 历史只是 UI 投影，不会重新拼回 Prompt；
- 新 Conversation 使用新的 `conversationId`，因此形成新的 Session 边界。

Context 只在用户创建新 Anchor 时传入。后续追问可以不再附带 Context，Context Provider
会提示 Agent 继续使用同一 Session 中已有的媒体语境。

## 5. AssetReference 策略

是否把当前源 Asset 物化进 Agent Workspace 由 Renderer contribution 显式声明：

- 文档和静态图片可以使用 `includeSourceAssetReference: true`；
- 视频帧问答使用 `false`，避免把完整视频复制到 Agent Workspace；
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
发送默认问题。用户输入的问题才会创建 GenerationTask。

截帧与图像预处理都发生在本轮任务的工作区中，并沿用现有媒体外部组件与公共视觉区域
处理器。资源不可用、版本变化和取消都会在进入 Agent 调用前终止。

## 7. Attachment 边界

Attachment 是可选结果，不是聊天执行协议：

- EPUB 和 Image 的默认“解释并留下 Note”会设置 `commitAnswer`；
- Main Context Provider 在 Agent 返回有效答案后创建 Attachment；
- 普通追问不设置 `commitAnswer`，不会额外造 Note；
- Attachment 的 pending/failed/retry 状态仍由 GenerationTask 投影，不增加 Attachment Job；
- Document 的“附着回答”也可以继续作为 Renderer 中的显式用户动作。

## 8. 新 Workbench 接入步骤

1. 在 Workbench 的 shared/renderer 侧定义可验证的 Context 数据；
2. 创建一个 `WorkbenchConversationContribution`，声明 Context 展示、定位与源 Asset 策略；
3. 在该 Workbench 的 Main 目录实现 `WorkbenchConversationContextProvider`；
4. 通过该 Workbench 的 `registerGeneration()` 注册 Provider；
5. 如需持久结果，在 Provider 内实现 `commitAnswer()` 并复用 AttachmentService；
6. 测试首轮 Context、无 Context 追问、版本变化、取消、Session 延续与可选 Attachment；
7. 不创建新的聊天 TaskDefinition、聊天 IPC、聊天表或 Provider 直连路径。

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
- 新 Conversation、Asset 版本和 Project 之间不串上下文；
- Renderer 历史不作为模型历史回灌；
- 不带真实 delta 的 Provider 仍以最终任务结果正确结束；
- Provider 未配置、取消、失败、迟到结果均进入统一 UI 状态；
- Video 不复制完整媒体，精确截帧后才进入 Agent；
- EPUB/Image 的 Attachment 提交不影响普通追问；
- 新 Workbench 不需要触碰 bootstrap、公共 TaskDefinition 或聊天 IPC。
