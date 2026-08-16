# Workbench 共享聊天基建与 Document AI 体验整改记录

日期：2026-08-12  
状态：实测问题已确认；共享基建方向待拆分为实现计划

## 1. 结论

PR #18 合入后，PDF Document AI 的核心技术链路已经跑通：

```text
PDF Anchor
  -> DocumentQuestion TaskDefinition
  -> GenerationTask
  -> AgentProvider / Codex Session
  -> assistantOutput
  -> Renderer Conversation
  -> 可选 Attachment
```

但是当前实现只能视为“功能链路可用”，不能视为“即时问答体验可用”。问题并不只是样式粗糙，而是用户无法稳定理解：

- 哪个操作打开了聊天；
- 当前问题对应原文的哪个位置；
- Agent 正在做什么；
- 为什么失败；
- 一条回答保存后出现在哪里。

同时，PDF、Office、HTML、EPUB 及后续其他 Workbench 都会需要问答、连续追问、取消、错误、流式输出和 Attachment 等能力。如果继续由每个 Workbench 各写一套 Chat Store、面板和 GenerationTask 编排，交互语义和故障处理会持续分叉。

因此后续应建立一套 **Workbench 共享聊天基建**。共享层统一对话运行机制和基础 UI，但不吞并媒体 Anchor、TaskDefinition、工具、提示词和 Attachment 业务语义。

## 2. 本次真实验收范围

验收基线：`main` 的 PR #18 合并提交 `d566372`。

本次完成：

- PDF 区域框选；
- 快捷提问和自由追问；
- Workbench Provider Selector；
- 两次连续问答的 Codex Session 复用；
- 回答创建 `ai.annotation` Attachment；
- Attachment 文件、数据库记录、原文标记和详情弹窗；
- `pnpm check`。

本次没有完成真实 UI 验收：

- Office 文档问答；
- 清空与取消的完整竞态场景；
- 应用重启后的聊天展示行为。

自动化结果为 233 个测试文件通过、966 项通过、1 项跳过；类型检查和 lint 通过。自动化通过并未覆盖下述关键体验问题。

## 3. 已验证正常的能力

### 3.1 GenerationTask 主链路正确

Document AI 没有绕过领域层直接调用 Provider。当前链路是：

```text
Renderer
  -> document-ai IPC
  -> GenerationTaskService.create/run
  -> document.question TaskDefinition.process
  -> context.agent.call
  -> Provider
```

这条路径应保留。共享聊天基建不能变成一条新的 Provider 直连捷径。

### 3.2 连续上下文确实有效

实测两次问答分别创建两个 `document.question` GenerationTask，但数据库中的两个任务使用了同一个 Provider Session ID。

这符合既定模型：

- 一次用户请求对应一个 GenerationTask；
- Conversation 使用稳定 `conversationId`；
- TaskDefinition 用该 ID 解析稳定 `instanceKey`；
- 不同 GenerationTask 可以继续同一个 Provider Session；
- 应用不需要把旧消息重新拼回 Prompt 来模拟上下文。

### 3.3 Attachment 主链路有效

“附着整段”能够：

- 创建 `asset_attachments` 数据库记录；
- 将正文写入 Project Workspace 下的独立 `annotation.json`；
- 保存 `pdf.region` Anchor；
- 在 PDF 上渲染 Anchor 标记；
- 点击标记后读取完整正文。

Attachment 继续只负责结果和定位，不负责 GenerationTask 的 pending、failed、retry 状态。

## 4. 已确认的体验问题与代码根因

### 4.1 框选结束会隐式打开 AI 面板

严重度：高

当前 `src/workbenches/pdf/renderer.tsx` 的 `finishPointerInteraction()` 在用户松开鼠标后立即执行：

```text
setRegionSelection(undefined)
setPendingAnchor(...)
setPanelOpen(true)
setRegionActionMenu(...)
```

因此用户只是完成框选、尚未点击“解释”或“自由提问”，AI 问答面板就已经打开。快捷按钮随后只是发送问题，并不是打开面板的真实入口。

这造成了三个问题：

1. 用户不知道面板由什么操作触发；
2. 文档区域被突然压缩，没有过渡或解释；
3. “框选”和“开始 AI 对话”被错误地绑定成同一个意图。

期望行为：

