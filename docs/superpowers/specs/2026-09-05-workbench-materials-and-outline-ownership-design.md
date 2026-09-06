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
| 大纲文档、brief、需求收集与草稿 | `workbenches/learning-outline/` | Service、DocumentStore、BriefMonitor、TaskDefinition 和 Renderer Contribution 共同组装 |
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


## 2026-09-06 需求收集完成条件与结构纠错

实际错误文件的 roadmap 使用 chapter/outcomes，缺少契约要求的 id/title。旧指令只列顶层字段，没有完整路线项 schema；旧监测器只向 UI 报通用错误，Agent 无法在同轮获得字段反馈。此次修复保留结构校验，向 Agent 提供完整 schema，并在每轮 flush 后反馈具体错误，最多再修正两次。失败时明确提示仍未保存，不承诺完成；检查点恢复会复用最后一次修正结果，取消仍向上传播。

完成条件由有效已保存 brief 的内容计算：goal、currentLevel、difficulties、constraints、preferences、scope 均已明确，roadmap 至少一项，openQuestions 已清空。readiness 仅为 Agent 建议，不可绕过条件。用户明确没有、不确定或跳过时如实记录；已有信息直接复用，每轮通常只问最关键的缺口，不按轮数结束。

新增可选 detailed 字符串，承接其他字段无法涵盖的后续补充；缺省或空字符串不阻止完成，旧 v1 文件无需迁移。明确属于已有字段的纠正仍更新对应字段。完成后最终回复主动告知，并在大纲及对话状态区显示禁用的“生成大纲 / 即将开放”按钮，不注册生成动作。

所有变化均位于 learning-outline Workbench；通用 Host、IPC、Provider、数据库不增加业务逻辑。

| 行为 | 测试层 | 正常和边界证据 |
|---|---|---|
| schema 与完成判断 | shared.test.ts | 原始 chapter/outcomes 形状；字段路径错误；旧 v1 无 detailed；空白必填、重复 id、未知版本、非法补充、路线与未决问题 |
| 保存与恢复 | BriefMonitor | 完成计算不信任 ready；无效重写保留有效快照；detailed 重启保留；实际 Windows 8.3 watcher 回归 |
| Agent 回合 | TaskDefinition | 完整 schema、修正成功、提前 ready、修正次数上限、取消、修正检查点恢复、完成后继续补充 |
| 文件到结果 | intake-composition.test.ts | 真实文件与 Monitor；模拟 Agent 错写并收到字段反馈后修复；无效文件不入快照；最终保存并提示 |
| 对话状态 | intake-status.test.tsx | 完成按钮、可选补充、无效状态、切换 Asset 的加载和过期响应、按钮不触发任务 |
| Electron 显示 | 独立临时 fixture 窗口 | 实际生产组件和 CSS；缺项隐藏按钮、完整信息显示禁用按钮和补充、无效状态隐藏按钮；未使用用户数据库或真实模型 |

最终验证：大纲相关 8 文件 / 39 测试通过；pnpm check 的 TypeScript、ESLint 通过，406 文件 / 1933 测试通过，4 文件 / 8 测试条件跳过；pnpm package 在 Windows x64 通过。Electron fixture 截图和结果保存在本次本地验证目录 lc-intake-ui-RlR81D。修复的自动验证通过；真实 Agent 的自然多轮提问体验仍交由用户在现有数据窗口验收，不能将 fixture 等同真实模型验收。正式大纲生成继续属于后续范围。


## 2026-09-06 架构审查后的链路收敛

本次修复四个实际可复现的问题：替换 Attachment 时误删引用的用户原文件；Monitor 缓存命中绕过 Project 归属检查；重启且工作副本无效时丢失最近有效需求的展示；切换或关闭 Workbench 后打开等待没有结束。

### 收敛后的调用路径

