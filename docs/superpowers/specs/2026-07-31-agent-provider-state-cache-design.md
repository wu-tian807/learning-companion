# Agent Provider 独立状态缓存设计

> 状态：设计已确认，待实施
>
> 决策日期：2026-07-31
>
> 范围：Main 端 Agent Provider 状态缓存、独立刷新、状态事件和 Renderer 投影。

## 1. 背景

当前 `AgentProviderSettingsSection` 每次挂载都会调用：

```ts
getAgentProviderSetup({ refreshCredentials: true })
```

Main 随后等待所有已注册 Provider 的 Credential 检查完成，再返回完整
`AgentProviderSetupSnapshot`。对于 Codex，这条路径可能包含：

```text
定位 Codex Runtime
→ 启动 app-server 子进程
→ initialize
→ account/read(refreshToken = true)
→ 返回账号状态
```

该实现有三个体验问题：

1. Provider 卡片必须等 Credential 检查完成后才出现；
2. 每次重新进入设置页都会再次同步等待；
3. 多个 Provider 使用整体 `Promise.all`，一个慢 Provider 会阻塞其他 Provider。

Codex Runtime、Provider Registry 和 Agent Provider Service 都是 Main 进程的应用级
对象，因此 Provider 状态的缓存和刷新生命周期也应归 Main 统一管理。Renderer
只消费 Main 发布的状态，不理解缓存命中、刷新时机或并发任务。

## 2. 目标

1. Registry 中的全部 Provider 能快速显示，不等待 Credential 检查。
2. 每个 Provider 独立检查、独立失败、独立渲染。
3. Main 按 `providerId` 保存应用生命周期内的 Credential 状态。
4. 每次读取状态都发起后台复查，但先返回上一时刻的 Main Snapshot。
5. 同一 Provider 的并发刷新合并，不同 Provider 并行。
6. Main 通过事件发布权威 Snapshot，Renderer 只处理状态变化。
7. 登录、选择、手动重查和 Runtime 事件使用同一套状态机。
8. 旧异步结果和旧 IPC 响应不能覆盖更新状态。

## 3. 非目标

- 不把 Credential Snapshot 写入 SQLite 或 `settings.json`；
- 不在 Renderer 实现 TTL、缓存或 Provider 生命周期；
- 不保存 ChatGPT Token、Cookie 或其他登录凭证；
- 不增加定时的全局后台轮询；
- 不实现 Claude Code 等新的 Provider；
- 不改变 Codex App Server 的账号和登录协议；
- 不实现 Agent Lane、Thread 或正式 AI 工作区。

## 4. 核心原则

### 4.1 Main 是唯一状态所有者

`AgentProviderService` 持有每个 Provider 的运行时状态。Provider 实现负责访问自身
Runtime，Registry 负责 Provider 定义，Renderer 只显示 Service 发布的
Snapshot。

```text
AgentProviderRegistry
    Provider 定义和能力
            ↓
AgentProviderService
    providerStates Map
    刷新合并 / 版本保护 / 登录观察 / 状态广播
            ↓
IPC Event
            ↓
Renderer AgentProviderStore
    只保留最新 revision 的渲染投影
            ↓
Provider Cards
```

### 4.2 Provider 独立完成

状态以 `providerId` 为并发和错误隔离边界。Codex 处于 `checking` 时，已经完成
检查的 Claude Code 或其他 Provider 必须能够正常显示和操作。

Main 每次广播完整 Setup Snapshot，而不是 Provider Patch。完整 Snapshot 便于
校验和恢复；Provider 内部仍然独立更新，不使用整体 `Promise.all` 阻塞响应。

### 4.3 Stale While Revalidate

每次 `getAgentProviderSetup()`：

1. 捕获并立即返回 Main 当前 Snapshot；
2. 对所有已注册 Provider 发起后台 Credential 复查；
3. 没有缓存的 Provider 使用 `checking`；
4. 有缓存的 Provider 保留旧 Credential，并进入 `refreshing`；
5. 每个 Provider 完成后分别发布更高 Revision 的 Snapshot。

不使用 TTL。状态读取、手动重查、登录流程和 Runtime 事件是刷新触发点；不存在
固定间隔的全局定时检查。

## 5. Main 运行时模型

`AgentProviderService` 内部维护：

```ts
interface ProviderRuntimeState {
  readonly credential:
    | AgentProviderCredentialSnapshot
    | undefined;
  readonly refreshing: boolean;
  readonly refreshError: string | undefined;
  readonly generation: number;
  readonly refreshTask: Promise<void> | undefined;
}
```

语义：

- `credential === undefined && refreshing`：首次检查；
- `credential !== undefined && refreshing`：保留旧状态并后台复查；
- `refreshError`：最近一次后台复查失败，但仍有可展示的旧 Credential；
- `generation`：阻止旧请求覆盖登录、取消或更新请求产生的新状态；
- `refreshTask`：合并同一 Provider 的并发检查。

该 Map 只存在于 Main 内存。应用退出后自然清空，下次启动重新建立。

## 6. 共享 Snapshot

Credential 增加首次检查状态：