- 框选结束只保存临时 Anchor，并显示选区与快捷菜单；
- 点击快捷问题或自由提问后才打开聊天面板；
- 面板应从 Workbench 内部明确展开，并显示“正在针对此选区提问”。

### 4.2 框选完成后选区立即消失

严重度：高

`finishPointerInteraction()` 在保存已完成区域之前先执行 `setRegionSelection(undefined)`。当前 `regionSelection` 既承担拖拽过程预览，也被当作唯一的选区视觉层；拖拽结束后没有独立的 committed selection 状态。

结果是：用户刚刚框选的区域消失，而右侧对话仍声称在处理“框选内容”。用户无法确认问题对应哪里。

期望拆分：

```text
dragSelection       仅在拖拽期间存在
committedSelection  拖拽完成后持续高亮
pendingAnchor       下一次问题携带的领域 Anchor
attachmentMarkers   已持久化 Attachment 的 Anchor
```

`committedSelection` 至少应保留到以下任一时机：

- 用户主动取消；
- 用户创建新选区；
- 对话清空并明确放弃当前 Anchor；
- Attachment 接管该 Anchor 的持久显示。

### 4.3 Provider 未配置时静默失败

严重度：阻断

实测首次请求产生 `AGENT_PROVIDER_SELECTION_REQUIRED`，但界面只留下用户问题，没有错误消息、重试按钮或设置入口。

根因位于 `src/workbenches/document-ai/renderer/ai-chat/AiChatPanel.tsx`：`sendDocumentAiMessage()` 捕获异常后只执行：

```text
setLoading(false)
console.error(...)
return false
```

错误没有进入 Chat Store，也没有被映射为用户可见状态。

期望行为：

- 用户消息后出现对应的 failed 回答占位；
- 显示可理解的错误文案；
- `AGENT_PROVIDER_SELECTION_REQUIRED` 提供“打开设置”；
- 可重试错误提供“重试”；
- 重试原 GenerationTask，而不是悄悄再造一条无关请求。

### 4.4 Workbench Selector 呈现为已选，实际尚未配置

严重度：高

首次打开设置时，“工作台 AI”已经显示现有 Connection、模型和思考力度，但在用户点击“应用”前没有持久化 Selection。界面给出的视觉语义是“已经选好”，运行时语义却是“未配置”。

需要满足以下二选一：

1. 如果系统决定提供默认值，就在注册 Selector 时真正保存默认 Selection；
2. 如果必须由用户确认，就明确显示“未配置”，不能用看似有效的表单值伪装成已配置状态。

Connection 的 ready 状态、Selector 的 Selection 和模型配置仍应保持解耦。本问题不是要求 Workbench 继承生成中心，而是要求界面与真实持久化状态一致。

### 4.5 即时问答延迟高且完全没有过程反馈

严重度：高

本次使用 `gpt-5.6-sol / high` 实测：

- 首次回答约 47.5 秒；
- 同一 Conversation 的追问约 14.5 秒。

当前 UI 只显示三个跳动圆点并禁用输入框，没有：

- 可取消入口；
- GenerationTask 阶段；
- 工具活动摘要；
- 已耗时；
- assistant delta；
- 后台继续的能力。

现有数据不能证明 47.5 秒全部来自“多余探索”。首次 Session 创建、Workspace prepare、PDF 工具调用、模型档位和 Agent 自主行为都可能占用时间。在得到 Provider 事件和工具调用 metrics 前，不应武断归因。

但是可以确定：**即使后端耗时无法立刻降低，当前无反馈等待也会破坏即时问答体验。**

后续需要同时处理：

- TaskDefinition 是否给了过宽的执行空间；
- 即时问答是否需要更窄的提示词和工具需求；
- GenerationTask 如何按业务选择发布 assistant/runtime 事件；
- 无真实 delta 时如何显示可靠的阶段状态，而不是伪造流式文本。

共享聊天层不能设置全局 Agent 策略。工具、Workspace、提示词和 Agent 自由度仍由每个 TaskDefinition 决定。

### 4.6 “标注 1”固定悬浮在应用右下角

严重度：中高

`src/workbenches/document-ai/renderer/AttachmentHost.tsx` 使用 Portal 把汇总按钮渲染到 `document.body`，并使用：

```text
position: fixed
bottom: 5rem
right: 1.25rem
```

