# GenerationTask、TaskDefinition 与 Mind Map 生成设计

日期：2026-08-04
状态：Generation、Session 与 Codex Provider Adapter 已实现，生成 Asset 提交与产品入口待接入

> 2026-08-08 更新：本文记录的固定
> `prepare -> run agent -> post-process` 控制流已被
> `2026-08-08-generation-task-process-execution-design.md` 取代。Instruction、Workspace、
> AssetReference、Session 定位和 Provider 能力声明仍按本文执行；运行时以新文档和当前代码为准。

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
interface TaskDefinition<TInstruction, TResult> {
  id: string;
  version: number;
  providerSelectorId: string;
  primaryWorkspaceConfig: AgentWorkspaceConfig;
  secondaryWorkspaceConfigs: readonly AgentWorkspaceConfig[];
  assetReferenceSchema: GenerationAssetReferenceSchema;
  instruction: GenerationInstructionFactory<TInstruction>;
  process(context: GenerationTaskProcessContext<TInstruction>): Promise<TResult>;
}
```

TaskDefinition 只声明稳定的任务身份、Provider Selector、Workspace、AssetReference、Instruction
协议和业务流程，不保存一套全任务共享的 Agent 提示词或能力配置。`process()` 中的每次调用都必须
显式构造完整 Turn：

```ts
interface TaskAgentCallRequest {
  callKey: string;
  purpose: string;
  systemInstruction: string;
  userMessage: AgentUserMessage;
  toolRequirements: readonly AgentToolRequirement[];
  skills: readonly AgentSkillRequirement[];
  mcpServers: readonly AgentMcpServerRequirement[];
  assistantEvents?: "none" | "runtime";
}
```

不存在 `defaultSystemInstruction`，也不把 Definition 级工具、Skill 或 MCP 与调用参数隐式合并。
同一个 `process()` 可以让 generate、review、repair 等调用使用完全不同的系统提示词和能力组合。
框架只提供已经完成 AssetReference 拼装的 `context.preparedUserMessage`；具体流程仍须在调用时
明确选择是否发送它。

`callKey` 是 GenerationTask 内的稳定调用身份，用于 checkpoint 与恢复去重；`purpose` 只作为
观测和 metrics 标签，不参与提示词、工具或执行策略。TaskAgentSession 负责 Session 延续、恢复与
Provider 路由，但不会替 TaskDefinition 猜测本轮 Agent 行为。

具体产物由 `process()` 自己发现、校验、修复和提交。这样 HTML 可以直接使用最终 Assistant
回答，Mind Map 可以读取候选文件，核心层不假设“每个任务只有一个输出形式”。

Registry 使用 `id + version` 定位 Definition。版本进入 Task Snapshot，因此应用升级后仍能找到
创建任务时使用的协议。
修改某个 `callKey` 的提示词、能力或业务含义时必须提升 Definition version；已完成的同名
call checkpoint 会继续返回持久化结果，而不会因代码变化偷偷重跑。

每次调用中的 `toolRequirements`、`skills` 和 `mcpServers` 分别表达本轮工具需求、方法上下文
和外部 MCP Server，都使用 required / optional 语义，并由 Provider Adapter 分别映射。
`mindmap.generate@1` 当前每轮三者均为空；Provider 根据 writable Workspace 自动提供
Workspace read / search / write。

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
  permissions: { read: boolean; write: boolean };
  resolveInstanceKey?: (context: {
    taskId: string;
    instruction: JsonValue;
  }) => string;
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
workspace_root/<key>/<instanceKey>
```

- 未声明 `resolveInstanceKey` 时默认使用 `taskId`，每个 GenerationTask 独立；
- 需要跨 Task 延续 Conversation 时，由 Definition 返回 Conversation ID 等稳定业务键；
- 真正需要单例时可以明确返回 `shared`，不再额外维护 `scope`；
- `instanceKey` 同时确定 Workspace 实例和 Provider Session，不隐含读写策略。Workspace
  是否可写完全由 `permissions` 声明。需要避免并发写入时，由使用该实例的业务 Service
  负责串行化或冲突控制。

所有实例策略使用完全相同的 `TaskDefinition -> GenerationTask` 执行链路。每次外部
Agent 业务请求都创建一个新的 GenerationTask；复用稳定 `instanceKey` 不表示一个永不结束
的 Task，只表示这些独立 Task 使用相同的 Workspace 实例和 Provider Session。

