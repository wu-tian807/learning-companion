# 生成中心后续方案讨论记录

> 日期：2026-08-02
>
> 状态：方向记录，尚未拆分为正式实施规格

## 1. 记录目的

今天已经完成思维导图生成前的资料选择和输入收集 UI。下一阶段需要把现有的
Generation Center、Codex Provider、Agent Lane、AgentContextProjection、
Mind Map Workbench 和 Asset Association 基座串成第一个真实生成闭环。

本文记录今天已经达成的方向、仍需单独设计的问题和推荐实施顺序。它不是可直接
照抄的数据表或 IPC 规格；每个阶段进入编码前仍需独立设计、边界审查和测试拆分。

相关现有设计：

- [Mind Map 生成输入 UI 设计](../superpowers/specs/2026-08-02-mind-map-generation-input-ui-design.md)
- [Codex Agent Runtime、Agent Lane 与 Memory 方向](../superpowers/specs/2026-07-30-codex-agent-runtime-and-lanes-design.md)
- [AssetReference、AssetLink 与 Mind Map 基础结构设计](../superpowers/specs/2026-08-01-asset-link-mind-map-foundation-design.md)
- [Project Workspace 与 ContentRef 设计](../superpowers/specs/2026-07-30-project-workspace-and-content-ref-design.md)

## 2. 当前已经完成的入口

Renderer 当前可以构造 Provider 无关的轻量输入：

```ts
interface MindMapGenerationDraft {
  readonly projectId: string;
  readonly sourceAssetIds: readonly string[];
  readonly additionalInstructions?: string;
}
```

已确认的约束：

- 来源由用户在左侧 imported Asset 面板显式勾选；
- 没有选择时，思维导图工具负责引导用户进入资料选择模式；
- 确认弹窗只展示打开瞬间的来源快照，不维护第二套复选状态；
- 来源数量由 `sourceAssetIds.length` 得到，不保存冗余字段；
- 用户补充要求只去除首尾空白，不预设字数上限；
- Renderer 不读取或发送 Asset 全文、文件路径、Revision 或 Codex DTO；
- 当前确认操作只形成 Draft，尚未创建任务或生成 Asset。

这意味着后续真实生成入口应直接承接现有 Draft，而不是重新设计一套前端请求。

## 3. 核心新增层：GenerationTask

### 3.1 Task 与 Asset 分离

生成中的对象应是 `GenerationTask`，而不是一个处于 `generating` 状态的 Asset。

原因：

- Task 表示一次有开始、进度、失败、取消和恢复语义的执行；
- Asset 表示用户可以长期打开、引用和迁移的稳定学习内容；
- 失败任务不应该在 Project 中留下损坏或半成品 Asset；
- `AssetContentStatus` 继续只表达正式 Asset 内容的可用性，不混入执行状态。

只有输出完成校验并成功提交后，系统才创建真实的
`creationKind === 'generated'` Asset，并把它显示到右侧生成内容列表。

### 3.2 通用任务而非 Mind Map 专用任务

GenerationTask 应服务所有经 Agent 运行的生成操作，例如：

- Project 级思维导图、学习提纲、摘要和知识卡片；
- Mind Map 节点或 Frame 的详细 HTML 讲义；
- 后续 Workbench 专属的生成、解释或重做操作。

任务领域模型不能直接使用 Codex Thread、Turn 或 Event DTO。Provider Adapter
负责把应用定义的任务输入和事件翻译为 Codex App Server 协议。

### 3.3 任务需要持久化

任务至少需要支持：

- 应用重启后仍能看到历史状态；
- 保存请求来源、补充要求和任务种类；
- 记录创建、开始、结束时间；
- 记录当前阶段、可展示进度和结构化失败原因；
- 记录 Provider、模型、耗时和可获得的用量信息；
- 区分可重试、可恢复、已中断和终态任务；
- 避免应用退出后把所有运行中任务静默当成成功或永久卡住。

具体状态枚举、恢复语义、事件日志颗粒度和数据库 Schema 尚未确定，应在
GenerationTask 独立规格中设计。不要仅为了展示进度保存完整 Codex
Conversation；Conversation 的事实来源仍是 Codex Runtime。

## 4. 从 Asset ID 到 Agent 可读上下文

### 4.1 Main 重新校验输入

Renderer Draft 不是可信事实来源。Main 收到请求后必须：

1. 校验 Project 当前有效；
2. 去重并逐个加载 `sourceAssetIds`；
3. 校验 Asset 属于该 Project；
4. 检查内容可用性并固定必要 Revision；
5. 根据媒体类型选择可读内容转换能力；
6. 为本次执行构造只读 AgentContextProjection。

本轮不在 Renderer 预先按媒体类型过滤来源。真正无法读取的格式由 Main 返回可理解
的用户错误，不能让 Codex 猜测缺失内容。

### 4.2 Projection 是受控视图

选中的 Asset 需要被转换为 Codex 可使用的工作区投影。投影可以包含：

