# 自定义 API（火山方舟）全链路修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通自定义 Responses 兼容 API（火山方舟）的生成任务全链路：回答能交付到对话 UI，选择器重选不再卡死。

**Architecture:** 两项修复。(1) `startCodexTurn` 在流式循环统计 delta；turn 完成时若无任何 delta（第三方 API 下 codex app-server 不发 `item/agentMessage/delta`），从 `turn.items[].agentMessage.text` 提取完整回答作为一次 `assistant-delta` yield——对话 UI 无需改动即显示回答。(2) `AgentProviderSelectorForm` 加 `catalogEpoch` state，重选同一连接时强制重新拉取模型目录。

**Tech Stack:** TypeScript 6（strict）、React 19、Vitest、Electron。

## Global Constraints

- 遵循 spec `docs/superpowers/specs/2026-08-10-generation-center-provider-selector-design.md`（Bug #1、#4）。
- 代码注释、错误消息、提交消息用中文。
- 运行测试：`pnpm test -- <path>`；提交前跑 `pnpm check`（typecheck + lint + test）。
- 测试文件与被测代码同目录（`*.test.ts(x)`），vitest 环境为 node。
- 跨进程数据必须通过契约校验（`src/shared/` 的 `is*` 校验器）。
- 不引入新依赖。

---

### Task 1: turn 完成时从 items 兜底提取回答

**Files:**
- Modify: `src/main/agents/providers/codex-agent-provider.ts:458-563`（`startCodexTurn`）
- Test: `src/main/agents/providers/codex-agent-provider.test.ts`

**Interfaces:**
- Consumes: `CodexTurn`（`codex-runtime-types.ts`）——`items[].type === 'agentMessage'` 且含 `text: string`。
- Produces: `startCodexTurn` 在无 delta 时额外 yield `{ type: 'assistant-delta', delta: <完整文本> }`；既有 delta 时不重复。

- [ ] **Step 1: 写失败测试——无 delta 时兜底 yield 完整文本**

在 `describe('CodexAgentProvider')` 内、`startTurn` mock 用 `completedTurn` 返回（其 `items[0]` 是 `userMessage`、`items[1]` 是 `agentMessage`，见 `completedTurn` 工厂）——**但现有 `startTurn` mock 流里没有 `assistant-message-delta` 事件**，这正是要覆盖的场景。新增测试：

```ts
it('yields the final agent message text as a delta when the stream produced none', async () => {
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
  const { events } = await collectTurn(
    runAccountTurn(provider, request),
  );

  const deltas = events.filter(
    (event) => event.type === 'assistant-delta',
  );
  expect(deltas).toHaveLength(1);
  expect(deltas[0]).toEqual({
    type: 'assistant-delta',
    delta: JSON.stringify({ answer: '火山方舟回答' }),
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- src/main/agents/providers/codex-agent-provider.test.ts`
Expected: 新测试 FAIL（`deltas` 长度为 0，因为当前 `startCodexTurn` 不兜底）。

- [ ] **Step 3: 实现兜底逻辑**

在 `codex-agent-provider.ts` 的 `startCodexTurn`：

1. 流式循环前初始化 `let receivedAnyDelta = false;`
2. `assistant-message-delta` 分支里 `yield` 后置 `receivedAnyDelta = true;`（`codex-agent-provider.ts:529-530` 附近）。
3. `next.done` 且 `turn.status === 'completed'` 分支、`return` 前：

```ts
if (!receivedAnyDelta) {
  const finalText = (next.value.turn.items ?? [])
    .filter(
      (item): item is { readonly type: 'agentMessage'; readonly text: string } =>
        item.type === 'agentMessage' && typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n');

  if (finalText.trim().length > 0) {
    yield { type: 'assistant-delta', delta: finalText };
  }
}
```

放在 `next.value.turn.status !== 'completed'` 检查**之后**、构造 `return` 对象**之前**（保证只对 completed turn 兜底）。

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- src/main/agents/providers/codex-agent-provider.test.ts`
Expected: 新测试 PASS；既有测试全 PASS（既有 delta 场景 `receivedAnyDelta` 为 true，不触发兜底，`events` 断言不变）。

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/providers/codex-agent-provider.ts src/main/agents/providers/codex-agent-provider.test.ts
git commit -m "fix(codex): fall back to turn items for assistant text when no deltas arrive

第三方 Responses 兼容 API（火山方舟）下 codex app-server 不发送
item/agentMessage/delta 通知，对话 UI 收不到流式回答。turn 完成时
若无任何 delta，从 turn.items 提取 agentMessage 文本作为一次
assistant-delta 交付。
"
```

---

### Task 2: 选择器重选同一连接强制重载模型目录

**Files:**
- Modify: `src/renderer/agents/AgentProviderSelector.tsx:74-164`（`AgentProviderSelectorForm`）
- Test: 无单测（vitest 为 node 环境，`renderToStaticMarkup` 不跑 effect；React 组件 effect 行为按仓库惯例用 CDP 真机验证，见 Task 3 Step 3）

**Interfaces:**
- Consumes: `AgentProviderSetupApi.getAgentProviderModels`（`agent-provider-api.ts`）。
- Produces: 重选同一连接时模型目录 effect 重跑；`catalog` 恢复、`loadingCatalog` 复位。

- [ ] **Step 1: 实现 catalogEpoch**

在 `AgentProviderSelectorForm`：

```ts
const [catalogEpoch, setCatalogEpoch] = useState(0);
```

连接下拉 `onChange`（`:232-241`）末尾加 `setCatalogEpoch((epoch) => epoch + 1);`；模型目录 `useEffect` 依赖 `[api, resolvedConnectionId, resolvedProviderId]` 改为 `[api, resolvedConnectionId, resolvedProviderId, catalogEpoch]`。

- [ ] **Step 2: 运行既有测试确保不回归**

Run: `pnpm test -- src/renderer/agents/AgentProviderSelector.test.tsx`
Expected: 既有测试 PASS（静态渲染不跑 effect，不受影响）。

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/agents/AgentProviderSelector.tsx
git commit -m "fix(selector): reload model catalog when re-selecting the same connection

连接下拉 onChange 重置 catalog 但 effect 依赖连接 ID 不变导致不重跑，
模型下拉永远消失。引入 catalogEpoch 作为 effect 依赖，重选强制重载。
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

Expected: 脚本 step 5 观察到回答流式出现（`>>> ANSWER PRESENT`），对话面板显示"已收到，连通正常…"类完整回答。

- [ ] **Step 2: 验证对话历史持久化**

提问完成后查数据库 `workbench_state_data`：应有 `html` workbench 的对话索引记录，`entries` 含刚提问的问题与回答。

```bash
python -c "import sqlite3; con=sqlite3.connect(r'C:\Users\20935\AppData\Roaming\Learning Companion\data\learning-companion.sqlite3'); print(con.execute('select asset_id, workbench_id, data_key, length(data) from workbench_state_data').fetchall())"
```

- [ ] **Step 3: 验证选择器重选不再卡死**

设置 → AI Provider → 功能模型 → 生成中心：重选「Responses-compatible API」（当前已选）→ 模型输入框恢复、可编辑、可应用。

```bash
PYTHONIOENCODING=utf-8 python scripts/repro_selector_bug.py
```

Expected: 脚本 `reselect` 段模型输入框 `modelValue` 存在（非消失）。

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