### 5.2 主副 Workspace

- `primaryWorkspaceConfig`：唯一主工作区，默认 prepare 将 Asset 副本放在这里；
- `secondaryWorkspaceConfigs`：附加只读或任务级工作区；
- Agent Runner 会同时收到所有 Prepared Workspace 及权限。

### 5.3 Session 映射

Session Locator 只由主 Workspace 产生：

```ts
{
  projectId,
  workspaceKey: primary.key,
  instanceKey: primary.instanceKey
}
```

Locator 本身保持 Provider 无关。同一个 Locator 的 `session.json` 使用
`providerBindings` 字典分别保存 Codex、Claude Code 等 Provider 的原生 Session ID，避免
切换 Provider 时复制工作区身份。对 Codex 来说该 ID 是 thread id；对其他 Provider 可以是
它自己的 session id。Generation 层只记录最终实际使用的 `sessionId`，不保存或转换
Provider 内部对话内容。

映射文件位于 Agent 可访问工作区之外：

```text
<project-workspace>/.learning-companion/agent-sessions/
└── <workspaceKey>/
    └── <instanceKey>/
        └── session.json
```

`AgentSessionService` 随当前 Project 加载，按 Locator 懒读并缓存。对同一 Locator 的读写会
串行执行；首次绑定是幂等操作，不允许静默覆盖已有 Provider Session。Provider 原生 Session
无法恢复或配置不兼容时，调用方必须携带预期旧 `sessionId` 显式 compare-and-replace。
`configurationFingerprint` 用来阻止系统提示词、工具或路径权限不兼容的 Thread 被误续用。

## 6. Workspace 文件布局

`mindmap.generate@1` 当前使用：

```text
workspace_root/
└── <projectId>/
    └── generation-mindmap/
        └── <instanceKey>/
            ├── references/
            │   ├── sources-0001/
            │   │   ├── source.<ext>
            │   │   └── metadata.json
            │   └── sources-0002/
            │       ├── source.<ext>
            │       └── metadata.json
            └── output/
                └── mindmap-candidate.json
```