```text
project.md
request.md
assets.json
sources/
  <stable-name>/
    metadata.json
    content.md | content.txt | extracted-content.json
```

具体目录和文件名待单独设计，但边界已经明确：

- Agent 看见的是本次允许读取的投影，不是 SQLite 或整个用户目录；
- 投影不是第二份事实来源，可以在任务结束后重建或删除；
- 原始 Asset 默认只读；
- PDF、Office、HTML 等资料需要走对应的解析或派生内容能力；
- 不把所有 Project Asset 无条件投影，只处理用户明确选择和任务按权限追加的内容；
- Agent 可以对投影使用熟悉的文件读取和搜索工具，但不能因此获得任意文件系统权限。

### 4.3 不提前锁死 Lane、Session 与 Projection 基数

现有基线把 `creator` / `tutor` Lane 定义为 Project 级长期产品上下文，并为每个
Provider 保存不透明 Thread Ref。今天进一步提出：一个 Lane 未来可能承载多个执行
Session，不同 Session 也可能使用不同的 Projection 目录。

该基数今天没有定案。后续设计必须区分：

```text
Agent Lane
    产品中的长期角色与上下文

Provider Thread
    Provider 持有的长期会话引用

Generation Task / Execution Session
    一次可恢复、可统计的具体执行

AgentContextProjection
    某次执行被允许读取的临时文件视图
```

GenerationTask 第一版不应写死“一条 Lane 永远只有一个执行 Session 或一个固定工作
目录”。同时也不应在没有真实需求前实现复杂的多 Session 调度器。

## 5. Mind Map 的真实生成与提交

### 5.1 Agent 只产生受约束草稿

Creator Lane 的第一次纵向闭环建议选择 Mind Map。Codex 的目标不是直接写数据库或
覆盖正式文件，而是生成受约束的 `MindMapDocumentV1` 草稿或等价结构化输出。

应用需要校验：

- format 和 version；
- `rootNodeId`、节点 ID 和严格有序树结构；
- 节点标题、正文和父子关系的合法性；
- Frame 与 Association 引用；
- 文件编码、大小和其他资源限制；
- 任务开始后来源 Asset 是否发生冲突性变化。

无法通过校验的输出属于任务失败或可修复草稿，不能发布成正式 Asset。

### 5.2 Staging 与正式提交

推荐的提交顺序：

```text
GenerationTask 运行
→ Codex 输出到任务 staging 区
→ 应用解析并校验 MindMapDocumentV1
→ 准备 generated Asset 文件
→ 创建 Asset 记录
→ 为所有来源创建 AssetReference
→ 原子发布正式文件和关系
→ Task 标记成功并返回 generated Asset ID
```

跨 SQLite 与文件系统无法依靠单一数据库事务完成，正式规格必须选择 staging
manifest、原子重命名和失败补偿策略。任何失败都不能留下“数据库有 Asset、文件却
不存在”或“文件已发布、关系却缺失”的静默半提交状态。

### 5.3 生成中心的运行中展示

生成中心未来需要同时表达两类对象：

- `GenerationTask`：排队、运行、失败、可重试或已中断；
- generated Asset：已经提交并可正常打开的稳定内容。

二者可以在视觉上处于同一右侧区域，但数据类型和操作必须分开。任务完成后由真实
generated Asset 接替，不通过伪造 Asset 状态实现动画。

## 6. Mind Map 节点到详细讲义

Mind Map Workbench 的首个专属生成能力是：用户选中一个节点或 Frame，生成更详细
的 HTML 讲义。

建议数据流：

```text
Mind Map Node / Frame Anchor
→ Workbench generation contribution
→ GenerationTask
→ Creator Lane + 本次目标的上下文 Projection
→ HTML 讲义草稿与校验
→ 创建 generated HTML Asset
→ 创建 Mind Map → HTML 的 AssetLink
→ 把 linkId 绑定到对应 Node 或 Frame association
```

这样可以满足：

- Mind Map 仍是横向展开的知识树；
- 节点负责快速展示知识结构；
- 用户按需把某个节点扩展成详细讲义；
- 讲义是独立可打开的 Asset，不被埋在聊天记录中；
- Mind Map 通过 AssetLink 保留到讲义的稳定导航；
- 单节点绑定 Node，多节点范围绑定 Frame，不重复发明另一套关系模型。

节点生成工具属于 Mind Map Workbench 的 Generation Center Contribution，不进入
右上角 overflow 菜单。后续也可以和节点右键菜单共享同一个 Workbench Action，
但不同 Surface 只负责各自的呈现。

## 7. 安全与产品约束

真实生成链路继续遵守以下原则：

- 默认使用用户 ChatGPT 账号下的 Codex 能力，不要求 OpenAI API Key；
- 不通过 ChatGPT 网页 UI 自动化；
- Renderer 不获得文件系统、SQLite、Token 或子进程能力；
- Agent 不直接读取 SQLite，不直接修改正式 Asset；
- 所有正式写入由 Main 的领域 Service 校验和提交；
- Provider 不拥有 Project、Asset、Lane 或关系模型；
- Codex DTO 只存在于 Adapter 内；
- 额度耗尽、未登录或生成失败不能破坏非 AI Workbench；
- 用户取消或任务创建失败时保留来源选择和补充要求；
- 成功创建任务后才退出来源选择状态。

