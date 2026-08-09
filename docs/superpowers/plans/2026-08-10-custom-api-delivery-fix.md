# 自定义 API（火山方舟）全链路修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通自定义 Responses 兼容 API（火山方舟）的生成任务链路：RPC 边界合成 delta 交付回答，选择器重选不卡死（目录失败降级手填模型 ID）。

**Architecture:** 两项修复。(1) 在 RPC 协议边界（`CodexTurnStream`）加适配层：app-server 对第三方 Responses 兼容 API（火山方舟）不发 `item/agentMessage/delta`，但 `item/completed`（agentMessage 完整文本）正常到达——收到它且该 turn 无 delta 时，把完整文本合成一条 `assistant-message-delta` 注入正常数据流，下游零改动。(2) `AgentProviderSelectorForm` 加 `catalogEpoch` state 重选强制重载模型目录；目录加载失败/卡住时降级为空白可编辑输入框，用户手填模型 ID。

**Tech Stack:** TypeScript 6（strict）、React 19、Vitest、Electron。

## Global Constraints

- 遵循 spec `docs/superpowers/specs/2026-08-10-generation-center-provider-selector-design.md`（Bug #1、#4）。
- 代码注释、错误消息、提交消息用中文。
- 运行测试：`pnpm test -- <path>`；提交前跑 `pnpm check`（typecheck + lint + test）。
- 测试文件与被测代码同目录（`*.test.ts(x)`），vitest 环境为 node。
- 跨进程数据必须通过契约校验（`src/shared/` 的 `is*` 校验器）。
- 不引入新依赖。

---

### Task 1: RPC 边界合成 delta（CodexTurnStream 适配层）

**Files:**
- Modify: `src/main/agents/codex/codex-turn-stream.ts`（`CodexTurnStream` 类，`accept`/`acceptReadyEvent`）
- Create: `src/main/agents/codex/codex-turn-stream.test.ts`（新建，项目该文件无测试）

**Interfaces:**
- Consumes: `CodexRpcIncomingEvent`（`codex-rpc-connection.ts`）；`toTurnEvent`（本文件内部）产出的 `CodexTurnEvent`。
- Produces: 无 delta 的 turn 收到 `item/completed`（agentMessage 含 text）时，队列额外产出 `{ type: 'assistant-message-delta', threadId, turnId, itemId, delta: <完整文本> }`；有 delta 时不合成。

- [ ] **Step 1: 写失败测试**

新建 `codex-turn-stream.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import type { CodexRpcIncomingEvent } from './codex-rpc-connection';
import { CodexTurnStream } from './codex-turn-stream';

function notification(
  method: string,
  params: Record<string, unknown>,
): CodexRpcIncomingEvent {
  return { type: 'notification', method, params };
}

async function collect(
  stream: CodexTurnStream,
): Promise<{ type: string; delta?: string; method?: string }[]> {
  const events: { type: string; delta?: string; method?: string }[] = [];
  let next = await stream.next();
  while (!next.done) {
    const event = next.value as { type: string; delta?: string; method?: string };
    events.push(event);
    if (event.type === 'turn-completed') break;
    next = await stream.next();
  }
  return events;
}

describe('CodexTurnStream delta synthesis', () => {
  it('synthesizes an assistant-message-delta from agentMessage item/completed when no deltas arrived', async () => {
    const stream = new CodexTurnStream('thread-1');
    stream.accept(notification('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'inProgress' },
    }));
    stream.accept(notification('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        id: 'msg-1',
        type: 'agentMessage',
        text: '你好，这是完整回答。',
      },
    }));
    stream.accept(notification('turn/completed', {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        status: 'completed',
        items: [{ id: 'msg-1', type: 'agentMessage', text: '你好，这是完整回答。' }],
      },
    }));

    const events = await collect(stream);
    const deltas = events.filter((e) => e.type === 'assistant-message-delta');
    expect(deltas).toEqual([
      {
        type: 'assistant-message-delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: '你好，这是完整回答。',
      },
    ]);
  });

  it('does not synthesize when real deltas already arrived', async () => {
    const stream = new CodexTurnStream('thread-1');
    stream.accept(notification('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'inProgress' },
    }));
    stream.accept(notification('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'msg-1',
      delta: '你',
    }));
    stream.accept(notification('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'msg-1', type: 'agentMessage', text: '你好，这是完整回答。' },
    }));
    stream.accept(notification('turn/completed', {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        status: 'completed',
        items: [{ id: 'msg-1', type: 'agentMessage', text: '你好，这是完整回答。' }],
      },
    }));

    const events = await collect(stream);
    const deltas = events.filter((e) => e.type === 'assistant-message-delta');
    expect(deltas).toEqual([
      {
        type: 'assistant-message-delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: '你',
      },
    ]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- src/main/agents/codex/codex-turn-stream.test.ts`
Expected: 新测试 FAIL——当前 `CodexTurnStream` 不合成 delta，第一个用例 `deltas` 为空。

- [ ] **Step 3: 实现合成逻辑**

在 `CodexTurnStream`：

1. 新增字段 `private receivedDeltas = false;`，`start()` 重置（新 turn 开始）。
2. `acceptReadyEvent` 中 `event.type === 'assistant-message-delta'` 时置 `receivedDeltas = true`。
3. `item/completed` 分支（`toTurnEvent` 产出 `item-completed`）后，在 `acceptReadyEvent` 内补合成逻辑：

```ts
if (
  event.type === 'item-completed' &&
  event.item.type === 'agentMessage' &&
  typeof event.item.text === 'string' &&
  !this.receivedDeltas
) {
  this.queue.push({
    type: 'assistant-message-delta',
    threadId: event.threadId,
    turnId: event.turnId,
    itemId: event.item.id,
    delta: event.item.text,
  });
}
```

放在现有 `eventTurnId` 校验（`eventTurnId !== this.turnId` return）**之后**、`this.queue.push(event)` 之前。

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- src/main/agents/codex/codex-turn-stream.test.ts`
Expected: 两个用例 PASS。

- [ ] **Step 5: 回归测试**

Run: `pnpm test -- src/main/agents/providers/codex-agent-provider.test.ts src/main/agents/codex/codex-runtime-service.test.ts`
Expected: 全 PASS（`startCodexTurn` 不变，事件流多了合成 delta 不影响既有断言——既有测试的 turn 有真实 delta，不触发合成）。

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/codex/codex-turn-stream.ts src/main/agents/codex/codex-turn-stream.test.ts
git commit -m "feat(codex): synthesize assistant delta from item/completed at RPC boundary

codex app-server 对第三方 Responses 兼容 API（火山方舟）不发送
item/agentMessage/delta，但 item/completed 携带完整 agentMessage 文本。
在 CodexTurnStream（RPC 协议边界）按 turn 统计 delta，收到
agentMessage item/completed 且无 delta 时合成一条
assistant-message-delta 注入正常数据流，下游零改动。
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

Expected: 脚本 step 5 观察到对话面板显示**完整回答**（如"你好，我已经准备好帮你解答关于这份资料的问题了😊"），非空白、非失败提示。

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
