# GenerationTask、TaskDefinition 与 Mind Map 生成设计

日期：2026-08-04
状态：基础层已实现，真实 Provider、Session 与生成 Asset 提交待接入

## 1. 最终结论

首条生成链采用四个边界：

```text
TaskDefinition  声明一类任务需要什么
Instruction     表达这一次用户具体要求什么
GenerationTask  只记录一次任务的持久化状态与 metrics
TaskExecution   将 Definition + Instruction 实例化并执行三阶段流程
```

固定流程为：

```text
prepare -> run agent -> post-process
```

主要决策：

- `Instruction` 不是通用字符串，也不强制所有 Workbench 共享同一组 Part；
- 每个 Definition 可以拥有自己的 Instruction 类、Snapshot 校验和
  `toUserMessage()` 实现；
- Selection、截图、时间区间等未来输入属于对应 Instruction 的组合字段；
- `TaskDefinition` 是静态、版本化、声明式配方，不直接访问数据库或 Provider；
- `GenerationTask` 是纯状态对象，不负责文件 IO 或 Agent 调用；
- `GenerationTaskExecution` 负责 prepare、Agent 输出校验/修复和 post-process；
- `GenerationTaskService` 只维护当前 Project 的 Task 集合、并发运行与数据库同步入口；
- v1 不引入 Attempt 实体，使用三个单调检查点实现恢复；
- 一个 Definition 有一个主 Workspace 和零到多个副 Workspace；
- Workspace key 是扁平 kebab-case 主键，不支持点号嵌套；
- 只有主 Workspace 决定 Session；副 Workspace 只是挂载给 Agent 的额外根目录。

## 2. Instruction

### 2.1 抽象契约

`GenerationInstruction<TSnapshot>` 要求具体类型实现两个方法：

```ts
abstract toSnapshot(): TSnapshot;
abstract toUserMessage(context: PreparedInstructionContext): AgentUserMessage;
```

构造函数负责初始化并规范化具体字段。Factory 负责从持久化 JSON 恢复并校验：

```ts
interface GenerationInstructionFactory<TInstruction> {
  parse(input: JsonValue): GenerationValidationResult<TInstruction>;
}
```

这样未来不同 Workbench 可以保留自己的直观输入：

- Mind Map：纯文本补充要求；
- Markdown：文本选择、当前文档位置、用户要求；
- Image：截图区域、视觉选择、文本要求；
- Video：时间区间、当前帧、字幕选择、文本要求。

它们最终都转换成一条 provider-neutral 的 `AgentUserMessage`。目前消息 Part 已预留：

- `text`；
- `local-image`；
- `local-audio`。

### 2.2 Mind Map Instruction v1

首版 Snapshot：

```json
{
  "format": "learning-companion/mindmap-generation-instruction",
  "version": 1,
  "additionalInstructions": "可选的用户补充要求"
}
```

默认消息要求 Agent 根据提供的参考资料生成完整、层次清晰的思维导图；
`additionalInstructions` 只补充用户偏好，不承载来源路径。

来源清单由默认 prepare 在 Workspace 就绪后统一追加，避免每个 Instruction 重写同一逻辑。

## 3. TaskDefinition

`TaskDefinition` 当前包含：

```ts
interface TaskDefinition<
  TInstruction,
  TPreparedData,
  TAgentOutput,
  TResult
> {
  id: string;
  version: number;
  systemInstruction: string;
  allowedTools: readonly AllowedToolConfig[];
  primaryWorkspaceConfig: AgentWorkspaceConfig;
  secondaryWorkspaceConfigs: readonly AgentWorkspaceConfig[];
  assetReferenceSchema: GenerationAssetReferenceSchema;
  instruction: GenerationInstructionFactory<TInstruction>;
  prepareExtension?: GenerationTaskPrepareExtension<...>;
  outputContract: GenerationOutputContract<TAgentOutput>;
  postProcessor: GenerationTaskPostProcessor<...>;
}
```

Definition 可以声明额外 prepare 数据，但不要求调用方派生新的 `GenerationTask` 子类。
差异通过组合进入：

- Instruction Factory；
- 可选 Prepare Extension；
- Output Contract；
- PostProcessor。

Registry 使用 `id + version` 定位 Definition。版本进入 Task Snapshot，因此应用升级后仍能找到
创建任务时使用的协议。

## 4. AssetReference 输入

Definition 通过 Slot Schema 声明需要哪些 Asset：

```ts
type GenerationAssetReferenceSchema = Record<
  string,
  {
    required: boolean;
    cardinality: "one" | "many";
    minItems?: number;
    maxItems?: number;
    acceptedMediaTypes?: readonly string[];
  }
>;
```

创建 Task 时只保存业务输入：

```json
{
  "sources": [
    { "assetId": "asset-1" },
    { "assetId": "asset-2" }
  ]
}
```

默认 prepare 会：

1. 拒绝未知 Slot、漏传必需 Slot、数量越界和同 Slot 重复 Asset；
2. 校验 Asset 属于当前 Project 且媒体类型满足 Definition；
3. 将每份内容复制到主 Workspace；
4. 计算副本 revision；
5. 生成稳定 alias，例如 `sources-0001`；
6. 写入每份来源的 `metadata.json`；
7. 把 alias、名称、媒体类型和相对路径追加到用户消息。

