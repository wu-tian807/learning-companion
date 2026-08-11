# 生成中心 AI 执行连接选择器设计

日期：2026-08-10
状态：已落定（Bug #1–#3 已实现；Bug #4 按 PR #20 评审结论改为最终输出方案，2026-08-11 修订）

## 背景

用户反馈三个问题，均在真机 CDP 复现与代码定位后确认：

1. **设置页选择器重选同一连接后，模型下拉消失（"卡在读取模型"）**。
   已复现：在「设置 → AI Provider → 功能模型 → 生成中心」里，把连接从「ChatGPT 账号」切到「Responses-compatible API」再切回「Responses-compatible API」（重选当前已选连接），模型输入框整个消失，应用按钮禁用，界面永远停在加载态。
2. **已配置火山方舟 API，但生成任务仍打到 ChatGPT 账号（api.openai.com）**。
   数据库 `generation_tasks` 记录：失败任务 `11cd4b28` 的 `assigned_connection_id = codex-account`，`assigned_model_id = NULL`；而配置好的 selector 是 `generation-center → codex-api-46ad99e9（火山方舟）→ doubao-seed-2.0-lite`。任务创建时把当时的 selector 配置固化进任务，重试直接复用固化连接，不读取当前 selector。
3. **ChatGPT 账号连接显示"可用"，但实际 key 无效**。
   `~/.codex/auth.json` 中存的 key 无效（`ced537b1` 任务报 401 `Incorrect API key provided: pwd`）。`inspectAccountConnection` 只查本地 codex 进程状态，不验证 key 真伪，UI 因此显示"可用"。

## 目标

- 修复 #1：重选同一连接不再卡死。
- 修复 #2：任务重试时若固化的连接已失效/被删，回退到当前 selector 配置。
- 修复 #3：ChatGPT 账号连接的可用性真实反映到 UI。
- 修复 #4：自定义 API（Responses 兼容）连接下，回答能交付到对话 UI（最终 Assistant 输出作为权威业务结果，delta 只是可选的过程体验）。

## 非目标

- 不新增多 Provider（仍只有 Codex）。
- 不改造 Codex 账户连接的 base_url 注入（账户连接仍走默认 OpenAI；用户应使用 API Connection）。
- 不新增生成任务级"本次用哪个连接"的选择（任务级选择器属于更大改动，另行设计）。

## 现状分析

### 选择器组件（`src/renderer/agents/AgentProviderSelector.tsx`）

- `AgentProviderSelector`（外层）从 store 取 `setup`，把 `providers.flatMap(connections)` 展平成 `connections` 数组传给 `AgentProviderSelectorForm`。
- `AgentProviderSelectorForm`（内层）持有 `selectedConnection` / `modelId` / `reasoningEffort` 三个 state：
  - 连接下拉 `onChange`（`:232-241`）：`setSelectedConnection(value)` + `setModelId('')` + `setCatalog(undefined)` + `setLoadingCatalog(true)`。
  - 模型目录 `useEffect`（`:110-164`）依赖 `[api, resolvedConnectionId, resolvedProviderId]`，加载成功 `setCatalog(next)` + `setLoadingCatalog(false)`。
  - 模型下拉渲染：`catalog?.allowsCustomModel` 为真时渲染 `editable` SelectMenu（输入模型 ID）；否则渲染选项列表 SelectMenu。

### Bug #1 根因

重选**同一连接**时 `resolvedConnectionId` / `resolvedProviderId` 不变，`useEffect` 不重跑，但 `onChange` 已把 `catalog` 置 `undefined`、`loadingCatalog` 置 `true`。于是：
- `catalog?.allowsCustomModel` 恒为假 → 模型下拉（无论 editable 还是选项列表）**不渲染**；
- `applyDisabled = saving || loadingCatalog || !modelId.trim()` 恒为真；
- 界面呈现"正在读取模型…"（实为模型输入框消失）。

### Bug #2 根因

`src/main/generation/generation-task-agent-session.ts` 的 `resolveRunner`（`:162-212`）：
- 任务快照 `assignedProviderId` 存在时，直接用固化配置构造 runner，**跳过** `resolveSelectorConfiguration`（当前 selector）；
- `assignedProviderId` 为 `undefined` 时才查 selector 并 `assignProvider` 固化。

`retry`（`generation-task-service.ts:266-280`）只重新 `scheduleRun`，不重置固化配置。失败任务重试永远走旧连接。

### Bug #3 根因

`src/main/agents/agent-provider-connection-runtime.ts` 的 `inspect`（`:325-358`）：
- account 连接：`provider.inspectAccountConnection(connection, true)` → `codex-agent-provider.ts:204-223` 调 `accountRuntime.getAccount(refreshCredentials)`，仅返回本地 codex 的账号状态（type/email/planType），**不验证 key**；
- api-key 连接：`probeUrl(baseUrl)` HEAD 请求，5 秒超时。

