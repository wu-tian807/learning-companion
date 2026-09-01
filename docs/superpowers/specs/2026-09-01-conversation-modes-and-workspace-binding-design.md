# Conversation Mode 与 Workspace Binding

日期：2026-09-01
状态：基础架构已实现

## 1. 目标

普通 Project 问答、未来的学习大纲规划等体验需要复用相同的消息、历史、流式展示、
停止、重试和恢复能力，但不能共享固定的提示词、Task 协议、界面文案或 Agent
Workspace。

本设计把 Conversation 拆成四个独立概念：

```text
ConversationSession（通用生命周期）
  + ConversationMode（任务协议与结果解释）
  + WorkspaceBinding（稳定 Workspace / Provider Session 实例）
  + UI Surface（右侧面板、弹窗或生成中心内嵌界面）
```

Workbench Context 仍然只是一条消息的可选媒体上下文，不成为 Conversation Mode，
也不拥有聊天历史或工作区。

## 2. Conversation Mode

Renderer 中的 `ConversationModeDefinition` 声明：

- 稳定 `modeId`；
- 把通用 Conversation Turn 转为具体 GenerationTask request 的 Task Adapter；
- 从已完成 GenerationTask 读取权威最终回答；
- 默认标题、空状态和输入框文案。

通用 Controller 只负责消息和任务生命周期，不再硬编码
`workbench.conversation` request 或结果结构。Mode 不能在已有 Controller 中原地切换；
需要另一种 Mode 时必须创建另一条 Conversation。

`project.general` 是现有 Project 问答的默认 Mode，行为保持不变。未来的
`learning-outline.planning` 可以使用不同 TaskDefinition 和 UI Surface，而无需复制
Conversation Controller。

## 3. Workspace Binding

Conversation 可以持久化一个可选绑定：

```ts
interface ConversationWorkspaceBinding {
  readonly instanceKey: string;
}
```

边界如下：

- Mode 对应的 TaskDefinition 决定 Workspace `key`、权限和工具；
- Conversation 只能选择该命名空间内的 `instanceKey`；
- Renderer 不提交绝对路径，也不能修改读写权限；
- `instanceKey` 同时定位 Agent Workspace 和 Provider Session；
- 未提供绑定的普通问答继续使用 `conversationId`；
- 已持久化 Conversation 的 `modeId` 和 Workspace Binding 不可修改；
- 默认绑定发生变化时，只影响之后新建的 Conversation。

因此，“切换工作区”实际创建新 Conversation，而不是让已有 Provider Session 在保留
旧模型上下文的同时访问另一份目录。

## 4. 持久化与恢复

`project_conversations` 保存：

- `mode_id`；
- 可选的 `workspace_binding_json`；
- 原有标题、消息和时间。

Migration 26 为旧记录补上 `project.general`，不为其制造显式 Workspace Binding，因而
旧记录仍按 `conversationId` 恢复。Database 拒绝用相同 Conversation id 改写 Mode 或
Workspace，避免重试、恢复和 Provider Session 指向不同执行环境。

History Store 可以保存多个 Mode；具体 ConversationSession 只展示与自身 Mode 相同的
记录。UI 消息仍然只是本地投影，不会重新作为模型历史回灌。

## 5. UI 复用

`ConversationSession` 是无界面的生命周期组件，调用方通过 render function 决定界面：

- Project 右侧面板继续渲染 `ConversationPanel`；
- 未来生成中心可以渲染带“已确认需求”区域的专用界面；
- 两者共享发送、停止、重试、最终结果、持久化和恢复行为。

`ConversationPanel` 接收 Mode Presentation，因此可以复用布局而不把“学习大纲”等业务
文案写入公共组件。

## 6. 本轮不实现

- 普通聊天的 Workspace 选择 UI；
- MindMap 节点上下文；
- 多 Asset Workspace 投影；
- 学习大纲规划 Mode 和结构化需求状态；
- 在同一 Conversation 中切换 Mode 或 Workspace；
- 让 Agent 写入正式 Asset 或数据库。

这些能力后续通过新的 Mode、TaskDefinition 和 Context Contribution 接入，不改变本轮
建立的 Conversation 生命周期边界。
