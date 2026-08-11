# GenerationTask Process 执行模型

日期：2026-08-08  
状态：已实现

## 1. 为什么替换三阶段控制流

旧模型固定为：

```text
prepare -> 单次 Agent Turn -> post-process
```

它把“Agent 已返回”和“业务产物可用”当成两个只能向前移动的阶段。产物校验失败后，
TaskDefinition 无法在同一任务和同一 Session 中再次调用 Agent，只能把任务标记为失败。
这不适合需要“生成文件、应用校验、按问题修复文件”的 Agent 工作流。

新模型保留可持久化的外层生命周期，但把任务内部控制权交给 Definition：

```text
framework prepare -> TaskDefinition.process(context) -> framework complete
```

外层仍然单调、可恢复；`process()` 内可以顺序调用 Agent、多次校验、修复和提交。
Provider 自己仍负责一次 Turn 内部的 Agent loop，Learning Companion 不实现模型内部循环。

## 2. 职责边界

### GenerationTaskExecution

- 默认准备 Workspace、AssetReference 副本和默认 User Message；
- 创建绑定当前任务主 Workspace 的 `TaskAgentSession`；
- 转发 Agent、状态和输出拒绝事件；
- 持久化 prepare、每次 Agent call 和最终完成 checkpoint；
- 记录失败、取消和 metrics。

### TaskDefinition

- 保留 system instruction、Tool、Skill、MCP、Workspace 和 AssetReference 声明；
- 保留具体 Instruction 的解析与 `toUserMessage()`；
- 只实现一个业务控制函数 `process(context)`；
- 自己发现、校验和提交工作区产物；
- 决定何时再次调用 Agent，而不接触 Provider Registry 或 Session 文件。

核心契约：

```ts
interface TaskDefinition<TInstruction, TResult> {
  // 静态声明略
  process(
    context: GenerationTaskProcessContext<TInstruction>,
  ): Promise<TResult>;
}

interface TaskAgentSession {
  readonly completedCalls: readonly TaskAgentCallResult[];
  call(request: {
    callKey: string;
    purpose: string;
    userMessage?: AgentUserMessage;
  }): Promise<TaskAgentCallResult>;
}
```

一个 GenerationTask 对应一次由产品层发起的 Agent 业务请求。TaskDefinition 的
`process()` 可以为完成该请求执行一次或多次 Provider Turn，例如生成后自动修复；这些
Turn 都属于同一个 GenerationTask，不会变成多个对用户可见的任务。

Definition 只得到任务级 Agent 能力，不得到原始 Provider、Runner 或
`AgentSessionService`。因此它不能绕过用户选择、登录检查、Session 映射和 metrics。

## 3. Session 与多次调用

主 Workspace 的 `(projectId, workspaceKey, instanceKey)` 仍是 Session 定位键。
`TaskAgentSession` 只是每次 `GenerationTask.process()` 获得的调用门面，不决定底层
Session 的生命周期。主 Workspace 未声明 `resolveInstanceKey` 时使用 `taskId`；需要
跨 GenerationTask 延续上下文时，Definition 返回 Conversation ID 等稳定业务键。最终
解析出的 `instanceKey` 同时定位 Workspace 实例和 Provider Session。

每个 GenerationTask 始终拥有独立 `taskId`，用于任务状态、checkpoint 和调用幂等；
这不等于它必须拥有独立 Workspace 或独立 Provider Session。

一次 GenerationTask 的所有逻辑调用：

- 固定到第一次选择成功的 Provider；
- 固定到同一个 Provider Session；
- 逐次执行，不允许同一 Session 并行 Turn；
- 由 `callKey` 标识业务语义，例如 `generate`、`repair-1`、`repair-2`。

Codex 的 `clientUserMessageId` 由 `taskId + callKey` 生成。应用崩溃发生在 Provider
完成和本地 checkpoint 写入之间时，Codex Adapter 可以识别已经完成的 Turn；本地
checkpoint 已存在时则完全不再调用 Provider。

## 4. 恢复模型

GenerationTask 持久化：

```text
prepared
assignedProviderId
agentCalls[]
completed
metrics
failure / cancelledTime
```

`process()` 在恢复时从函数开头重新执行。副作用必须满足以下规则：

- `agent.call()` 使用稳定 `callKey`，已完成调用直接返回 checkpoint；
- Agent 产物保存在任务 Workspace 中，可由后续校验直接读取；
- Generated Asset 以 `taskId` 文件名落地，重复提交保持幂等；
- AssetReference 使用 `ensureReference` 保持幂等。

不保存任意语言 continuation，也不序列化函数栈。恢复依赖稳定逻辑调用和幂等文件/领域
操作，而不是把 TaskDefinition 变成状态机 DSL。

活动状态简化为：

```text
created -> prepared -> processing -> completed
                       |            |
                     failed      cancelled
```

失败的任务保留全部 checkpoint。重试会清除 failure 并重新进入 `process()`。

## 5. Mind Map v1 流程

`MindMapGenerationProcessor.process()` 当前执行：

```text
call generate
  -> 读取 output/mindmap-candidate.json
  -> 校验失败：报告 issues，call repair-N，再校验
  -> 校验成功：创建/复用 Generated Asset
  -> 建立 AssetReference 与节点 source alias 映射
  -> 写入最终 .mindmap 并刷新 Asset
```

单次 process 运行最多发起三次新的 repair Turn，避免无限循环。恢复或用户重试时，
Processor 从 `completedCalls` 计算下一个 repair 编号，因此会继续 `repair-4`，而不会把
已完成的 `repair-1` 当成一次新的模型请求。

候选产物的路径和协议仍由 Mind Map Definition 自己约定；GenerationTask 不声明通用
`outputRef`，也不假设其他 Definition 的产物形态。

## 6. Metrics

每次 Agent call 单独记录：

- `callKey` 与 `purpose`；
- Provider、model、session 和 Provider execution ID；
- started/completed time、active duration；
- usage。

`totalUsage` 聚合所有实际完成的逻辑调用。`processDurationMs` 是整个 `process()` 的墙钟
时间，已经包含其中的 Agent 等待；`totalActiveDurationMs = prepareDurationMs +
processDurationMs`，不会再把 Agent duration 重复相加。任务尚未完成时，暂以已完成 Agent
调用时长作为 process 活动时间。

## 7. 数据库迁移

数据库版本 16 将旧字段：

```text
agent_completed_* + post_processed_*
```

迁移为：

```text
agent_calls_json + process_completed_time + process_result_json
```

旧的单次 Agent checkpoint 映射为 `callKey=generate`、`purpose=generation`。旧失败阶段
`agent` 和 `post-process` 映射为 `process`。未完成任务 partial index 改为过滤
`process_completed_time IS NULL AND cancelled_time IS NULL`。