```ts
type AgentProviderCredentialSnapshot =
  | {
      readonly status: 'checking';
    }
  | {
      readonly status: 'authenticated';
      readonly account: AgentProviderAccountSnapshot;
    }
  | {
      readonly status: 'unauthenticated';
    }
  | {
      readonly status: 'unavailable';
      readonly message: string;
    };
```

Provider Snapshot 增加刷新投影：

```ts
interface AgentProviderSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly loginLabel: string;
  readonly selected: boolean;
  readonly credential: AgentProviderCredentialSnapshot;
  readonly refreshing: boolean;
  readonly refreshError?: string;
}
```

Setup Snapshot 增加单调 Revision：

```ts
interface AgentProviderSetupSnapshot {
  readonly revision: number;
  readonly selectedProviderId: string | null;
  readonly activeProviderId: string | null;
  readonly requiresSelection: boolean;
  readonly providers: readonly AgentProviderSnapshot[];
}
```

`revision` 在 Main 每次可观察状态变化时递增。Renderer 只接受高于当前 Revision
的合法 Snapshot，相同 Revision 视为重复消息，避免 IPC Invoke 响应晚于 Event
到达时发生状态回退。

## 7. Service API 与刷新流程

Provider 可以声明可选的 Credential 失效通知：

```ts
interface AgentProviderApi {
  // 既有 Provider 方法省略。
  subscribeCredentialInvalidation?(
    listener: () => void,
  ): () => void;
}
```

Codex Provider 把 Runtime 断开和可识别的账号状态通知转换成失效信号。Service
收到信号后只刷新该 Provider；不支持通知的 Provider 仍由状态读取、手动重查和
登录观察触发刷新。

目标 Service API：

```ts
interface AgentProviderServiceApi {
  getSetup(): AgentProviderSetupSnapshot;
  refreshProvider(providerId: string): AgentProviderSetupSnapshot;
  subscribe(
    listener: (snapshot: AgentProviderSetupSnapshot) => void,
  ): () => void;

  startLogin(
    providerId: string,
  ): Promise<AgentProviderLoginChallenge>;
  cancelLogin(providerId: string, loginId: string): Promise<void>;
  selectProvider(
    providerId: string,
  ): Promise<AgentProviderSetupSnapshot>;
  dispose(): Promise<void>;
}
```

### 7.1 读取全部状态

`getSetup()` 不等待 Provider：

```text
同步组合当前 Snapshot
→ 为未知 Provider 建立 checking 状态
→ 启动或复用各 Provider refreshTask
→ 返回调用开始时捕获的 Snapshot
```

刷新任务可以在 IPC 响应之前发布更新事件，因此 Renderer 必须使用 Revision
处理响应和事件的乱序。

### 7.2 手动重查

`refreshProvider(providerId)`：

- 只处理指定 Provider；
- 没有任务时立即进入 `refreshing` 并发布 Snapshot；
- 已有任务时复用任务；
- 立即返回当前 Snapshot，不等待 Credential 检查完成；
- 最终结果通过统一状态事件发布。

### 7.3 强一致操作

`selectProvider(providerId)` 必须等待该 Provider 的最新检查完成，并且只有
Credential 为 `authenticated` 时才能更新设置。已有进行中的刷新可以复用，
但旧缓存不能单独作为选择成功的依据。

登录开始、取消和完成会推进 Provider 的 `generation`，确保登录前发起的旧检查
不能覆盖登录后的状态。

## 8. 登录状态观察

当前登录完成检查由 Renderer 每 1.2 秒轮询。重构后轮询归 Main：

```text
startLogin(providerId)
→ Provider 返回 LoginChallenge
→ AgentProviderService 启动该 Provider 的登录观察任务
→ 周期性复用 Provider Refresh
→ authenticated / cancel / 新登录替代 / dispose 时停止
```

Renderer 只负责：

- 打开外部登录地址或显示设备码；
- 展示 LoginChallenge；
- 用户主动取消时调用 Cancel；
- 根据 Main Snapshot 更新卡片。

如果 Provider 发布 Credential 失效或登录完成事件，Service 立即触发刷新；轮询
仍作为 Provider 无法提供可靠事件时的兜底。所有检查继续以 `providerId` 隔离。

## 9. 错误与缓存语义

### 9.1 没有旧 Credential

首次检查失败时：

```ts
{
  credential: {
    status: 'unavailable',
    message: '暂时无法检查登录状态，请稍后重试。',
  },
  refreshing: false,
}
```

错误只影响对应 Provider。

### 9.2 已有旧 Credential

后台复查失败时保留旧 Credential：

```ts
{
  credential: previousCredential,
  refreshing: false,
  refreshError: '最新状态检查失败，可重新检查。',
}
```

短暂网络或 Runtime 抖动不会把已登录 Provider 瞬间变成未登录，也不会清除
`activeProviderId`。执行真实 Agent 请求时仍由 Provider Runtime 返回最终可用性。

后续刷新成功时清除 `refreshError`。

### 9.3 Provider Runtime 断开

