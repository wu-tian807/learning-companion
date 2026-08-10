# EPUB 划词解释与通用生成基建设计

## 结论

当前“解释这段话”定义为锚定 EPUB CFI 选区的即时解释 Note，而不是可持续追问的自由问答。用户选择文本后创建一个可定位、可再次打开、可删除的 Attachment；如果未来增加“继续追问”，应新增明确的 Conversation 入口，而不是改变现有按钮的隐式语义。

结果载体和 Session 生命周期是两个正交决策：Note 由 Attachment 持久化，但正文直接采用 Agent 最终回答；每次解释使用独立的 task Session，不因 Attachment 的存在而共享上下文。

| 决策 | 选择 | 原因 |
|---|---|---|
| 交互语义 | 即时解释（锚定 Note） | 用户操作是固定选区上的一次解释，结果需要保存和定位，不包含追问输入框 |
| Note 正文来源 | Agent 最终回答 | 产物只有一份短 Markdown，不需要 Agent 在工作区编辑文件或执行多文件自检 |
| 是否显示 delta | 否 | 当前入口是异步 Note 生成；UI 展示 pending/failed/completed 状态，避免临时文本与持久结果出现双重真相 |
| Session 生命周期 | `task` | 每个选区可独立复现，避免其他段落的历史上下文污染解释 |
| 稳定实例边界 | 不适用 | 当前功能不继承前文；未来问答使用显式 Conversation 作为稳定边界 |
| 重试策略 | 新任务、新 Session | 失败任务及其 checkpoint 保留诊断信息；新任务不会复用已经完成但不可用的调用结果 |

## 主链路

```text
EPUB Workbench 选区
  → EpubExplanationService 创建 pending Attachment
  → 创建 GenerationTask(TaskDefinition + Instruction)
  → TaskDefinition.process(context)
  → context.agent.call(...)
  → AgentProvider 返回规范化事件和最终回答
  → Processor 校验最终 Markdown
  → AttachmentContentFile 原子写入正文
  → AttachmentService 更新 Attachment 为 completed
  → EPUB Workbench 按 CFI 渲染标记和 Note 面板
```

Renderer 不直接调用 Provider，EPUB IPC 也不提供第二条 AI 调用路径。Attachment 仅保存业务产物，不替代 GenerationTask、Session 或未来的 Conversation。

## GenerationTask 输出契约

`context.agent.call()` 返回包含 `assistantOutput` 的最终结果。最终回答随 Agent call checkpoint 持久化，任务恢复时复用同一 `callKey` 仍能得到相同结果。文件型任务可以忽略该字段；文本回答型 Processor 必须显式校验并消费它。

Provider 事件统一为 session、assistant delta、assistant completed、tool、usage 和 status。调用方通过单次 `agent.call()` 的选项决定是否把 assistant 运行时事件送到 GenerationTask 事件出口：

- `assistantEvents: 'none'`：仍返回并持久化最终回答，但不向 Renderer 广播正文事件；适合 EPUB Note 和文件型生成。
- `assistantEvents: 'runtime'`：转发真实 delta 和最终 completed snapshot；适合未来自由问答。
- 没有真实 delta 的 Provider 只产生 completed snapshot，不能在结束时把全文伪装成 delta。
- 高频 delta 只存在于运行时事件流，不逐块写入数据库。

## Attachment 边界

通用 Attachment 层只负责：

- `typeId + version` 与 metadata 注册校验；
- Content Anchor 注册校验；
- ID、时间戳、project/asset 归属和持久化；
- ContentRef 文件的原子写入、读取和清理；
- 创建、更新、删除事件与所属 Asset 的 `updatedTime` 更新；
- Attachment、Asset、Project 删除时的文件生命周期。

通用层不知道 EPUB、CFI、“解释”状态、Markdown 文件名或媒体类型。EPUB 垂直切片注册自己的 Attachment 类型和 CFI Anchor，并决定正文使用 `answer.md` 与 `text/markdown`。

## 重试与失败

EPUB 解释不再依赖工作区输出文件，所以不存在“Agent turn 完成但 answer.md 缺失”的 repair loop。失败时保留旧 GenerationTask 供诊断；用户重试会创建新的 GenerationTask 和 task-scoped Session，并把 Attachment 的 `taskId` 原子更新到新任务。旧任务完成事件因为 taskId 不匹配而不能覆盖新状态。

需要文件产物的其他 TaskDefinition 仍可在同一 Session 内使用稳定递增的 `repair-1`、`repair-2` callKey。GenerationTask 的 checkpoint 保证每个 callKey 幂等，但不会替 Processor 自动决定产物修复策略。

## 目录与迁移

通用合约收敛在 `src/shared/attachments/contracts.ts`；通用 main-process 实现在 `src/main/attachments/`。EPUB 的 shared contracts、IPC、Service、面板和 generation 代码全部位于 `src/workbenches/epub/explanations/`。

数据库只保留 version 19 的 `attachments` 表，使用触发器确保 `assetId` 属于 `projectId`。此前尚未合并的 `asset_attachments` migration 不作为公开迁移历史保留；其他并行功能分支合并时适配这套 schema。

Codex Windows 工作区写权限属于 Provider 全局能力，和 EPUB Note 正文来源无关。该修复应保留为独立提交/PR，并通过真实 Agent 集成测试覆盖可写根、只读 secondary 和工作区外路径。