Agent 只看到 Workspace 相对路径，不接触 Learning Companion 的原始绝对路径。

## 5. Workspace 与 Session

### 5.1 配置

```ts
interface AgentWorkspaceConfig {
  key: string;
  scope: "shared" | "task";
  permissions: { read: boolean; write: boolean };
}
```

key 必须匹配扁平 kebab-case；例如：

```text
generation-mindmap
project-outline
```

不再支持 `generation.mindmap` 这样的嵌套 key。多工作区已经表达了独立根目录，嵌套 key
只会增加路径和 Session 映射复杂度。

路径规则：

```text
workspace_root/<key>/shared
workspace_root/<key>/<taskId>
```

- `scope: shared` 固定使用 `shared`；
- `scope: task` 使用 `taskId`；
- shared Workspace 当前禁止 Agent 写入，避免多个 Task 并发污染共享上下文。

### 5.2 主副 Workspace

- `primaryWorkspaceConfig`：唯一主工作区，默认 prepare 将 Asset 副本放在这里；
- `secondaryWorkspaceConfigs`：附加只读或任务级工作区；
- Agent Runner 会同时收到所有 Prepared Workspace 及权限。

### 5.3 Session 映射

Session Locator 只由主 Workspace 产生：

```ts
{
  projectId,
  providerId,
  workspaceKey: primary.key,
  instanceKey: primary.scope === "shared" ? "shared" : taskId
}
```

真实 Session 层以后负责用 Locator 查找或创建 Provider Session。对 Codex 来说返回值会是
thread id；对其他 Provider 可以是它自己的 session id。Generation 层只记录最终实际使用的
`sessionId`，不保存或转换 Provider 内部对话内容。

## 6. Workspace 文件布局

`mindmap.generate@1` 当前使用：

```text
workspace_root/
└── generation-mindmap/
    └── <taskId>/
        ├── request/
        │   ├── instruction.json
        │   └── asset-references.json
        ├── references/
        │   ├── sources-0001/
        │   │   ├── source.<ext>
        │   │   └── metadata.json
        │   └── sources-0002/
        │       ├── source.<ext>
        │       └── metadata.json
        └── control/
            ├── prepared-manifest.json
            └── agent-output.json
```

`prepared-manifest.json` 最后写入，因此它也充当 prepare 完成标志。恢复时会校验每份副本的
revision；Agent 已完成后不允许悄悄重新 prepare，以免用新来源解释旧输出。

## 7. GenerationTask 状态

Task Snapshot 保存：

- task / project / definition id 与 version；
- Instruction Snapshot；
- AssetReference 输入绑定；
- prepare checkpoint；
- agent-completed checkpoint；
- post-processed checkpoint；
- metrics；
- 最近一次 failure；
- cancellation 与创建/更新时间。

不单独持久化可漂移的 `status` 字符串。状态由检查点推导：

```text
created
prepared
agent-completed
post-processed
failed
cancelled
```

检查点必须单调：

```text
prepared -> agentCompleted -> postProcessed
```

恢复规则：

- 没有 prepare checkpoint：执行完整 prepare；
- 有 prepare checkpoint：从 manifest 恢复；
- prepare 副本损坏且 Agent 尚未完成：允许重新 prepare 并替换 checkpoint；
- Agent 已完成：直接读取 `agent-output.json`，不再次调用 Provider；
- post-process 已完成：保留数据库历史记录，只从活动内存集合卸载；
- post-process 必须以 `taskId` 做幂等键，防止“外部提交成功、checkpoint 尚未落库”时重复创建结果。

## 8. SQLite

migration 12 新增 `generation_tasks`：

- Instruction、AssetReference、metrics、failure 和结果使用 JSON 列；
- 三个 checkpoint 使用时间和对应 ref 列；
- SQL CHECK 保证不能越过阶段；
- `listByProject()` 可读取完整任务历史；
- `listUnfinishedByProject()` 只读取尚未 post-process 且未取消的可恢复任务；
- `generation_tasks_unfinished_project_created_index` 是只包含可恢复任务的 partial index，
  可按 Project 和创建顺序直接读取活动集合，不扫描已完成历史；
- Project 打开时，Service 只把可恢复任务重建到活动内存集合；
- Task 成功或取消后保留数据库记录，只从活动内存集合卸载；
- 成功后的内存卸载由已持久化 checkpoint 判断，不依赖流消费者继续读取最终返回值；
- Project 删除时通过外键级联清理该 Project 的全部 Task 历史。

当前 `loadFromProject()` 只恢复状态对象，不擅自启动 Provider。等 Session/Provider
调度层接入后，它会为加载出的 Task 选择 Runner 并调用 `run()`；`run()` 会根据检查点自动
从 prepare、Agent 或 post-process 的正确位置继续，而不是从头执行。

Task Workspace 的自动回收尚未接入；需要先确定失败诊断保留期和崩溃恢复策略，再给
`AgentWorkspaceManager` 增加安全清理能力。