account 连接的"可用"只表示本地 codex 进程有账号状态，不代表 key 能通过 OpenAI 校验。`ced537b1` 的 401 证明状态可"可用"但实际不可用。

## 设计

### 1. 修复选择器重选卡死（Bug #1）

**改动**：`AgentProviderSelectorForm` 增加 `catalogEpoch` state，连接下拉 `onChange` 时 `setCatalogEpoch((epoch) => epoch + 1)`；模型目录 `useEffect` 依赖追加 `catalogEpoch`。effect 重跑时重新 `getAgentProviderModels`。

**模型目录加载失败/卡住时的降级**：模型下拉渲染改为「失败/加载中/无目录 → 显示空白可编辑输入框，用户可手填模型 ID」。具体：
- `catalog` 拉取失败（`setError`）或 `loadingCatalog` 长时间不落地 → 渲染 `editable` SelectMenu（输入框）替代选项列表，placeholder 提示"模型列表不可用，请手动输入模型 ID"。
- api-key 连接 `allowsCustomModel` 本就可手填；account 连接目录失败时同样降级为可编辑输入框。

**效果**：重选同一连接会重新拉取模型目录；目录不可用时用户直接手填模型 ID，不卡死。

### 2. 任务重试回退当前 selector（Bug #2）

**改动**：`src/main/generation/generation-task-agent-session.ts` 的 `resolveRunner`：

```ts
const snapshot = this.task.getSnapshot();
const assignedProviderId = snapshot.assignedProviderId;
const assignedConnectionId = snapshot.assignedConnectionId;
// 若任务固化的连接已不存在（被删/Provider 变更），回退到当前 selector 配置
const configuration =
  assignedProviderId &&
  this.runnerResolver.hasConnection(assignedProviderId, assignedConnectionId)
    ? { providerId: assignedProviderId, connectionId: assignedConnectionId!, ... }
    : await this.runnerResolver.resolveSelectorConfiguration(
        this.prepared.providerSelectorId,
      );
```

需要在 `GenerationAgentRunnerResolver` 接口新增 `hasConnection(providerId, connectionId): boolean`，实现方为 `AgentProviderService`（`agent-provider-service.ts`），检查 `this.connections.find(providerId, connectionId)` 是否存在。

**效果**：连接被删后重试的任务回退到当前 selector（如火山方舟）；连接仍存在时行为不变（保持任务级固化语义）。

**边界**：任务创建时连接存在但后来被删 → 回退 selector；selector 也指向被删连接 → `resolveSelectorConfiguration` 抛 `AGENT_PROVIDER_SELECTION_REQUIRED`，任务以 `AGENT_PROVIDER_SELECTION_REQUIRED` 失败，UI 提示"请先在生成中心选择 AI 执行账号"。可接受。

### 3. 账号连接可用性提示（Bug #3）

**现状**：`inspectAccountConnection` 已传 `refreshCredentials=true`（`codex-agent-provider.ts:209`），语义是"触发 codex 的 token 刷新流程"。但 `ced537b1` 的 401 证明：token 刷新成功（账号状态可读）≠ key 有效。`getAccount` 只返回本地账号状态，不验证 key 能否通过 OpenAI 校验，所以"可用"是假阳性。

**改动**：`inspectAccountConnection` 在 `getAccount` 返回账号后，再做一次**轻量认证探测**：调用 codex runtime 的 `getRateLimits()`（`account/rateLimits/read`，本地 codex 进程转发到 OpenAI，用当前凭据）。成功 → `status: 'ready'`；失败（401 等认证错误）→ `status: 'unavailable'`，statusMessage 中文提示"账号凭据无效，请重新登录"。

**说明**：
- 复用本地 codex 进程（不新增 HTTP 客户端、不把 key 带到主进程）；请求失败即凭据无效。
- `getRateLimits` 是只读探测，无副作用（不触发 token 刷新、不登出）。
- 若真机验证发现 `getRateLimits` 不经过认证校验（如本地直接返回），改用 `listModels({ limit: 1 })` 探测（同样只读、走 OpenAI）。
- 探测失败的网络错误（非认证错误）→ 仍标 `unavailable`，但 statusMessage 用"无法连接 AI 服务"。

**效果**：设置页账号连接卡片显示"不可用（账号凭据无效，请重新登录）"而非"可用"。

### 4. 自定义 API 的最终回答交付（Bug #4）