Provider 通过 `subscribeCredentialInvalidation` 向 Service 报告 Runtime 可用性
变化。断开事件只更新所属 Provider；其他 Provider 和整个设置区域继续可用。

## 10. IPC 与 Preload

IPC 契约调整：

```text
agent-provider:get-setup
    无 refreshCredentials 参数
    立即返回 Main 当前 Snapshot

agent-provider:refresh
    接收 providerId
    立即返回进入 refreshing 后的 Snapshot

agent-provider:changed
    Main → Renderer 完整 Snapshot Event
```

`start-login`、`cancel-login` 和 `select-provider` 保留，但全部接入新的 Service
状态机。

Preload 只暴露：

```ts
getAgentProviderSetup(): Promise<AgentProviderSetupSnapshot>;
refreshAgentProvider(input: {
  readonly providerId: string;
}): Promise<AgentProviderSetupSnapshot>;
onAgentProviderSetupChanged(
  listener: (snapshot: AgentProviderSetupSnapshot) => void,
): () => void;
```

事件数据必须使用 Shared Validator 校验。Main 广播方式复用 External Library
事件设施的既有模式，并在 IPC 清理时释放 Service Subscription。

## 11. Renderer 投影

Renderer 增加共享 `AgentProviderStore` 或等价外部 Store，职责仅包括：

- 订阅 Main Snapshot Event；
- 调用一次 `getAgentProviderSetup()` 获得当前权威状态；
- 按 Revision 合并乱序的响应和事件；
- 向 Settings 和首次引导提供 React Snapshot；
- 转发登录、取消、选择和手动重查命令。

它不包含：

- TTL；
- Credential 缓存命中判断；
- Provider 刷新并发；
- 登录状态轮询；
- Runtime 生命周期。

首次进入页面时，Main 的快速 Snapshot 返回后立即绘制全部 Registry Provider。
每张卡片独立显示：

- `checking`：首次检查；
- `refreshing`：保留已有内容，并显示轻量刷新提示；
- `authenticated`：账号信息；
- `unauthenticated`：登录入口；
- `unavailable`：错误和重新检查；
- `refreshError`：保留旧状态的非阻塞警告。

移除覆盖整个 Provider 列表的 Credential Loading 骨架。只有无法取得或验证
Registry Snapshot 这类整体契约错误，才显示区域级错误。

## 12. 生命周期

- `AgentProviderService` 与 `ApplicationRuntime` 同生命周期；
- Settings 或首次引导卸载不取消 Main 刷新任务；
- 同一 Provider 的重复刷新复用 `refreshTask`；
- 登录观察任务在成功、取消、替代或应用退出时停止；
- `dispose()` 清理 Provider 订阅、登录观察和事件 Listener；
- `ApplicationRuntime.shutdown()` 继续关闭 Codex Runtime；
- Renderer Window 销毁只移除 IPC Listener，不改变 Main Provider 状态。

## 13. 测试策略

### 13.1 Shared

- `checking` Credential 校验；
- `refreshing`、`refreshError` 和 `revision` 校验；
- 非法 Provider Snapshot 和 Event 被拒绝。

### 13.2 AgentProviderService

- 首次读取立即包含全部 Provider 的 `checking` 卡片；
- Codex 挂起时，Claude Code 可以先完成并独立发布；
- 每次 `getSetup()` 都触发后台复查；
- 读取返回旧 Snapshot，不等待刷新；
- 同一 Provider 的并发刷新合并；
- 不同 Provider 并行；
- 一个 Provider 失败不改变其他 Provider；
- 有旧 Credential 时刷新失败保留旧状态；
- 无旧 Credential 时失败进入 `unavailable`；
- 旧 Generation 结果不能覆盖登录后的新状态；
- `selectProvider` 必须等待新检查且拒绝未认证状态；
- 登录观察在成功、取消、替代和 Dispose 后停止。

### 13.3 IPC 与 Preload

- 注册和移除状态事件 Subscription；
- Refresh 请求只接受合法 Provider ID；
- Broadcast 发送完整 Snapshot；
- Preload 丢弃不合法 Event。

### 13.4 Renderer

- 首次 Snapshot 同时渲染所有 Provider；
- Provider 卡片各自显示 `checking`；
- 一个 Provider 完成后不等待其他 Provider；
- 高 Revision Event 不被低 Revision Invoke 响应覆盖；
- Settings 和首次引导共享同一状态投影；
- 手动重查只调用目标 Provider；
- Provider 列表不再被整体 Credential Loading 遮挡。

## 14. 实施边界

按以下独立提交实施：

1. 文档：Agent Provider 独立状态缓存设计；
2. 重构：扩展 Provider Shared Snapshot 与事件契约；
3. 功能：实现 Main Provider 独立状态缓存和刷新；
4. 功能：接入 Provider Snapshot IPC 事件；
5. 重构：统一 Renderer Provider 状态投影；
6. 文档：同步 `TECH_STACK.md` 与实施状态。

每个代码提交前运行相关测试，全部完成后执行：

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

本设计不自动 Push。实现完成后先进行本地人工验收，再由用户决定是否推送。