## 9. Metrics

一次成功 Agent 执行记录：

- 最终 `sessionId`；
- 实际 `providerId`；
- 实际 `modelId`；
- started / completed time；
- active duration；
- turn count；
- repair turn count；
- input / cached input / output / reasoning / total tokens（Provider 能提供多少就记录多少）。

Task 汇总：

- prepare duration；
- Agent executions；
- post-process duration；
- total active duration；
- total token usage。

本地估算不能冒充 Provider usage。真实 Adapter 只能填 Provider 返回的实际 usage；未返回的字段
保持缺省。

## 10. Agent 输出与修复

Runner 是 provider-neutral 的流式端口：

```ts
runTurn(request): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>
```

request 已包含：

- System Instruction；
- 一条多模态 User Message；
- allowed tools；
- 主副 Workspace 和权限；
- output JSON Schema；
- Session Locator 或需要续用的 sessionId。

`GenerationAgentExecutor` 负责通用的结构修复循环：

1. 调用第一轮；
2. 使用 Definition 的 Output Contract 做运行时校验；
3. 失败时生成 repair message；
4. 使用同一个 `sessionId` 继续下一轮；
5. 达到 `maxRepairTurns` 后失败；
6. 成功时聚合所有轮次 usage 和时间。

它会拒绝修复过程中 Provider、Model 或 Session 偷换，避免 metrics 与上下文映射失真。

## 11. `mindmap.generate@1`

### 11.1 Definition

- id：`mindmap.generate`；
- version：`1`；
- primary key：`generation-mindmap`；
- primary scope：`task`；
- Asset Slot：必需的多值 `sources`；
- Required tools：`workspace.read`、`workspace.search`；
- Agent 不写 Workspace，只返回结构化结果；
- 最大修复轮数：2。

### 11.2 Candidate 输出

Candidate 包含：

```ts
interface MindMapGenerationCandidateV1 {
  title: string;
  rootNodeId: string;
  nodes: Record<string, {
    id: string;
    title: string;
    focus: string;
    childIds: string[];
    sourceAliases: string[];
  }>;
  frames: Record<string, {
    id: string;
    title: string;
    nodeIds: string[];
    sourceAliases: string[];
  }>;
}
```

运行时校验保证：

- 节点形成单根、连通、无环、每个非根节点唯一父节点的严格树；
- Node / Frame 的对象键与自身 id 一致；
- Frame 只能覆盖已有节点；
- `sourceAliases` 只能引用默认 prepare 提供的 alias。

Frame 由此预留“多个节点作为一次讲义生成范围”的能力；节点和 Frame 都保留来源映射，
但通用 AssetReference / AssetLink 仍由关联服务维护，不塞进通用 Asset 对象。

### 11.3 PostProcessor 接缝

当前 `MindMapGenerationPostProcessor` 调用 `MindMapGenerationResultCommitter`。真实 Committer
尚未接入，因为现有 `AssetService` 还没有完整的 generated Asset 创建事务。

Committer 后续必须原子或幂等地完成：

1. 将 Candidate 转成 `.mindmap` 文档；
2. 创建 generated Asset；
3. 为所有来源创建通用 AssetReference；
4. 将 alias 映射为 Mind Map 内部 Node / Frame association；
5. 返回 `resultAssetId`。

## 12. 已实现文件边界

```text
src/main/generation/
├── contracts/                         # 纯协议和状态校验
├── preparation/
│   ├── generation-asset-reference-preparer.ts
│   ├── generation-prepared-manifest-file.ts
│   ├── generation-task-preparer.ts
│   └── generation-user-message-composer.ts
├── generation-agent-executor.ts       # 同 Session 的输出校验/修复循环
├── generation-agent-runner.ts         # 真实 Provider 待实现的端口
├── generation-task.ts                 # 纯状态对象
├── generation-task-execution.ts       # 三阶段执行
├── generation-task-database.ts        # SQLite 映射
├── generation-task-output-file.ts     # Agent 输出文件
├── generation-task-service.ts         # Project 级活动 Task 集合
└── generation-task-definition-registry.ts

src/workbenches/mindmap/generation/
├── mindmap-generation-instruction.ts
├── mindmap-generation-output.ts
├── mindmap-generation-post-processor.ts
└── mindmap-generation-task-definition.ts
```

各模块按职责拆分，核心生产文件保持在约 300 行以内，避免重新形成大型 Service。

## 13. 明确延后

以下内容不在本轮基础层中假装完成：

- Codex Runtime 到 `GenerationAgentRunner` 的真实 Adapter；
- 根据 Locator 创建/恢复 AgentLane Session；
- Provider 选择与 Generation Center UI；
- MCP、Skills 与 Provider 专属配置的最终解析；
- generated Mind Map Asset 的真实 Committer；
- 成功/失败 Task Workspace 的回收策略。

下一步应先实现 Session/Provider Adapter，让 `mindmap.generate@1` 能得到真实结构化 Candidate；
随后补 generated Asset Committer，形成第一条真正可见的 Mind Map 生成闭环。