**背景（真机 + RPC 抓包铁证）**：
- 火山方舟（自定义 API，标准 Responses 协议）SSE 层流式正常（`response.output_text.delta` 一帧帧都有）。
- 但 codex app-server（0.146.0）把 SSE delta 转成私有 `item/agentMessage/delta` 通知时，**只对 OpenAI 官方响应形状适配**；第三方合规 Responses API 的 delta 被静默丢弃——抓包 18 条原始 RPC 通知里 0 条 delta。
- **完整文本在 `item/completed`（agentMessage）与 `turn/completed`（items）里都在**（抓包："你好，我已经准备好帮你解答关于这份资料的问题了😊"）。
- 佐证：`warning` 通知 "Model metadata for doubao-seed-2.0-lite not found. Defaulting to fallback metadata"——app-server 对未知模型 metadata 本就降级。

**方案（已按 PR #20 评审结论落定，取代早期"合成 delta"草案）**：
- **最终 Assistant 输出是权威业务结果**：Provider 从 `turn/completed` 的 `item/agentMessage`（`phase === 'final_answer'`）提取最终文本（`codexAssistantOutputFromTurn`，`codex-generation-response.ts`），经 `GenerationTaskAgentSession.call()` 返回 `assistantOutput`，写入 call checkpoint，供 `TaskDefinition.process()` 形成业务 result。
- **delta 只是可选的过程体验**：真实 `assistant-message-delta` 事件继续按 `agent.call({ assistantEvents: 'runtime' })` 转发；**不在 RPC 边界把完整回答伪装成一条 delta**（假 delta 会污染"delta = 过程、result = 权威"的契约）。
- 交付链路：`assistantOutput → TaskDefinition result.answer → task-completed → Renderer`，Renderer 以 `result.answer` 校正流式缓冲，避免遗漏、重复或截断。
- 无 delta 的 Provider（如 Doubao）任务完成时一次性显示最终答案；OpenAI 正常路径保留真实逐字流式。

**边界**：`item/completed` 的 agentMessage 无 `text` 字段（如纯工具 turn）按 `CODEX_PROTOCOL_ERROR` 失败；对话场景通常只有一个 `final_answer` agentMessage。

## 测试

### 单测

- `AgentProviderSelector.test.tsx`：
  - 模型目录加载失败时渲染可编辑输入框（手填模型 ID），不渲染选项列表。
- `generation-task-agent-session.test.ts`：
  - 任务固化的连接被删后，`resolveRunner` 回退到 selector 配置（`hasConnection` 返回 false → 走 `resolveSelectorConfiguration`）。
  - 连接仍存在时行为不变（`hasConnection` 返回 true → 用固化配置）。
- `agent-provider-service.test.ts`：
  - `hasConnection` 对存在的连接返回 true、不存在的返回 false。
- `codex-agent-provider.test.ts`：
  - `inspectAccountConnection` 在认证探测（`getRateLimits`/`listModels`）失败时返回 `unavailable` 并带中文提示；探测成功时返回 `ready`。
- `codex-generation-response.test.ts`：
  - `codexAssistantOutputFromTurn` 从 `turn/completed` 的 `item/agentMessage`（`phase === 'final_answer'`）提取最终文本；无 `final_answer` 时抛 `CODEX_PROTOCOL_ERROR`。
- `html-assistant-processor.test.ts`：
  - `process()` 返回 `callResult.assistantOutput` 作为业务 `answer`；Provider 无最终输出时诚实失败。
- `conversation-controller.test.tsx`（jsdom）：
  - 完成事件早于 start IPC 返回仍能显示最终回答且 busy 正常结束；
  - 有 delta 时最终 result 校正流式缓冲且不重复。
- `GenerationCenter.test.tsx` 相关测试不受影响（本次不改生成中心 UI）。

### 真机验证（CDP）

- 复现路径：设置页选择器重选同一连接 → 模型下拉恢复（或降级为可编辑输入框）。
- 账号连接卡片：坏 key 显示"凭据无效"。
- 自定义 API 对话链路：打开 HTML 资产 → AI 对话 → 提问 → 对话面板显示完整最终回答（无 delta 的 Provider 一次性显示；不做假 delta）。

## 风险与注意事项

- **Bug #4 交付**：最终 `assistantOutput` 写入 call checkpoint，恢复时可重放；无 delta 的 Provider 在任务完成时一次性显示最终答案。不再在 RPC 边界合成 delta。
- 认证探测端点的选择需真机验证：`getRateLimits` 若不经认证校验，改用 `listModels`。
- 探测会引入一次本地 codex 到 OpenAI 的请求；网络不通时账号连接显示"无法连接 AI 服务"（区分于"凭据无效"）。
- `hasConnection` 接口新增会触碰 `GenerationAgentRunnerResolver` 的所有实现方（目前仅 `AgentProviderService`），测试 mock 需同步。
