# Workbench 材料准备与学习大纲归属设计

日期：2026-09-05

本设计记录 P0–P5 的前置收敛，以及在此前置能力之上接入学习大纲需求收集的边界。学习大纲是与 MindMap 同级的 Asset + Workbench；它不是 Conversation、Bootstrap 或通用 Workbench Context 的内置模式。

## 责任边界

| 能力 | 负责人 | 约束 |
|---|---|---|
| 会话身份、绑定、消息、恢复、取消与持久化 | 通用 Conversation 服务、Session、Controller | 只维护会话生命周期，不判断媒体类型或学习大纲业务 |
| 材料准备 | 各 Workbench Conversation Context Provider | 通过 `prepareMaterials` 独立提供文本、图片、定位、版本校验和工具需求；不提交回答 |
| 普通 Workbench 问答 | 所属 Workbench Provider | 调用自己的 `prepareMaterials`，再添加问答指令和 `commitAnswer` |
| 普通聊天 | Project Conversation Provider | 无 Asset 时保持独立，不虚构一个媒体 Workbench |
| Panel 展示与输入 | 通用 Conversation Panel | 只消费已注册的 mode 和通用运行时；不导入或分支判断具体业务 mode |
| 大纲文档、brief、需求收集、草稿与进度 | `workbenches/learning-outline/` | Service、DocumentStore、BriefMonitor、TaskDefinition 和 Renderer Contribution 共同组装 |
| 大纲创建 | 大纲 Contribution 注册的通用 Workbench Action | 通道只负责按 ID 分发；payload 校验、草稿 Asset、绑定会话和工作区由大纲负责 |

## 材料与问答的两条入口

所有已注册的材料型 Provider 都同时提供独立材料入口和普通问答入口：

`MindMap / Document / HTML / EPUB / Image / Video Provider`

```text
Conversation TaskDefinition
  ├─ provider.prepareMaterials(materialsContext)
  │    └─ 材料、证据说明、Target/sourceRevision 校验、工具需求
  └─ provider.prepare(conversationContext)
       └─ prepareMaterials(...)
          + 所属 Workbench 的 system instruction、问答行为、提交语义
```

`prepareMaterials` 不依赖普通问答的完整 instruction，不切换会话 mode，不扩大工作区权限，不写 Attachment，也不决定何时结束需求收集。普通问答仍可通过 `commitAnswer` 保存解释或标注；非问答消费者只调用材料入口，因此不会继承“直接回答”“不要修改文件”等策略。

材料中的媒体证据规则仍属于所属 Workbench。例如视频的完整帧、标框帧、局部图与字幕上下文由 Video Provider 组合；MindMap 的节点路径、focus 与关联资料定位由 MindMap Provider 组合。共享接口只描述能力，不放媒体分支或业务提示词。

## 大纲的组装与生命周期

Bootstrap 只创建并传入通用能力：Asset、Attachment、Association、Project Conversation、Agent Workspace、Generation Task 和注册表。它不创建 `LearningOutlineService`，也不把大纲字段放入通用 Provider Context。

大纲 Contribution 在 `createProvider` 中组装一个 `LearningOutlineService`，并由同一 Provider 实例提供：

- 大纲 Workbench 打开与命令处理；
- `LearningOutlineDocumentStore` 的受管文档读写；
- `LearningOutlineBriefMonitor` 的稳定工作区恢复、文件校验、串行快照和释放；
- intake `TaskDefinition` 注册；
- 大纲创建 Action 注册；
- Renderer intake mode、生成中心工具和业务 UI 注册。

Contribution 的 `start` 返回该 Service 的运行时，因此应用关闭、启动失败和 Workbench 生命周期都能走同一个 `shutdown/dispose`。通用 IPC 只提供绑定会话和 Workbench Action 两类能力；不存在大纲专属的全局 IPC API。创建路径为：

```text
Generation Center
  → registered learning-outline action
  → outline Contribution / LearningOutlineService.createDraft
  → draft Asset + one bound intake Conversation
  → outline Renderer opens the bound conversation
  → intake TaskDefinition lets the Agent maintain learning-brief.json
  → BriefMonitor validates and snapshots the file
```

草稿创建和需求收集属于本阶段；正式生成需要用户显式确认不可变 brief/source 快照，随后再由独立生成任务实现，不在 intake 中伪造完成。

## 绑定与临时材料的身份

- `boundAssetId` 是大纲会话的固定工作对象，普通 save 不能改写。
- Conversation message 的 context/source 只是当轮临时材料，不改变 mode、绑定 Asset 或工作区。
- 正式大纲来源由大纲自己的关联关系管理，不从聊天文本或当前选中 Asset 推断。

因此，大纲聊天注入 MindMap 节点时仍保持 intake mode、绑定大纲和会话工作区不变；一般聊天注入相同节点时仍使用一般聊天自身的问答 Provider。

## 回归证据与未覆盖范围

阶段门禁前的边界矩阵如下：

| 行为 | 测试层 | 成功路径 | 边界/失败路径 | 证据 |
|---|---|---|---|---|
| 材料与普通问答解耦 | Provider + Catalog | 六类 Provider 均注册 `prepareMaterials`；MindMap 两种消费者复用同一材料 | 目标/版本不匹配仍拒绝；材料消费者没有问答提交提示 | `mindmap-conversation-context-provider.test.ts`、Catalog 测试 |
| 会话绑定 | Service + Database + IPC | 按 Project/Asset/Mode 恢复同一会话 | 跨 Project、改绑定、同 Asset 同 Mode 重复写入均拒绝 | Project Conversation 测试 |
| brief 工作区 | Workbench Monitor | 恢复、原子/重复写入去抖、有效快照和 ready 状态 | JSON/结构错误标 invalid；shutdown/dispose 清理 watcher | `learning-outline-brief-monitor.test.ts` |
| 大纲接线 | Main/Renderer composition | Contribution 创建、打开、事件转发、启动和释放同一业务 Service | 非匹配 Asset / 无效 Workbench payload 拒绝 | `learning-outline/main.test.ts`、IPC/Catalog 测试 |
| 临时资料注入 | Renderer TaskAdapter | MindMap 节点及其引用资料进入 intake | 绑定 mode、Asset 和 conversation 身份不被替换 | `learning-outline/conversation/intake-mode.test.ts`、Controller 测试 |
| 数据库兼容 | Migration | 新库和旧版本迁移到 28 | 29 及以上版本拒绝；外键随 Asset 删除解绑 | `initialize-database.test.ts`、Project Conversation Database 测试 |

回归测试覆盖六类 Provider 的注册和材料入口、MindMap 的材料/问答组合、视频/图像/文档等已有目标及版本校验、通用 Panel 的 mode 注册、绑定会话持久化、草稿创建动作和 brief 监测释放。`pnpm check`、涉及 Main/Preload 的 `pnpm package` 和目标 worktree 的完整测试作为阶段门禁执行。

本阶段不包含正式大纲生成、候选发布、完成进度迭代及真实 Electron 点击验证；这些属于计划中的后续阶段，不能由类型检查或启动进程替代。
