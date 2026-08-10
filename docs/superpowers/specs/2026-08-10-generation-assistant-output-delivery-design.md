# 生成任务 assistant 输出流式交付设计

日期：2026-08-10
状态：待审阅（设计先行，未实现）

## 背景

火山方舟等第三方 Responses 兼容 API 下，codex app-server（0.146.0）不发送 `item/agentMessage/delta` 通知（只适配 OpenAI 官方响应形状），对话 UI 收不到流式回答。此前在 `CodexTurnStream`（RPC 边界）做了"无 delta 时从 `item/completed` 合成完整文本为一条 `assistant-message-delta`"的适配，但经架构审查发现三处问题，撤回重设计：

1. **语义混淆**：合成的是"最终结果回退"，不是真实流式；不应伪装成 stream delta。
2. **层级混淆**：Provider/Codex 边界的归一化能力，被无条件泄露到所有 GenerationTask（MindMap 等以文件为产物的任务也会收到 assistant-delta 事件）。
3. **需求未定**：尚未确认哪些业务场景真正需要 delta，默认策略、callKey 归属、checkpoint 重放等均未设计。

## 现状链路（已核实）

调用：
```
TaskDefinition.process()
  → TaskAgentSession.call()
  → GenerationTask / GenerationTaskAgentSession
  → AgentProvider
  → Codex Runtime
```

事件返回：
```
Codex Runtime
  → AgentProvider（Provider 特化事件归一化）
  → GenerationTask（生命周期、checkpoint、是否向业务发布）
  → IPC / 具体业务消费者
```

关键事实：
- `GenerationAgentEvent.assistant-delta`（`generation-agent-runner.ts:18`）是 Provider 层归一化产物。
- `GenerationTaskAgentSession.call()`（`generation-task-agent-session.ts:129-134`）把 agent 事件**全部 emit**，经 `generation-task-execution.ts:285` → `generation-task-service.ts:428` 无条件 `publish('execution-event')` 到所有订阅者。
- **没有按 TaskDefinition/调用方过滤**——任何 Provider 产出的 delta 都会广播给所有任务订阅者。

## 设计决策

### 1. 哪些业务场景需要 delta？

| 场景 | 需要 delta 吗 | 原因 |
|---|---|---|
| HTML 资料对话（html.assistant） | **需要最终文本** | 回答要显示给用户；流式是体验增强 |
| 思维导图生成（mindmap.generate） | 不需要 | 产物是文件，不展示文本 |
| 学习提纲/知识卡片/摘要 | 待定 | 若产物是文件则不需要；若对话式则需要 |
| 任务进度 UI（生成中心列表） | 不需要 delta | 只需要 status/阶段事件 |

**结论**：目前唯一明确需要的是 html.assistant 的最终文本交付。流式（逐字）无已确认的消费者。

### 2. 兜底 vs 真实流式？

- **真实流式**（逐字 delta）：需要解决 codex app-server 对第三方 API 不转发 delta 的问题——这发生在 app-server 内部（闭源），我们**无法在应用侧修复**；除非换用非流式请求或自行实现 SSE 解析（绕过 app-server，属于大改动，且绕过了 Codex Runtime 的完整生命周期）。
- **最终文本兜底**：`turn/completed` 或 `item/completed` 的 `agentMessage.text` 是 app-server 实际交付的完整文本，可靠。

**结论**：先做**最终文本兜底**（解决"结果丢失"），真实流式作为未来增强（依赖 app-server 修复或自行 SSE）。

### 3. 每次 agent.call() 显式选择？默认策略？

```ts
// TaskAgentCallRequest 增加字段
readonly publishAssistantOutput?: boolean;
// 默认 false（不向外发布 assistant 输出）
```

- `html.assistant` 的 `process()` 里 `agent.call({ ..., publishAssistantOutput: true })`。
- 默认保持内部事件（现状行为），不改变 MindMap 等任务。

### 4. 多次 agent call 时事件如何携带 callKey？

- `GenerationAgentEvent` 增加 `callKey`（及必要时的 `purpose`）字段（Provider 层填充，`runTurn` 的 request 已携带 callKey）。
- 消费方（对话 UI）按 callKey 区分哪次 call 的输出。
- 兼容：现有事件消费者按需忽略新字段（类型是联合类型，新增字段需同步契约与校验器）。

### 5. checkpoint、失败恢复、事件重放？

- `generation_task` 表已有 `agent_calls_json`（callKey、sessionId、providerExecutionId、completedTime）。
- **恢复策略**：任务恢复时（`GenerationTaskAgentSession.resolveRunner` 已按 assigned 配置恢复），若某 callKey 已有 checkpoint 则跳过重放（`completedCalls` 逻辑已存在）；已完成的 call 不再发布 delta（`call()` 对 existing 直接返回）。
- **重放去重**：`findRecoveredCodexTurn`（`codex-generation-response.ts:174`）已按 clientUserMessageId 识别已完成的 turn——恢复时不再重跑。因此 delta 不会重复。
- **事件重放**：任务级事件（execution-event）不持久化，重试时新任务重新发布；对话 UI 的 append 只在任务成功且文本非空时写历史——恢复场景下最终文本从兜底事件再发布一次，历史不重复。

### 6. Renderer/Workbench 谁消费？

- 现有 `ConversationOverlay`（html 对话，feature 分支）订阅 `onGenerationTaskChanged` 的 `execution-event.assistant-delta`——保持。
- **不新增统一生成中心对话 UI**；本设计只提供"任务能发布最终 assistant 文本"的能力，具体消费由各 Workbench 自行决定。
- html.assistant 的 `process()` 设 `publishAssistantOutput: true` 后，对话 UI 无需改动即可收到最终文本（一次 delta）。

### 7. 第三方无 delta 时，一整块文本定义为什么？

**定义为 `completion/fallback`，不是 `stream delta`**：
- Provider 归一化后仍产出 `assistant-delta`（保持下游契约稳定），但语义在文档中明确为"最终文本"。
- 或引入 `assistant-final` 新事件类型（更准确，但需改契约+校验器+消费者）。
- **决策**：保持 `assistant-delta` 事件类型不变（YAGNI——目前无消费者区分流式与整块），但实现位置从 RPC 边界移到 **Provider 边界**（`CodexAgentProvider.startCodexTurn`），按 `publishAssistantOutput` 决定是否向外发布。

## 实现位置（修正）

```
Codex Runtime（原始事件，含 item/completed 完整文本）
  → CodexAgentProvider（归一化：无 delta 时从 turn.items 提取最终文本）
  → GenerationTaskAgentSession（按 call().publishAssistantOutput 决定是否 emit）
  → generation-task-service（publish execution-event）
  → IPC → 消费者
```

- **RPC 边界（CodexTurnStream）不合成**（还原此前改动）——它只做协议解析。
- **Provider 边界归一化**：`CodexAgentProvider.startCodexTurn` 统计 delta，无 delta 且 turn completed 时把 `turn.items` 的 agentMessage 文本作为一次 `assistant-delta` 产出。
- **发布决策在 GenerationTask 层**：`TaskAgentCallRequest.publishAssistantOutput` 控制是否向外 emit（默认 false）。

## 未决问题（需用户确认）

1. `publishAssistantOutput` 默认 false 是否合适？（还是默认 true 仅 html.assistant 关闭？）
2. 是否引入 `assistant-final` 新事件类型，还是保持 `assistant-delta` 复用？（建议保持，YAGNI）
3. 学习提纲/知识卡片/摘要等未来任务是否需要 delta？（影响默认值）