- Action、Workbench Provider 和 intake TaskDefinition 均只调用 Service 的 `readBriefState(projectId, assetId)`。Service 负责启动 Monitor、刷新工作副本和读取状态，调用方不再拼接 start / flush / get。每个公开读取都校验 Project / Asset，缓存及启动中的请求也不能绕过。
- Monitor 启动时先核验已保存 Attachment 的 brief schema 和内容 revision，恢复最近有效快照，再独立检查 Agent 工作副本。损坏工作副本保持原样并标记无效，界面仍能显示最近有效内容；损坏或丢失的 Attachment 可由有效工作副本修复。
- Attachment 清理传递 Project、Attachment ID 和旧 ref，只删除该 Attachment 所属目录内的文件，并验证真实路径。项目文件、其他 Attachment、经过 junction 指向的外部文件均不会因替换引用而删除。数据库提交后清理失败仍保留新内容，并延后重试。
- WorkbenchOpenCoordinator 只负责当前 Project 内的打开等待；Host 每次打开携带独立 attempt，报告 opening / ready / failed / cancelled。选择改变、页面卸载和旧 attempt 的迟到事件均有明确处理。失败重试复用既有草稿，旧 Host 清理不会取消新的重试。
- 材料能力使用独立 WorkbenchMaterialsProvider 契约与 requireMaterials 校验，普通问答 Registry 仍必须有 prepare。材料上下文直接依赖通用 workspace / asset-reference 类型；普通追问策略及 HTML 编辑指引只由普通 prepare 添加。
- 未知显式 Conversation Mode 显示不可用状态并拒绝打开等待，不降级为普通聊天。生成结果在类型上明确区分 Asset 快照与 Asset ID；可选 conversation 必须包含完整的 ID、mode 和绑定 Asset。
- Main Provider 的通用依赖为必需参数，移除 Learning Outline 的运行时补缺与 AssetLookup fallback。移除未接入的来源修改、通用文档修改、进度操作及未来 workflow / generation 常量。保留 v1 文档读取与展示兼容，不增加迁移，不实现正式生成。

### 新增边界验证

| 行为 | 组合层 | 正常与失败证据 |
|---|---|---|
| 文件归属 | 真实 AttachmentService + ContentFile | 项目原文件、另一附件引用均保留；所属旧文件清理；数据库失败只回滚新文件；junction 原文件保护 |
| 项目隔离 | Action + Service + Monitor + Attachment 文件 | 首次、启动中、已缓存跨项目请求均拒绝；Asset 删除后拒绝 |
| 重启恢复 | Service + Monitor + 实际落盘 Attachment | 无效或缺失工作副本恢复最后有效快照；缺失、无效、revision 不匹配快照重新保存；双重损坏不伪造有效状态 |
| 打开生命周期 | Host + Coordinator | 卸载取消等待、迟到 Session 关闭、不发布旧 ready；重试不受旧清理影响 |
| 创建后重试 | GenerationCenter + 已注册大纲工具 + Coordinator | 取消后解除创建锁，重新打开复用创建结果、保持会话绑定，不重复创建 Asset |
| 模式隔离 | ConversationPanelHost + Runtime | 显式未知模式拒绝等待、显示错误；无普通聊天保存或 Task |
| 材料能力 | Registry + Provider | 不完整注册拒绝；保持方法所属实例；HTML 材料不启用编辑；EPUB/Video 材料不宣称拥有普通对话历史 |
| Electron | 实际 Host / Coordinator / ConversationPanelHost | 取消、迟到会话清理、重开成功和未知模式拒绝；零意外保存、零意外 Task |
| 输入与摘要兼容 | 实际生产 ConversationPanel + intake status | 摘要 128px；输入 24→72→144px，超出滚动、缩窄折行、切换历史和发送清空恢复 |

本次完整检查：TypeScript、ESLint 通过；410 个测试文件 / 1954 项测试通过，4 文件 / 8 项平台或 opt-in 条件跳过。Electron fixture 的本地证据在 lc-chain-smoke/result.json 与 lc-chat-compact-smoke/result.json。真实模型自然多轮验收仍由用户进行；这些确定性验证不声称替代真实 Agent 体验。


### Electron 首次导入的并发安装竞态

当前 Electron 43.2.0 包没有 postinstall，index.js 在 path.txt 或可执行文件缺失时同步启动 install.js。CI 的 pnpm install 完成不代表 Electron 运行时已解压。多个 Vitest worker 首次导入完整 Workbench Catalog 时会并发触发安装，Windows 在同一 dist/locales 目录出现 os error 183，导致 suite 在收集阶段失败。

测试入口改为 `install-electron && vitest run`：先使用包自带 CLI 完成一次串行准备，再启动并行测试。已有安装直接通过；不降低并发、不跳过测试、不使用重试掩盖安装失败。

隔离冷安装实验只复制 Electron 包文件，不修改应用正在使用的 node_modules：8 个进程直接并发导入时 5 个失败；先执行同一 install.js 后，8 个并发导入全部成功，且没有再次下载。证据在本地 lc-electron-install-order-result.json。安装顺序修复后重新运行完整 pnpm check。