Instruction、输入 AssetReference 与物化后的引用快照均随 GenerationTask 保存在 SQLite；
调用 Agent 时才动态组装 User Message。工作区不再创建 `request/` 或 `control/`。恢复时从
Task checkpoint 取得引用快照，并校验 `references/` 中每份副本的 revision，避免用新来源
解释旧输出。

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
agent-assigned
agent-completed
post-processed
failed
cancelled
```

检查点必须单调：

```text
prepared -> assignedProviderId -> agentCompleted -> postProcessed
```

恢复规则：

- 没有 prepare checkpoint：执行完整 prepare；
- 有 prepare checkpoint：从 manifest 恢复；
- prepare 副本损坏且 Agent 尚未完成：允许重新 prepare 并替换 checkpoint；
- 第一次真正进入 Agent 阶段时，解析当前设置中已认证的 Provider，并把
  `assignedProviderId` 持久化；
- Task 一旦固定 Provider，重试和崩溃恢复都按该 ID 解析 Runner。用户随后切换到 Claude Code
  只影响新 Task，不会让旧 Task 偷换 Session；
- Agent 已完成：不再次调用 Provider，直接进入具体 Definition 的 post-process；
- post-process 自己在 Workspace 中发现并校验产物，GenerationTask 不保存通用 output ref；
- post-process 已完成：保留数据库历史记录，只从活动内存集合卸载；
- post-process 必须以 `taskId` 做幂等键，防止“外部提交成功、checkpoint 尚未落库”时重复创建结果。

## 8. SQLite

migration 12 新增 `generation_tasks`：

- Instruction、AssetReference、metrics、failure 和结果使用 JSON 列；
- 三个 checkpoint 使用时间与各阶段必要数据；只有 prepare 保存通用 manifest ref，Agent checkpoint
  只保存 Provider Session 和执行标识；
- SQL CHECK 保证不能越过阶段；
- `listByProject()` 可读取完整任务历史；
- `listUnfinishedByProject()` 只读取尚未 post-process 且未取消的可恢复任务；
- `generation_tasks_unfinished_project_created_index` 是只包含可恢复任务的 partial index，
  可按 Project 和创建顺序直接读取活动集合，不扫描已完成历史；
- Project 打开时，Service 只把可恢复任务重建到活动内存集合；
- Task 成功或取消后保留数据库记录，只从活动内存集合卸载；
- 成功后的内存卸载由已持久化 checkpoint 判断，不依赖流消费者继续读取最终返回值；
- Project 删除时通过外键级联清理该 Project 的全部 Task 历史。

migration 14 新增 `assigned_provider_id`，并从已有 Agent metrics 回填旧任务实际使用的
Provider。该字段是执行开始前单独落库的恢复检查点，不依赖 Agent 成功返回。

migration 15 删除 `agent_output_ref`。产物属于 TaskDefinition 的 Workspace 协议，不属于通用
GenerationTask 数据模型。

`loadFromProject()` 会恢复未完成任务。没有持久化 failure 的任务会在后台自动从最近检查点继续；
已经失败的任务保持可见，等待用户显式重试，避免每次打开 Project 都重复消耗额度。
`GenerationTaskService` 通过 `AgentProviderService` 解析 Runner，并根据检查点从 prepare、Agent
或 post-process 的正确位置继续，而不是从头执行。未分配的 Task 使用当前设置中已认证的
Provider；已分配 Task 使用自己的 `assignedProviderId`。

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

## 10. Agent Workspace 产物

Runner 是 provider-neutral 的流式端口：

```ts
runTurn(request): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>
```

request 已包含：

- System Instruction；
- 一条多模态 User Message；
- allowed tools；
- 主副 Workspace 和权限；
- Session Locator 或需要续用的 sessionId。

`GenerationAgentExecutor` 只负责一次 Provider Agent Turn：

1. 传入 System Instruction、User Message、工具和 Workspace；
2. 转发 assistant delta 与工具调用事件；
3. 记录 Provider、Model、Session、Turn 和真实 usage；
4. 不解释 assistant 最终回复，也不声明或读取任务产物。

Agent 产物由具体 TaskDefinition 的提示词约定，并由其 post-process 在 Agent Turn 完成后自行
发现和校验。未来的自动修复循环也以 post-process 的可修复结果为依据，而不是校验 assistant
响应。

### 10.1 Codex Adapter 的执行边界

`CodexAgentProvider` 同时实现凭证能力与 `GenerationAgentRunner`，不再创建第二套
“execution provider”。执行适配拆成四个协作边界：

- request：把 Provider-neutral 请求编译成 Codex 输入、权限 Profile 与配置指纹；
- environment：枚举并屏蔽用户环境中的 MCP 与 Skills；
- thread coordinator：创建/恢复 Thread、维护 binding，并串行同一 Session 的 Turn；
- response：映射流式文本、工具调用、完成状态、真实 token usage、模型改道与时间。

Session 配置指纹只包含任务声明的稳定能力，不包含当前机器枚举出的 MCP/Skill 清单。
因此安装一个新 Skill 不会无意义地更换 Thread，但每次恢复仍会重新生成禁用配置。

当前执行策略为：

- Provider 默认提供 Codex 原生 Shell read / search、`view_image` 和应用 PDF 工具；
- writable Workspace 额外获得原生编辑能力；Codex permission profile 约束 Shell、脚本与
  `apply_patch` 只能写入授权路径；
- 网络、Web Search、MCP、Apps、Plugins、Skills、Hooks、Memory、Goals 与 Subagents 默认关闭；
- 未支持的 required tool 在创建 Thread 前失败；Codex 若仍报告未声明工具调用则按协议错误失败；
- `clientUserMessageId` 由 Task 与消息稳定派生，进程重启后可复用已完成 Turn，
  避免重复扣费；
- 只有明确的 `no rollout found for thread id` 才替换失效 binding，网络和连接错误不会被误判成
  Thread 丢失；
- 同一个 `workspaceKey + instanceKey` 的 Turn 全程串行，支持命名 Workspace 复用；
- usage 只采信 Codex `thread/tokenUsage/updated`，恢复时无法取得的 usage 保持缺省。

## 11. `mindmap.generate@1`

### 11.1 Definition

- id：`mindmap.generate`；
- version：`1`；
- primary key：`generation-mindmap`；
- primary instance：使用默认 `taskId`，每个任务独立；
- Asset Slot：必需的多值 `sources`；
- Provider 默认提供 Workspace Shell read / search、按权限开放的 write 和 Codex 原生 image；
  `process()` 根据本次参考资料的物化媒体类型声明 PDF；
- Agent 必须在 Workspace 中写入 `output/mindmap-candidate.json`；
- assistant 最终回复只报告完成状态，不承载产物。

### 11.2 Candidate 输出

Candidate 包含：

```ts
interface MindMapGenerationCandidateV1 {
  format: "learning-companion/mindmap-generation-candidate";
  version: 1;
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

### 11.3 PostProcessor 落地

`MindMapGenerationPostProcessor` 自己发现、校验并编排结果落地，不再增加只服务于 Mind Map 的 Committer
抽象。它通过现有 `AssetService` 和 `AssetAssociationService` 完成领域写入：

1. 从主 Workspace 读取 `output/mindmap-candidate.json`；
2. 校验候选版本、严格树、Frame 和 source alias；
3. 将 Candidate 转成 `.mindmap` 文档；
4. 以 `<taskId>.mindmap` 在 Project Workspace 中暂存并创建 generated Asset；
5. 为所有来源创建通用 AssetReference；
6. 将 alias 映射为 Mind Map 内部 Node / Frame association；
7. 用 revision guard 写入带 association 的最终文档并刷新 Asset；
8. 返回 `resultAssetId`。

`taskId` 同时是文件幂等键。若进程在 Asset/Reference 已写入、Task checkpoint 尚未写入时中断，
重试会复用同一个 generated Asset，`ensureReference()` 复用同一对关系，再覆盖最终文档，
不会产生重复 Asset 或重复引用。普通失败会删除本次刚创建的 Asset；已存在的恢复现场则保留，
供下一次重试继续。

## 12. 已实现文件边界

```text
src/main/generation/
├── contracts/                         # 纯协议和状态校验
├── preparation/
│   ├── generation-asset-reference-preparer.ts
│   ├── generation-task-preparer.ts
│   └── generation-user-message-composer.ts
├── generation-agent-executor.ts       # 单次 Agent Turn 与执行指标
├── generation-agent-runner.ts         # Provider Runner 与选择解析端口
├── generation-task.ts                 # 纯状态对象
├── generation-task-execution.ts       # 三阶段执行
├── generation-task-database.ts        # SQLite 映射
├── generation-task-service.ts         # Project 级活动 Task 集合
└── generation-task-definition-registry.ts

src/main/agents/sessions/
├── agent-session.ts                   # Locator、Provider binding 与领域不变量
├── agent-session-file.ts              # Project 元数据中的原子 session.json
└── agent-session-service.ts           # Project 生命周期、懒缓存与串行写入

src/main/agents/providers/
├── codex-agent-provider.ts            # 凭证入口与 Runner 流式编排
├── codex-generation-environment.ts    # 环境能力盘点与隔离
├── codex-generation-request.ts        # 请求、权限与配置指纹编译
├── codex-generation-response.ts       # Codex 事件和结果映射
└── codex-thread-coordinator.ts         # Thread binding、恢复与 Turn 串行化

src/workbenches/mindmap/generation/
├── mindmap-generation-instruction.ts
├── mindmap-generation-output.ts
├── mindmap-generation-post-processor.ts
└── mindmap-generation-task-definition.ts
```

各模块按职责拆分，核心生产文件保持在约 300 行以内，避免重新形成大型 Service。

## 13. 明确延后

以下内容仍明确延后：

- post-process 返回可修复问题后，持久化 revision-requested 状态并回到同一 Provider Session，
  让 Agent 修改 Workspace 文件，再重新执行 post-process；
- MCP 和模型参数的声明式扩展映射；自定义 Function Tool 与 Skills 的后续权威设计见
  [Agent Function Tool、Skill 与 Codex 动态工具设计](./2026-08-07-agent-function-tools-and-skills-design.md)；
- 成功/失败 Task Workspace 的回收策略。

Generation Center 已通过通用 GenerationTask IPC 发起任务，并展示后台阶段、失败重试和取消；
成功后刷新 generated Asset 列表并打开 `resultAssetId`。下一步重点是模型选择/API 配置，以及
Mind Map 内部提示词、输出约束和校验修复策略的精调。