## 8. 推荐实施顺序

### 阶段 1：GenerationTask 领域骨架

- 定义 Provider 无关的 Task 数据、状态和错误模型；
- 确定 SQLite Repository、运行时 Service 和事件投影；
- 定义创建、查询、取消、恢复和重试边界；
- 先用可控假执行器验证重启恢复与 Renderer 状态同步。

### 阶段 2：Creator Lane 执行入口

- 补齐 Agent Provider 的 Thread / Turn Adapter；
- 持久化当前 Project 的 Creator Lane Thread Ref；
- 把 Task 生命周期与流式 AgentEvent 连接；
- 保持 Provider DTO 不进入 Task 领域模型。

### 阶段 3：来源内容与 Projection

- 按 Asset media type 建立只读内容提取注册表；
- 为纯文本、Markdown、PDF 和 Office 派生 PDF 先提供可读投影；
- 固定来源 Revision、权限与任务目录生命周期；
- 明确超大资料、暂不支持格式和外部 Link Asset 的错误策略。

### 阶段 4：Mind Map 结构化生成

- 设计 Creator Prompt 和结构化输出协议；
- 生成并校验 `MindMapDocumentV1`；
- 实现 staging、正式 Asset 创建、AssetReference 和失败补偿；
- 任务成功后让右侧列表出现真实 Mind Map Asset。

### 阶段 5：任务体验

- 在生成中心展示排队、运行、失败和恢复状态；
- 展示阶段、耗时和 Provider 可提供的用量信息；
- 提供取消、重试、查看错误和打开结果；
- 应用重启后恢复未结束任务的可信状态。

### 阶段 6：Mind Map 专属讲义生成

- 接入 Node / Frame Anchor；
- 复用 GenerationTask 和 Creator Lane；
- 创建 HTML Asset、AssetLink 和 content association；
- 在 Mind Map 节点、右键菜单和生成中心之间复用同一个 Action。

## 9. 进入下一阶段前需要单独决定的问题

GenerationTask 规格必须明确：

1. Task 状态机、取消和应用异常退出后的恢复规则；
2. Task 是否保存逐事件日志，保存到什么颗粒度；
3. Codex Turn 无法恢复时如何标记和重试；
4. Lane、Provider Thread、Execution Session 和 Projection 的最终关系；
5. Projection 目录的生命周期、空间上限和清理策略；
6. 各媒体类型如何转为 Agent 可读内容；
7. 输出校验失败后是否允许自动修复 Turn；
8. SQLite 与文件 staging 的提交和补偿协议；
9. 用量与费用在 Codex 只返回部分信息时如何展示；
10. 用户取消、关闭 Project 或退出应用时，任务是否继续后台执行。

## 10. 第一条目标闭环

后续工作的第一条可验收闭环建议固定为：

```text
用户选择 imported Assets
→ 填写可选要求并确认生成 Mind Map
→ 创建可持久化 GenerationTask
→ Main 构造只读 AgentContextProjection
→ Creator Lane 调用 Codex
→ 校验 MindMapDocumentV1
→ 原子创建 generated Asset 与 AssetReference
→ 右侧生成内容出现真实 Mind Map
→ 用户打开 Mind Map Workbench 阅读
```

完成这条链路后，再扩展 Mind Map 节点讲义生成。这样能够先验证通用 Task、上下文
投影、Provider 执行和 Asset 提交四个最关键边界，避免先堆叠更多生成按钮。

## 11. 与独立笔记系统的先后关系

今天同时确认了一个更长期的学习体验方向：用户需要随时打开独立页面记录以
Markdown 为主的笔记。笔记可能作为一种 Asset 被右侧可变栏管理，左侧资料栏也能
打开它，但不要求每篇笔记都绑定当前资料。

这部分暂不进入当前生成闭环，原因是：

- 是否新增 `creationKind === 'authored'` 尚未确定；
- 独立笔记、Asset Attachment 和绑定原文位置的学习笔记是相关但不同的需求；
- 先实现 Mind Map 可以优先验证生成任务、上下文投影和稳定产物提交；
- GenerationTask 基座完成后，生成 HTML 讲义、摘要和笔记候选都可以复用同一执行
  与审查链路。

当前推荐产品顺序为：

```text
生成中心基础
→ Project 级 Mind Map
→ Mind Map 节点 HTML 讲义
→ 独立 Markdown 笔记系统
→ Workbench 内更细的 Attachment / AI 学习操作
```

进入独立笔记阶段时，需要单独决定笔记是否必然是 Asset、如何在左右侧栏呈现、
是否引入 `authored` 创建类型，以及独立笔记与原文锚点 Attachment 如何互相引用。