因此按钮不是 Workbench 内部布局的一部分，而是覆盖整个应用右下角，可能遮挡生成中心。名称“标注 1”也没有说明它来自当前 PDF、某个原文选区还是 AI 回答。

期望行为：

- Anchor 标记继续由具体 Workbench 放在原文附近；
- 标注列表应进入 Workbench 自己的可控侧栏或工具栏；
- 不允许通过全局 fixed Portal 覆盖其他业务面板；
- 汇总入口至少显示类型或问题摘要，而不只是数量。

### 4.7 Chat Store 的 UI 状态作用域不清楚

严重度：中

当前 `chat-store.ts` 的消息 Session 按 Asset 区分，但以下字段是全局单例状态：

- `panelOpen`；
- `draft`；
- `selectedAnswerRange`。

这意味着“哪个 Asset 的面板打开”“哪个 Asset 的草稿”和“哪条回答正在被选中”没有完整绑定到 Conversation。切换 Workbench 或 Asset 后容易出现状态继承、面板意外保持打开或草稿串位。

共享基建应以 `conversationId` 为状态主键；面板是否打开属于使用它的 Workbench Host，而不是全局 Conversation Store。

## 5. 为什么需要共享聊天基建

下面这些需求几乎会在所有带 AI 的 Workbench 中重复出现：

- Provider Selector readiness；
- 一次消息创建一次 GenerationTask；
- 稳定 Conversation 到 Provider Session 的延续；
- 用户消息、assistant 最终回答和可选 delta 的投影；
- pending、failed、cancelled、retry；
- 并发请求和迟到回答隔离；
- 清空对话与创建新 Conversation；
- Markdown、公式、复制和选中回答；
- Panel、Composer、Message List 和空状态；
- GenerationTask 运行事件订阅；
- 错误映射和设置入口；
- 可选 Attachment 动作。

这些属于共享机制，不应由 PDF、Office、HTML、EPUB 分别重新实现。

## 6. 共享层与 Workbench 的职责边界

### 6.1 共享聊天层负责

- Conversation UI 状态机；
- 每条用户消息对应的 GenerationTask ID；
- 提交、取消、重试和迟到结果去重；
- GenerationTask 状态与可选 assistant 事件的 Renderer 投影；
- 通用消息模型和错误消息；
- 通用 Chat Panel、Message List、Composer 和运行状态；
- Provider Selector 未配置时的统一引导；
- `conversationId` 创建、清空和传递；
- 通用 Markdown/公式展示；
- Workbench 扩展动作插槽。

### 6.2 具体 Workbench 负责

- 什么操作打开聊天；
- Anchor 如何创建、保持、定位和取消；
- 快捷问题有哪些；
- Instruction 如何组合用户问题、选区和媒体上下文；
- 使用哪个 TaskDefinition；
- AssetReference 如何传入；
- 需要哪些工具、Skill、MCP 和 Workspace；
- 回答是否允许附着，以及创建什么 Attachment；
- 标注如何在该媒体中渲染；
- 面板放在 Workbench 的哪个位置。

### 6.3 共享层明确不负责

- 不直接调用 AgentProvider；
- 不绕过 `TaskDefinition -> GenerationTask -> AgentProvider`；
- 不用 Renderer 消息历史重建 Provider 上下文；
- 不拥有 Codex/Claude 的 Thread；
- 不解释 PDF 页码、EPUB CFI、HTML DOM、视频时间码等 Anchor；
- 不替 Workbench 自动创建 Attachment；
- 不施加全局工具或权限策略；
- 不要求所有任务发布 delta。

## 7. 建议的概念模型

```ts
interface WorkbenchConversationDescriptor<TInput> {
  readonly id: string;
  readonly providerSelectorId: string;
  readonly taskDefinition: {
    readonly id: string;
    readonly version: number;
  };

  createTaskInput(input: TInput): {
    readonly instruction: JsonValue;
    readonly assetReferences: AssetReferenceInput;
  };
}

interface ConversationViewState {
  readonly conversationId: string;
  readonly messages: readonly ConversationMessageView[];
  readonly activeTurn?: {
    readonly generationTaskId: string;
    readonly status: 'queued' | 'running' | 'failed' | 'cancelled';
    readonly startedTime: number;
  };
}
```

一次发送的标准链路应为：

