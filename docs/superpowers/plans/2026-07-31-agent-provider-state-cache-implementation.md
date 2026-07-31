# Agent Provider 独立状态缓存实施计划

> 对应设计：
> `docs/superpowers/specs/2026-07-31-agent-provider-state-cache-design.md`
>
> 实施日期：2026-07-31
>
> 原则：Main 独占 Provider 状态与刷新任务；Renderer 只保存最新权威投影；
> Provider 独立加载、独立失败；每个功能改动独立测试和提交，不自动 Push。

## 0. 实施前基线

### 检查

```bash
git status --short
git log -5 --oneline
pnpm check
```

确认：

- 只存在用户原有未跟踪文件；
- 当前分支已包含设计提交；
- Provider 相关基线测试全部通过；
- `@openai/codex` 已按锁文件安装。

### 保护约束

- 不修改 SQLite Schema；
- 不保存 Credential Snapshot；
- 不把 Token 或 Runtime 路径暴露给 Renderer；
- 不添加全局定时状态刷新；
- 不让某个 Provider 阻塞其他 Provider；
- 不改变 Codex App Server 登录协议；
- 不自动 Push。

## 1. 扩展 Shared Provider Snapshot

涉及文件：

- 修改 `src/shared/agent-providers.ts`
- 修改 `src/shared/agent-providers.test.ts`
- 修改使用 `AgentProviderSetupSnapshot` 的测试 Fixture
- 修改 `src/main/agents/agent-provider-service.ts` 的临时兼容输出
- 修改 `src/renderer/agents/AgentProviderCard.tsx`

### 数据契约

增加：

```ts
credential.status = 'checking'
AgentProviderSnapshot.refreshing
AgentProviderSnapshot.refreshError?
AgentProviderSetupSnapshot.revision
```

Validator 必须拒绝：

- 非安全整数或负数 Revision；
- 非布尔 `refreshing`；
- 空字符串 `refreshError`；
- `checking` 携带未定义字段；
- 不符合既有账号契约的 authenticated Credential。

### 兼容迁移

在 Main 状态机尚未落地前：

- 现有 Service 生成 `revision: 0`；
- 现有 Provider Snapshot 生成 `refreshing: false`；
- Renderer Card 能渲染 `checking`，但暂不改变读取流程。

### 测试

```bash
pnpm vitest run \
  src/shared/agent-providers.test.ts \
  src/main/agents/agent-provider-service.test.ts \
  src/renderer/agents/AgentProviderCard.test.tsx \
  src/renderer/agents/AgentProviderSetupDialog.test.tsx
pnpm typecheck
pnpm lint
```

### 提交

```text
重构：扩展Agent Provider状态快照
```

## 2. 实现 Main Provider 独立状态机

涉及文件：

- 修改 `src/main/agents/agent-provider.ts`
- 修改 `src/main/agents/agent-provider-service.ts`
- 重写 `src/main/agents/agent-provider-service.test.ts`
- 修改 `src/main/agents/providers/codex-agent-provider.ts`
- 修改 `src/main/agents/providers/codex-agent-provider.test.ts`
- 修改 `src/main/bootstrap/application-runtime.ts`
- 修改 `src/main/bootstrap/create-application-runtime.ts`
- 修改相关 Bootstrap 测试替身

### 2.1 Provider 可选失效信号

在 `AgentProviderApi` 增加：

```ts
subscribeCredentialInvalidation?(
  listener: () => void,
): () => void;
```

Codex Provider 只把以下 Runtime Event 转换为失效信号：

- Runtime 进入 `failed` 或非主动 `stopped`；
- 可识别的 `account/*` 状态通知。

普通 Turn、Thread 和其他通知不得触发 Credential 刷新。

### 2.2 Service 状态

`AgentProviderService` 增加：

```text
providerStates Map
listeners Set
revision
loginObservers Map
disposed
```

每个 Provider State 保存：

```text
credential
refreshing
refreshError
generation
refreshTask
```

Provider Registry 元数据与运行时状态分开。Snapshot 每次从 Registry、Settings 和
Provider State 组合，不保存第二份 Provider 定义。

### 2.3 读取与刷新

`getSetup()`：

1. 组合并捕获当前 Snapshot；
2. 对全部 Provider 调用非等待式 `ensureRefresh`；
3. 返回捕获的 Snapshot。

`refreshProvider(providerId)`：

1. 校验 Provider；
2. 启动或复用该 Provider 的 Refresh Task；
3. 立即返回当前 Snapshot。

刷新开始、成功、失败都发布新 Revision。一个 Provider 的任务不得进入整体
`Promise.all` 返回路径。

