# 自定义 API（火山方舟）全链路修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通自定义 Responses 兼容 API（火山方舟）的生成任务链路：流式回答失败时如实报错，选择器重选不卡死（目录失败降级手填模型 ID）。

**Architecture:** 两项修复。(1) `startCodexTurn` 在流式循环统计 delta；turn 完成时若无任何 delta（第三方 API 下 codex app-server 不发 `item/agentMessage/delta`），**抛 `CODEX_REQUEST_FAILED` 如实报错**，不拿 turn.items 兜底伪装交付。(2) `AgentProviderSelectorForm` 加 `catalogEpoch` state 重选强制重载模型目录；目录加载失败/卡住时降级为空白可编辑输入框，用户手填模型 ID。

**Tech Stack:** TypeScript 6（strict）、React 19、Vitest、Electron。

## Global Constraints

- 遵循 spec `docs/superpowers/specs/2026-08-10-generation-center-provider-selector-design.md`（Bug #1、#4）。
- 代码注释、错误消息、提交消息用中文。
- 运行测试：`pnpm test -- <path>`；提交前跑 `pnpm check`（typecheck + lint + test）。
- 测试文件与被测代码同目录（`*.test.ts(x)`），vitest 环境为 node。
- 跨进程数据必须通过契约校验（`src/shared/` 的 `is*` 校验器）。
- 不引入新依赖。

---

### Task 1: 流式回答缺失时如实报错

**Files:**
- Modify: `src/main/agents/providers/codex-agent-provider.ts:458-563`（`startCodexTurn`）
- Test: `src/main/agents/providers/codex-agent-provider.test.ts`

**Interfaces:**
- Consumes: `CodexTurn`（`codex-runtime-types.ts`）；`AppError`（`src/main/errors/app-error.ts`）。
- Produces: `startCodexTurn` 统计流式 delta；turn 完成时 0 个 delta → 抛 `AppError('CODEX_REQUEST_FAILED', { cause: new Error('Codex 未返回流式回答：自定义 API 可能不支持增量输出。') })`。有 delta 时行为不变。

- [ ] **Step 1: 写失败测试——无 delta 时抛错**

在 `describe('CodexAgentProvider')` 内新增测试。`startTurn` mock 流**不含 `assistant-message-delta`**，`turn/completed` 用 `completedTurn`（其 `items` 含 `agentMessage` 文本——测试同时证明**有 items 也报错**，不兜底）：

```ts
it('fails with CODEX_REQUEST_FAILED when the turn produced no assistant deltas', async () => {
  const sessions = createSessions();
  const startTurn = vi.fn(async function* () {
    yield {
      type: 'turn-started' as const,
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'inProgress' },
    };
    return {
      threadId: 'thread-1',
      turn: completedTurn('unused-live-client-id', {
        answer: '火山方舟回答',
      }),
    };
  });
  const runtime = createRuntime({
    getAccount: vi.fn(async () => ({
      account: { type: 'chatgpt' },
      requiresOpenaiAuth: true,
    })),
    readConfig: vi.fn(async () => ({ config: { mcp_servers: {} } })),
    listSkills: vi.fn(async () => []),
    createThread: vi.fn(async () => selection('thread-1')),
    startTurn,
    interruptTurn: vi.fn(async () => undefined),
  });
  const provider = new CodexAgentProvider(runtime, sessions.service, {
    now: () => 3_000,
  });
  const request = createGenerationRequest();

  await expect(
    collectTurn(runAccountTurn(provider, request)),
  ).rejects.toMatchObject({
    code: 'CODEX_REQUEST_FAILED',
    cause: expect.objectContaining({
      message: expect.stringContaining('未返回流式回答'),
    }),
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- src/main/agents/providers/codex-agent-provider.test.ts`
Expected: 新测试 FAIL——当前 `startCodexTurn` 对无 delta 的 completed turn 正常返回，不抛错。

- [ ] **Step 3: 实现报错逻辑**

在 `codex-agent-provider.ts` 的 `startCodexTurn`：

1. 流式循环前初始化 `let receivedAnyDelta = false;`
2. `assistant-message-delta` 分支里 `yield` 后置 `receivedAnyDelta = true;`（`:529-530` 附近）。
3. `next.done` 且 `turn.status === 'completed'` 分支，`return` 前：

```ts
if (!receivedAnyDelta) {
  throw new AppError('CODEX_REQUEST_FAILED', {
    cause: new Error(
      'Codex 未返回流式回答：自定义 API 可能不支持增量输出。',
    ),
  });
}
```

放在 `next.value.turn.status !== 'completed'` 检查**之后**、构造 `return` 对象**之前**。注意：此 throw 在 `try` 块内，`finally` 会正常执行（中断 turn、清理流），符合现有错误路径惯例。

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- src/main/agents/providers/codex-agent-provider.test.ts`
Expected: 新测试 PASS（`rejects.toMatchObject` 命中）；既有测试全 PASS（有 delta 场景 `receivedAnyDelta` 为 true，不抛错）。

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/providers/codex-agent-provider.ts src/main/agents/providers/codex-agent-provider.test.ts
git commit -m "fix(codex): fail the turn honestly when no assistant deltas arrive

第三方 Responses 兼容 API（火山方舟）下 codex app-server 不发送
item/agentMessage/delta 通知，对话 UI 收不到流式回答。turn 完成时
若无任何 delta，抛 CODEX_REQUEST_FAILED 如实报错，不拿 turn.items
兜底伪装交付。
"
```