```text
Workbench 创建媒体语义输入
  -> Shared Conversation Controller 创建 GenerationTask
  -> TaskDefinition 解析 Instruction
  -> GenerationTask 使用稳定 conversationId 定位 Session
  -> Provider 执行
  -> Shared Controller 投影运行状态和最终回答
  -> Workbench 决定是否附着或进行其他媒体动作
```

这里的 Conversation Controller 只是业务运行与 UI 投影基建，不是新的 Provider Session 管理器。

## 8. 消息、Session 与持久化决策

当前继续坚持以下边界：

- Provider Thread/Session 是模型上下文的事实来源；
- `conversationId` 是跨 GenerationTask 延续上下文的稳定业务键；
- GenerationTask 记录每次请求的状态、Session ID、Provider、模型和 metrics；
- Attachment 只保存用户明确留下的结果；
- Renderer 消息不得被重新拼入 Prompt 来“恢复上下文”。

尚未决定的是：应用重启后是否恢复聊天的可视化历史。

如果未来需要恢复展示，可以：

1. 从 Provider Thread 读取投影；或
2. 保存只用于 UI 展示的 Conversation Projection。

无论选择哪一种，该 Projection 都不能取代 Provider Session，也不能成为重复注入上下文的来源。

## 9. 流式输出与即时反馈

共享基建需要支持而不是强迫流式：

- 文件型 GenerationTask 可以完全不发布 assistant 正文；
- 即时聊天可以请求 `assistant runtime events`；
- Provider 有真实 delta 时逐步展示；
- Provider 只有最终文本时展示 completed snapshot；
- 不能把结束时的一整块文本伪装成真实逐字流；
- 无论是否有 delta，都必须展示任务阶段、耗时、取消和错误。

具体 TaskDefinition 是否发布 assistant 输出，应由该任务自己声明，不能成为 Provider 的全局默认策略。

## 10. 首轮整改顺序

### 阶段 A：先修复 Document AI 的破坏性体验

1. 框选不再自动打开 Chat Panel；
2. 引入 committed selection，高亮不随 pointer up 消失；
3. 请求失败进入可见的 Message 状态；
4. Selector 的视觉状态与持久化状态一致；
5. 标注汇总入口移回 Workbench 布局；
6. 显示任务耗时、取消和明确运行状态。

### 阶段 B：抽取共享 Renderer 基建

1. 抽取 Conversation Controller/Store；
2. 抽取通用 Chat Panel 和消息组件；
3. 接入 GenerationTask 状态与 assistant 事件；
4. 将打开状态改成受控属性，由 Workbench Host 持有；
5. 保留 Workbench Action、Anchor 和 Attachment 扩展插槽。

### 阶段 C：迁移现有功能

1. PDF/Office Document AI 先迁移；
2. HTML 自由问答接入同一基建；
3. EPUB 保留“一次解释 Note”语义；只有新增显式 Conversation 时才接聊天面板；
4. 其他 Workbench 不再自行创建第二套消息 Store 和 Provider 调用路径。

## 11. 最低验收标准

共享聊天基建及 Document AI 整改完成前，至少覆盖：

- 框选结束不会自动打开聊天；
- 点击快捷问题后才打开，并持续显示对应 Anchor；
- 未配置 Provider 时界面明确报错并能打开设置；
- 两个 GenerationTask 使用同一 Conversation 时复用同一 Provider Session；
- 新建 Conversation 后使用新的 Session 边界；
- 切换 Asset 不串消息、草稿、选区或 loading；
- 清空/关闭会取消活跃任务，迟到回答不能重新写回；
- retry 使用原 GenerationTask 的恢复机制；
- 有 delta 和无 delta Provider 都能正确结束；
- Attachment 创建失败不会伪装成回答失败，反之亦然；
- 标注入口不覆盖生成中心或其他 Workbench；
- PDF、Office、HTML 和 EPUB 的媒体 Anchor 均由各自 Workbench 负责；
- Windows 和 macOS 的完整测试与打包检查通过。

## 12. 相关设计

- `2026-08-08-generation-task-process-execution-design.md`
- `2026-08-10-generation-assistant-output-delivery-design.md`
- `2026-08-10-epub-explanation-foundation-design.md`
- `2026-07-29-workbench-interaction-facilities-design.md`

本记录不推翻上述 GenerationTask、Session、Attachment 和 Workbench Anchor 边界；它补充的是共享聊天的 Renderer/业务编排层，以及 PR #18 暴露出的实际交互缺陷。