### 2.4 错误语义

- 无旧 Credential：失败写入 `unavailable`；
- 有旧 Credential：保留 Credential，写入 `refreshError`；
- 成功：覆盖 Credential，清除 `refreshError`；
- Generation 已过期：丢弃结果，不发布；
- Listener 异常：记录 Warning，不影响 Service。

### 2.5 强一致选择

`selectProvider`：

1. 等待该 Provider 当前或新建的 Refresh Task；
2. 读取最新 State；
3. 只有 `authenticated` 才更新 Settings；
4. 发布包含新选择状态的 Snapshot；
5. 返回最新 Snapshot。

### 2.6 登录观察

`startLogin`：

- Provider 返回 Challenge 后提升 Generation；
- 替代同 Provider 的旧登录观察；
- Main 使用 1.2 秒间隔刷新该 Provider；
- authenticated 后自动停止。

`cancelLogin`：

- 只取消匹配 `loginId` 的观察；
- 调用 Provider Cancel；
- 提升 Generation 并刷新状态。

`dispose`：

- 停止所有登录观察；
- 释放 Provider 失效订阅；
- 清空 Listener；
- 等待已经被 Service 接纳的清理任务。

### 2.7 ApplicationRuntime

`ApplicationRuntime` 持有 `AgentProviderService`，退出时先 Dispose Provider Service，
再关闭 Codex Runtime，保证轮询和订阅不会访问已关闭 Runtime。

### 测试

至少覆盖：

- 初始 Snapshot 包含全部 Provider；
- 慢 Provider 不阻塞快 Provider；
- 每次读取发起后台检查；
- 读取不等待 Provider Promise；
- 同 Provider 任务合并；
- 不同 Provider 并行；
- 单 Provider 错误隔离；
- 有缓存失败保留状态；
- 无缓存失败为 unavailable；
- Generation 丢弃旧结果；
- 选择等待新检查；
- 登录观察成功、取消、替代与 Dispose；
- Provider 失效信号只刷新所属 Provider。

运行：

```bash
pnpm vitest run \
  src/main/agents/agent-provider-service.test.ts \
  src/main/agents/providers/codex-agent-provider.test.ts \
  src/main/bootstrap/application-runtime.test.ts
pnpm typecheck
pnpm lint
```

### 提交

```text
功能：实现Provider独立状态缓存
```

## 3. 接入 IPC 与 Preload 状态事件

涉及文件：

- 修改 `src/shared/ipc.ts`
- 修改 `src/shared/ipc.test.ts`
- 修改 `src/main/ipc/agent-providers.ts`
- 修改 `src/main/ipc/agent-providers.test.ts`
- 新增 `src/preload/agent-provider-events.ts`
- 新增 `src/preload/agent-provider-events.test.ts`
- 修改 `src/preload/index.ts`
- 修改 `src/main/bootstrap/register-application-ipc.ts`
- 修改相关 API 测试替身

### IPC 契约

移除：

```ts
AgentProviderSetupRequest
refreshCredentials
```

新增 Channel：

```text
agent-provider:refresh
agent-provider:changed
```

Learning Companion API：

```ts
getAgentProviderSetup(): Promise<AgentProviderSetupSnapshot>;
refreshAgentProvider(
  request: AgentProviderIdRequest,
): Promise<AgentProviderSetupSnapshot>;
onAgentProviderSetupChanged(
  listener: (snapshot: AgentProviderSetupSnapshot) => void,
): () => void;
```

### Main Event Forwarding

`registerAgentProviderHandlers`：

- 注册前释放旧 Subscription；
- 订阅 `AgentProviderService`；
- 向所有未销毁 Window 广播完整 Snapshot；
- Remove 时释放 Subscription 和所有 Handler。

### Preload

事件 Adapter：

- 只监听固定 Channel；
- 使用 `isAgentProviderSetupSnapshot` 校验；
- 非法 Event 静默丢弃；
- Dispose 精确移除包装后的 Listener。

### 测试

```bash
pnpm vitest run \
  src/shared/ipc.test.ts \
  src/main/ipc/agent-providers.test.ts \
  src/preload/agent-provider-events.test.ts \
  src/main/bootstrap/register-application-ipc.test.ts
pnpm typecheck
pnpm lint
```

### 提交

```text
功能：广播Agent Provider状态变化
```

## 4. 统一 Renderer Provider 状态投影

涉及文件：

