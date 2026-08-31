# Project 右侧插槽与 Audio 布局收敛设计

> 状态：已确认
>
> 日期：2026-08-30

## 问题

Project 页面视觉上应始终保持“左侧资料、中间 Workbench、右侧辅助面板”的三屏骨架，
但当前实现存在三个相互关联的问题：

1. 顶栏 AI 问答按钮受当前 Workbench 是否注册 Conversation Contribution 控制，
   导致 Audio 等没有媒体专用上下文的 Workbench 让 Project 全局聊天消失；
2. ConversationPanel 与 GenerationCenter 是两个独立 flex 子项，打开问答会临时形成第四栏，
   而不是替换右侧辅助面板；
3. Audio Transcript 把 `overflow-y` 放在居中的 `max-w-3xl` 内容列上，侧栏开合后滚动条
   跟随内容列移动，且 Audio 根容器和正文区域没有完整声明横向收缩边界。

## 决策

### 三屏骨架不变

Project 仍只有三个布局位置：

```text
ProjectAssetPanel | AssetWorkbenchHost | ProjectRightPanelSlot
```

右侧插槽保持已有宽度：宽屏内联时为 `clamp(318px, 20vw, 390px)`，中小屏仍以最多
`390px` 的覆盖抽屉出现。本次不增加第四栏、不改变断点，也不增加宽度拖动或持久化。

### 右侧插槽只有一个状态源

`useProjectLayout` 使用以下状态代替独立的 `rightOpen`：

```ts
type ProjectRightPanelKind = 'generation' | 'conversation';
rightPanel: ProjectRightPanelKind | null;
```

- 点击当前已打开的面板按钮会关闭右侧插槽；
- 点击另一个面板按钮会在同一个插槽中直接切换；
- Workbench 内部发起 Conversation 时，Project 把右侧插槽切到 `conversation`；
- Conversation 关闭、Contribution 卸载或 Asset 切换时，右侧 Conversation 插槽同步关闭；
- 小屏打开右侧插槽时继续关闭左侧覆盖栏，遮罩、Escape 和焦点恢复规则不变。

### 顶栏聊天归 Project 所有

AI 问答按钮始终渲染且始终可用。Project 注册一个不依赖 Asset 的默认 Conversation
Contribution 与 Main Context Provider；因此没有媒体专用能力的 Audio、MP3 或空选中状态也能
正常开始 Project 对话。

Workbench 不拥有聊天，只在用户从原文、画面或选区发起提问时临时切换为对应 Context
Provider，并把经过验证的 Anchor/Context 附加到同一个 Project 对话。新的 Workbench
Contribution 注册或卸载不能抢走、关闭正在打开的 Project 聊天。

默认 Project 对话和带 Workbench Context 的对话仍统一经过
`workbench.conversation -> TaskAgentSession`，没有 Provider 直连或媒体专用聊天通道。

### 对话历史只有后端一个持久化来源

`conversationId` 同时是 Project 对话记录 id 与 Agent Workspace instance key：

- 应用数据库的 `project_conversations` 保存标题和 UI 消息投影；
- Agent Session 保存 Provider Session/thread 绑定与真实模型上下文；
- Renderer 只通过 Project Conversation IPC 读取、保存和删除，不把 `localStorage` 当运行期存储；
- 旧的 Workbench/Asset `localStorage` 记录在首次读取时单向导入后端，成功后删除旧键；
- 旧 HTML Workbench 数据由数据库迁移一次性搬入同一张表，旧运行时读写通道删除。

### Audio 滚动与收缩边界

Audio Workbench 根节点和正文区域统一声明 `w-full min-w-0 min-h-0 overflow-hidden`。
Transcript 使用两层结构：

```text
Workbench 全宽滚动视口（scrollbar 位于面板边缘）
  -> 居中的 max-w-3xl 内容列（维持阅读宽度）
```

滚动视口使用稳定 gutter，侧栏开合只改变内容可用宽度，不改变滚动条的所有权，也不让
播放器控制栏参与正文滚动。

## 验证

- 宽、中、小模式默认值与左右覆盖栏规则保持不变；
- generation、conversation、closed 三种右侧状态互斥；
- 任意 Workbench、无选中 Asset 时按钮都存在且可用；
- Workbench 注册不改变已打开 Project Chat 的 owner 或开合状态；
- 历史列表刷新后从后端恢复，不依赖当前 renderer profile 的 `localStorage`；
- `ProjectRightPanelSlot` 每次只渲染一个内容；
- ConversationPanel 填满右侧插槽，不携带第二套固定宽度；
- Audio Transcript 的滚动视口全宽，内容列继续限制阅读宽度；
- 侧栏开合后 Audio Workbench、字幕和播放器控制栏无横向溢出；
- 运行聚焦测试、`pnpm check`、生产打包和真实 Electron 宽度验证。

本设计不改变 GenerationTask、Provider Session 或文件清理协议；它新增统一的 Project
Conversation 数据库/IPC，并只保留一次性旧历史迁移入口。