---

### Task 2: 选择器重选强制重载 + 目录失败降级手填模型

**Files:**
- Modify: `src/renderer/agents/AgentProviderSelector.tsx:74-164`（`AgentProviderSelectorForm`）
- Test: 无单测（vitest 为 node 环境，`renderToStaticMarkup` 不跑 effect；React 组件 effect 行为按仓库惯例用 CDP 真机验证，见 Task 3 Step 3）

**Interfaces:**
- Consumes: `AgentProviderSetupApi.getAgentProviderModels`（`agent-provider-api.ts`）。
- Produces: 重选同一连接时模型目录 effect 重跑；目录加载失败/卡住时渲染**空白可编辑输入框**（placeholder "模型列表不可用，请手动输入模型 ID"），用户手填模型 ID。

- [ ] **Step 1: 实现 catalogEpoch + 失败降级**

在 `AgentProviderSelectorForm`：

```ts
const [catalogEpoch, setCatalogEpoch] = useState(0);
```

连接下拉 `onChange`（`:232-241`）末尾加 `setCatalogEpoch((epoch) => epoch + 1);`；模型目录 `useEffect` 依赖 `[api, resolvedConnectionId, resolvedProviderId]` 改为 `[api, resolvedConnectionId, resolvedProviderId, catalogEpoch]`。

**失败降级**：模型下拉渲染逻辑（`:243-286`）改为——`catalog` 为 `undefined` 且 `loadingCatalog` 为 `true` 时（含长时间卡住），**不显示加载占位**，直接渲染 `editable` SelectMenu 输入框：

```tsx
{catalog?.allowsCustomModel || catalog === undefined ? (
  <SelectMenu
    ariaLabel={`${definition.displayName} 模型`}
    value={modelId}
    disabled={saving}
    placeholder={
      catalog === undefined
        ? '模型列表不可用，请手动输入模型 ID'
        : '输入模型 ID'
    }
    editable
    options={catalog?.models.map((model) => ({
      value: model.id,
      label: model.displayName,
    })) ?? []}
    onChange={setModelId}
    className="w-full"
  />
) : (
  // catalog 已加载且不允许自定义模型：选项列表（原逻辑）
  <SelectMenu ... />
)}
```

注意：`catalog === undefined` 时（无论 loadingCatalog 真假）都渲染可编辑输入框——用户随时可手填，不被加载态阻塞。

- [ ] **Step 2: 运行既有测试确保不回归**

Run: `pnpm test -- src/renderer/agents/AgentProviderSelector.test.tsx`
Expected: 既有测试 PASS（静态渲染不跑 effect，不受影响）。

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/agents/AgentProviderSelector.tsx
git commit -m "fix(selector): reload catalog on re-select; degrade to editable model input

连接下拉 onChange 重置 catalog 但 effect 依赖连接 ID 不变导致不重跑，
模型下拉永远消失。引入 catalogEpoch 强制重载；目录加载失败/卡住时
降级为空白可编辑输入框，用户手填模型 ID，不被加载态阻塞。
"
```

---

### Task 3: 真机验证火山方舟全链路

**Files:**
- Run: `scripts/test_conversation_e2e.py`（现有脚本，改造成本 task 的验收）
- Run: `pnpm dev`（带 `--remote-debugging-port=9222`）

- [ ] **Step 1: 重启应用并跑 E2E**

```bash
taskkill //F //IM electron.exe
npx electron-forge start -- --remote-debugging-port=9222
PYTHONIOENCODING=utf-8 python scripts/test_conversation_e2e.py
```

Expected: 脚本 step 5 观察到对话面板显示**失败提示**（如"AI 回答失败，请重试"或任务失败事件），不显示空白。

- [ ] **Step 2: 验证任务确实失败（如实报错）**

提问完成后查数据库 `generation_tasks`：该任务 `failure_json` 含 `code: CODEX_REQUEST_FAILED`、detail 含"未返回流式回答"。

```bash
python -c "import sqlite3; con=sqlite3.connect(r'C:\Users\20935\AppData\Roaming\Learning Companion\data\learning-companion.sqlite3'); print(con.execute('select asset_id, workbench_id, data_key, length(data) from workbench_state_data').fetchall())"
```

- [ ] **Step 3: 验证选择器重选不再卡死**

设置 → AI Provider → 功能模型 → 生成中心：重选「Responses-compatible API」（当前已选）→ 模型输入框恢复、可编辑、可应用。

```bash
PYTHONIOENCODING=utf-8 python scripts/repro_selector_bug.py
```

Expected: 脚本 `reselect` 段模型输入框 `modelValue` 存在（非消失），可手填模型 ID、可应用。

- [ ] **Step 4: 跑全量检查**

```bash
pnpm check
```

Expected: typecheck + lint + 全部测试 PASS。

- [ ] **Step 5: Commit（如有调试残留清理）**

```bash
git add -A
git commit -m "test(e2e): verify custom-API answer delivery on device
"
```