- 新增 `src/renderer/agents/agent-provider-store.ts`
- 新增 `src/renderer/agents/agent-provider-store.test.ts`
- 修改 `src/renderer/agents/agent-provider-api.ts`
- 修改 `src/renderer/agents/use-agent-provider-setup.ts`
- 修改 `src/renderer/agents/AgentProviderCard.tsx`
- 修改 `src/renderer/agents/AgentProviderCard.test.tsx`
- 修改 `src/renderer/agents/AgentProviderSetupDialog.tsx`
- 修改 `src/renderer/agents/AgentProviderSetupDialog.test.tsx`
- 修改 `src/renderer/settings/AgentProviderSettingsSection.tsx`
- 修改 Settings 测试
- 修改 `src/renderer/App.tsx`
- 修改 App Setup 相关测试

### 4.1 Renderer Store

Store 只负责：

```text
当前 Setup Snapshot
连接引用计数
Main Event Subscription
首次 getSetup
Revision 顺序保护
Transport Error
Provider 命令转发
```

Store 不保存：

```text
TTL
Credential Cache Policy
Refresh Task
Login Poll Timer
Runtime State
```

连接顺序：

1. 先订阅 `onAgentProviderSetupChanged`；
2. 再调用 `getAgentProviderSetup`；
3. Event 与 Invoke Response 都进入相同 `applySnapshot`；
4. 只接受更高 Revision；
5. 最后一个消费者断开时只移除 Renderer Listener，不影响 Main。

### 4.2 Controller

`useAgentProviderSetup`：

- 移除 Renderer 登录 Credential Poll；
- 手动刷新改为 `refreshProvider(providerId)`；
- 登录 Challenge 仍属于交互 UI；
- 选择返回的 Snapshot 交给 Store Revision 合并；
- 设置与首次引导共享同一 Store。

### 4.3 Provider Card

每张卡片独立使用：

- `credential.status === 'checking'`；
- `provider.refreshing`；
- `provider.refreshError`；
- 自己的 Busy Provider ID。

移除全局 `checking`。Codex 检查时，其他 Provider 的按钮不能被禁用。

### 4.4 Settings 与 Onboarding

- Settings 移除覆盖整个列表的 Credential Loading Skeleton；
- 快速 Setup Snapshot 返回后立即渲染全部 Provider；
- 只有 Transport/契约错误显示区域级错误；
- Onboarding 使用同一 Store Snapshot；
- Main 状态刷新不因 Settings 或 Dialog 卸载而中止。

### 测试

至少覆盖：

- 初始 Provider 全部出现；
- 每张卡片独立 checking/refreshing；
- 一个 Provider 完成不等待其他 Provider；
- 低 Revision Response 不覆盖高 Revision Event；
- 重复 Revision 不产生回退；
- 多消费者只建立一个 Event Subscription；
- 最后消费者断开后移除 Listener；
- 手动重查只请求对应 Provider；
- Renderer 不再发 Credential Poll；
- Settings 不再显示整体 Credential Loading Skeleton。

运行：

```bash
pnpm vitest run \
  src/renderer/agents/agent-provider-store.test.ts \
  src/renderer/agents/AgentProviderCard.test.tsx \
  src/renderer/agents/AgentProviderSetupDialog.test.tsx \
  src/renderer/components/SettingsDialog.test.tsx
pnpm typecheck
pnpm lint
```

### 提交

```text
重构：统一Provider渲染状态投影
```

## 5. 同步文档与完整验证

涉及文件：

- 修改 `TECH_STACK.md`
- 更新设计文档状态
- 更新本实施计划状态

记录：

- Main `AgentProviderService` 是状态和刷新事实来源；
- Provider 按 ID 独立检查与错误隔离；
- 每次状态读取使用 stale-while-revalidate；
- Renderer Store 只是带 Revision 的状态投影；
- Provider 登录观察从 Renderer 移入 Main；
- Provider 状态不持久化。

### 完整验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
git diff --check
git status --short
```

### 人工验收

1. 首次进入 AI Provider，立即看到 Codex 卡片和独立检查状态；
2. 关闭再打开设置，旧状态立即出现，随后静默刷新；
3. 连续打开 Settings 不产生多个 Codex Runtime 或重复检查任务；
4. Codex 不可用时其他 Provider 卡片仍能操作；
5. 手动重新检查只影响目标卡片；
6. 登录完成后无需 Renderer 轮询即可更新卡片；
7. Settings 与首次引导状态一致；
8. 关闭 Settings 不会取消 Main 检查；
9. 应用退出时 Provider 登录观察和 Codex Runtime 正常释放。

### 提交

```text
文档：同步Provider状态缓存架构
```

人工验收前不 Push。
