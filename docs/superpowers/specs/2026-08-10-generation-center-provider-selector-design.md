# 生成中心 AI 执行连接选择器设计

日期：2026-08-10
状态：待审阅

## 背景

用户反馈三个问题，均在真机 CDP 复现与代码定位后确认：

1. **设置页选择器重选同一连接后，模型下拉消失（"卡在读取模型"）**。
   已复现：在「设置 → AI Provider → 功能模型 → 生成中心」里，把连接从「ChatGPT 账号」切到「Responses-compatible API」再切回「Responses-compatible API」（重选当前已选连接），模型输入框整个消失，应用按钮禁用，界面永远停在加载态。
2. **已配置火山方舟 API，但生成任务仍打到 ChatGPT 账号（api.openai.com）**。
   数据库 `generation_tasks` 记录：失败任务 `11cd4b28` 的 `assigned_connection_id = codex-account`，`assigned_model_id = NULL`；而配置好的 selector 是 `generation-center → codex-api-46ad99e9（火山方舟）→ doubao-seed-2.0-lite`。任务创建时把当时的 selector 配置固化进任务，重试直接复用固化连接，不读取当前 selector。
3. **ChatGPT 账号连接显示"可用"，但实际 key 无效**。
   `~/.codex/auth.json` 中存的 key 无效（`ced537b1` 任务报 401 `Incorrect API key provided: pwd`）。`inspectAccountConnection` 只查本地 codex 进程状态，不验证 key 真伪，UI 因此显示"可用"。
4. **生成中心页面没有 AI 执行连接入口**，用户只能进设置改。

## 目标

- 修复 #1：重选同一连接不再卡死。
- 修复 #2：任务重试时若固化的连接已失效/被删，回退到当前 selector 配置。
- 修复 #3：ChatGPT 账号连接的可用性真实反映到 UI。
- 实现 #4：生成中心直接可选 AI 执行连接，不用进设置。

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

**改动**：`AgentProviderSelectorForm` 增加 `catalogEpoch` state，连接下拉 `onChange` 时 `setCatalogEpoch((epoch) => epoch + 1)`；模型目录 `useEffect` 依赖追加 `catalogEpoch`。effect 重跑时重新 `getAgentProviderModels` 并 `setCatalog` / `setLoadingCatalog(false)`。

**效果**：重选同一连接会重新拉取模型目录（api-key 连接是本地静态返回，瞬时完成；account 连接走 codex 拉取），模型下拉恢复。

**备选（不采用）**：`onChange` 中不重置 `catalog` 直接保留旧目录——语义不清晰（连接换了模型目录可能不同），且会闪现旧连接模型。采用 epoch 方案。

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

**改动**：`src/main/agents/providers/codex-agent-provider.ts` 的 `inspectAccountConnection` 增加对 key 有效性的探测：

- 在 `getAccount(refreshCredentials)` 返回 `ready` 后，再调 `accountRuntime.getAccount(true)`（强制刷新凭据，若刷新失败/无有效凭据则 `status: 'unavailable'`，statusMessage 中文提示）。
- 若刷新成功但 `account.type` 不是已知可用类型（如 `'pwd'` 疑似错误配置），标记 `status: 'unavailable'` 并提示"账号凭据无效，请重新登录"。

**说明**：`getAccount(true)` 的 refreshToken 语义是强制刷新 codex 账号 token，刷新失败通常意味着凭据过期/无效。这是低成本、无网络请求的探测（本地 codex 进程内完成），不会卡 UI。

**效果**：设置页账号连接卡片显示"不可用（账号凭据无效，请重新登录）"而非"可用"。

### 4. 生成中心 AI 执行选择条（Feature #4）

**位置**：`src/renderer/generation/GenerationCenter.tsx`，`beforeList` 顶部、「通用生成工具」标题之前。

**形态**：一条紧凑横条，含两个 SelectMenu（复用 `SelectMenu` 组件）：
- 连接下拉（`ariaLabel="生成中心 AI 执行账号"`）：选项为所有 provider 的所有 connection，label 形如 `Codex · Responses-compatible API`（复用 `AgentProviderSelector` 的 `connectionValue` 拼法）。
- 模型下拉：连接对应的模型目录（api-key 连接 `allowsCustomModel` 时为 editable 输入框；account 连接为选项列表）。不展示思考力度（沿用 selector 保存的值，不占空间）。

**数据流**：
- 复用 `agentProviderStore`（`src/renderer/agents/agent-provider-store.ts`）+ `defaultAgentProviderSetupApi`，与设置页同一 store 实例，状态同步。
- 初始值：`setup.selections` 中 `selectorId === 'generation-center'` 的 `providerId/connectionId/modelId`。
- 选择连接或模型时：调 `selectAgentProviderForSelector` 保存（与设置页相同），store `applySnapshot` 刷新；**不自动触发任何生成**。
- 展示当前选择：横条标题「AI 执行账号」，副标题显示当前连接 displayName + 模型 ID（如 `火山方舟 · doubao-seed-2.0-lite`）。

**错误处理**：保存失败显示行内错误文案；`catalog` 拉取失败（account 连接时）显示"无法读取模型列表，可直接填写模型 ID"（已有文案），editable 输入框仍可输入。

**组件划分**：新建 `src/renderer/generation/GenerationCenterProviderSelector.tsx`（纯展示 + store 连接），与 `AgentProviderSelector` 共享逻辑（连接扁平化、目录拉取、保存）。考虑抽取公共 hook `useAgentProviderSelector(selectorId)` 供两处复用，避免复制粘贴。

**范围**：仅接入 `generation-center` selector（生成中心）。其他 selector（如有）不动。

## 测试

### 单测

- `AgentProviderSelector.test.tsx`：
  - 重选同一连接后模型下拉恢复（epoch 触发重新拉取）——mock API 返回目录，断言第二次选中同一连接后 `getAgentProviderModels` 被调用两次、模型下拉渲染。
- `generation-task-agent-session.test.ts`：
  - 任务固化的连接被删后，`resolveRunner` 回退到 selector 配置（`hasConnection` 返回 false → 走 `resolveSelectorConfiguration`）。
  - 连接仍存在时行为不变（`hasConnection` 返回 true → 用固化配置）。
- `agent-provider-service.test.ts`：
  - `hasConnection` 对存在的连接返回 true、不存在的返回 false。
- `codex-agent-provider.test.ts`：
  - `inspectAccountConnection` 在 `getAccount(true)` 失败时返回 `unavailable`。
- `GenerationCenter.test.tsx`：
  - 渲染 AI 执行选择条，展示当前选择，选择后调用 `selectAgentProviderForSelector`。

### 真机验证（CDP）

- 复现路径：设置页选择器重选同一连接 → 模型下拉恢复。
- 生成中心选择条：切换连接 → 模型下拉加载 → 保存 → 新建生成任务走新连接。

## 风险与注意事项

- `getAccount(true)` 的刷新语义需在真机验证：若刷新本身有副作用（如强制登出），改用只读探测。
- `hasConnection` 接口新增会触碰 `GenerationAgentRunnerResolver` 的所有实现方（目前仅 `AgentProviderService`），测试 mock 需同步。
- 生成中心选择条与设置页选择器是同一 selector 的两处入口，保存互相同步（同一 store + 同一 settings 键）。
