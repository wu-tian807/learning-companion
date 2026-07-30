# 后台运行时安装、全局通知与首次引导实施计划

> 状态：已实施；自动化和打包验证通过，待真实后台下载安装人工验收
>
> 依据：
>
> - `docs/superpowers/specs/2026-07-30-background-runtime-install-and-notifications-design.md`
> - `docs/superpowers/specs/2026-07-30-external-library-runtime-design.md`
>
> 实施原则：Main 先取得完整后台任务所有权，再迁移 Renderer 状态，最后接 UI。
> 每个任务保持可编译、可测试、可独立提交；用户验收前不 push。

## 阶段一：后台安装契约

### 任务 1：补齐 unsupported 状态

修改：

- `src/shared/external-libraries.ts`
- `src/shared/external-libraries.test.ts`
- `src/main/external-libraries/external-library-registry.ts`
- `src/main/external-libraries/external-library-registry.test.ts`
- `src/main/external-libraries/external-library-service.ts`
- `src/main/external-libraries/external-library-service.test.ts`
- `src/renderer/components/SettingsDialog.tsx`

步骤：

1. 先为 `ExternalLibraryStatus = 'unsupported'` 和 Snapshot 校验增加失败测试。
   `expectedSize` 只允许在 unsupported 时缺省，其余状态仍要求正整数。
2. Registry 增加不抛错的可选 Package 查询；现有 `selectPackage()` 保留给明确要求
   当前平台包的调用者。
3. Service 发现阶段在没有匹配 platform/architecture Package 时发布
   `unsupported`，不让整个 Library 列表初始化失败。
4. `refresh()` 对 unsupported 返回稳定 Snapshot。
5. `startInstallation()` 和 `requireExecutable()` 对 unsupported 返回
   `FEATURE_NOT_SUPPORTED`。
6. 迁移时跳过 unsupported Definition，但仍更新全局外部组件根目录。
7. Settings 临时补上“当前平台暂不支持”状态文案；该状态不显示其他平台的
   下载体积，确保中间提交可用。

测试：

```text
pnpm test -- src/shared/external-libraries.test.ts
pnpm test -- src/main/external-libraries/external-library-registry.test.ts
pnpm test -- src/main/external-libraries/external-library-service.test.ts
pnpm typecheck
```

建议提交：

```text
功能：支持不可用平台的外部组件状态
```

### 任务 2：把安装改为任务接纳语义

修改：

- `src/main/external-libraries/external-library-service.ts`
- `src/main/external-libraries/external-library-service.test.ts`
- `src/main/ipc/external-libraries.ts`
- `src/main/ipc/external-libraries.test.ts`
- `src/shared/ipc.ts`
- `src/shared/ipc.test.ts`
- `src/preload/index.ts`

步骤：

1. 用可控 Downloader 增加失败测试，证明开始安装接口在下载完成前返回
   `downloading` Snapshot。
2. 将 `install()` 改名为 `startInstallation()`。
3. 在 Service 内创建 `ActiveInstallation` 后立即返回 Snapshot；长期 Promise
   只保存在 Main。
4. 后台 Promise 捕获成功、普通失败和 Abort 三种终态：
   - 成功发布 `available`；
   - 普通失败记录日志并发布 `failed + errorCode`；
   - Abort 清理后刷新真实磁盘状态；
   - 任何分支都不留下未处理 rejection。
5. 重复开始安装时返回当前活动 Snapshot，不等待现有任务，也不启动第二次下载。
6. 保留 `shutdown()` 对内部 Promise 的取消和等待。
7. IPC / Preload 改为
   `startExternalLibraryInstallation()`，删除旧的误导命名。
8. 更新所有 Service Fake 和调用点，使编译期间不存在双契约。

关键测试：

- 接口提前返回；
- 重复请求只执行一次下载；
- 后台成功事件；
- 后台失败事件；
- 失败 Promise 不向调用 Renderer 反向 rejection；
- 主动取消恢复实际状态；
- `shutdown()` 等待清理完成；
- IPC 只返回任务已接纳 Snapshot。

测试：

```text
pnpm test -- src/main/external-libraries/external-library-service.test.ts
pnpm test -- src/main/ipc/external-libraries.test.ts
pnpm test -- src/shared/ipc.test.ts
pnpm typecheck
```

建议提交：

```text
重构：让外部组件安装由后台任务持有
```

## 阶段二：首次引导设置契约

### 任务 3：增加 App Setup 持久化和 IPC

新增：

- `src/shared/app-setup.ts`
- `src/shared/app-setup.test.ts`

修改：

- `src/main/settings/settings-repository.ts`
- `src/main/settings/json-settings-repository.ts`
- `src/main/settings/json-settings-repository.test.ts`
- `src/main/ipc/settings.ts`
- `src/main/ipc/settings.test.ts`
- `src/shared/ipc.ts`
- `src/shared/ipc.test.ts`
- `src/preload/index.ts`
- 所有 `SettingsRepository` 测试替身

步骤：

1. 首版定义 External Library 引导版本 `1`；Provider 接入后统一当前版本提升为
   `2`，继续使用不可变 `AppSetupSnapshot`。
2. Snapshot 同时返回 current、completed、派生的 `pendingOnboardingStep` 和
   `requiresOnboarding`。
3. `settings.json` 顶层增加 `completedOnboardingVersion`：
   - 缺失时按 0 读取；
   - 已存在旧设置时自动补写；
   - 非负安全整数有效；
   - 高于当前版本时不降级；
   - 新文件仍保持按需创建。
4. SettingsRepository 增加 `getAppSetup()`、
   `completeExternalLibraryOnboarding()` 和
   `completeAgentProviderOnboarding()`；Renderer 不传任意版本号。
5. 增加 `settings:get-app-setup`、External Library 与 Agent Provider 两个固定
   完成步骤的 IPC。
6. Preload 只暴露读取和完成固定步骤的白名单方法。
7. 验证写入队列仍串行，Home、Workspace 和 External Library Path 字段不丢失。

测试：

```text
pnpm test -- src/shared/app-setup.test.ts
pnpm test -- src/main/settings/json-settings-repository.test.ts
pnpm test -- src/main/ipc/settings.test.ts
pnpm test -- src/shared/ipc.test.ts
pnpm typecheck
```

建议提交：

```text
功能：持久化首次运行引导状态
```

## 阶段三：通用通知基础设施

### 任务 4：实现 Notification Store 和 Host

新增：

- `src/renderer/notifications/notification.ts`
- `src/renderer/notifications/notification-store.ts`
- `src/renderer/notifications/notification-store.test.ts`
- `src/renderer/notifications/NotificationToast.tsx`
- `src/renderer/notifications/NotificationHost.tsx`
- `src/renderer/notifications/NotificationHost.test.tsx`

修改：

- `src/renderer/index.css`（仅在 Tailwind 类不足以表达暂停或动画时）

步骤：

1. 定义 Renderer 内存通知模型：kind、title、message、duration、dedupeKey 和
   可选 action。
2. Notification Store 实现：
   - push；
   - dismiss；
   - dedupe 替换；
   - 自动关闭计时；
   - pause / resume；
   - action 只触发一次；
   - 清理测试和热重载留下的 Timer。
3. Host 最多显示队列前 3 条，其余保留等待。
4. Toast 支持成功、信息、警告和错误视觉层级。
5. 错误通知默认持久，成功通知默认 5 秒。
6. 增加手动关闭、悬停暂停、`aria-live` 和 reduced-motion。
7. 本任务不 import 外部运行时模块，不装配到 `App`。

测试：

- fake timer 自动关闭；
- pause / resume 剩余时间；
- 同 dedupeKey 替换；
- 持久通知；
- action 一次性调用；
- 同时只输出 3 条；
- 语义化 role 和 aria-live。

验证：

```text
pnpm test -- src/renderer/notifications
pnpm typecheck
pnpm lint
```

建议提交：

```text
功能：增加全局通知基础设施
```

## 阶段四：Renderer 外部运行时领域状态

### 任务 5：实现 External Library Store

新增：

- `src/renderer/external-libraries/external-library-store.ts`
- `src/renderer/external-libraries/external-library-store.test.ts`

修改：

- 需要复用的外部运行时展示辅助函数

步骤：

1. 使用 `zustand/vanilla` 建立可依赖注入的 Store 工厂，再导出 React Hook。
2. Store 初次连接时先建立事件订阅，再请求列表，避免列表请求期间漏掉进度事件。
3. Snapshot 按 ID 合并；迟到的初始列表不能覆盖更新版本的事件状态。
4. 使用连接 generation 或等价机制处理 React Strict Mode 的连接、清理和重连。
5. 区分：
   - 初始化 loading；
   - 每个 Library 的短请求 pending；
   - Snapshot 的长期运行状态；
   - 迁移请求状态。
6. 暴露 list、refresh、start、cancel、remove、selectDirectory 和 migrate 操作。
7. Store 不持有 Settings 开关、通知 UI 或首次引导状态。

测试：

- 先订阅后 list；
- 初始列表和实时事件合并；
- 迟到列表不覆盖新事件；
- connect / disconnect / reconnect；
- 重复 connect 不产生重复有效订阅；
- start 请求 pending 在 Main 接纳后立即结束；
- Settings 无消费者时状态仍更新；
- 迁移结果和冲突原样返回调用者。

验证：

```text
pnpm test -- src/renderer/external-libraries/external-library-store.test.ts
pnpm typecheck
pnpm lint
```

建议提交：

```text
功能：集中管理渲染端外部组件状态
```

### 任务 6：接入通知 Adapter 和根 Controller

新增：

- `src/renderer/external-libraries/external-library-notification-adapter.ts`
- `src/renderer/external-libraries/external-library-notification-adapter.test.ts`
- `src/renderer/external-libraries/ExternalLibraryRuntimeController.tsx`
- `src/renderer/settings/settings-target.ts`

修改：

- `src/renderer/App.tsx`

步骤：

1. Adapter 接收 previous / next Snapshot，纯函数判断是否产生通知。
2. 仅以下安装迁移产生终态消息：
   - downloading/verifying/installing → available：成功；
   - 活动安装 → failed/invalid：持久错误；
   - 活动安装 → not-installed：取消，不通知。
3. 初始化 discovering → available、普通刷新和 migrating 完成不弹安装成功。
4. failed → downloading 时清理该 Library 的旧失败通知。
5. 失败通知动作通过注入回调请求打开
   `{ section: 'external-libraries', libraryId }`，通知模块不依赖 Settings。
6. Controller 在 App 根部连接 Store，将事件 transition 交给 Adapter。
7. App 根部装配 `NotificationHost`；页面切换不卸载 Controller 或 Host。

测试：

```text
pnpm test -- src/renderer/external-libraries
pnpm test -- src/renderer/notifications
pnpm typecheck
pnpm lint
```

建议提交：

```text
功能：通知外部组件后台安装结果
```

## 阶段五：Settings 解耦

### 任务 7：让 Settings 使用全局 Store

新增：

- `src/renderer/external-libraries/ExternalLibraryMigrationConflictDialog.tsx`
- 对应组件测试

修改：

- `src/renderer/components/SettingsDialog.tsx`
- `src/renderer/components/SettingsDialog.test.tsx`
- `src/renderer/App.tsx`

步骤：

1. 删除 Settings 内部的 list 请求和 `onExternalLibraryChanged` 订阅。
2. 直接消费 External Library Store 的 Snapshot、loading、pending 和操作。
3. 删除覆盖整个安装周期的 `operationBusy`：
   - 安装按钮只在短暂任务接纳期间 pending；
   - 下载期间可关闭 Settings；
   - 下载期间取消可用；
   - 删除和迁移保持禁用。
4. 保留安装确认、移除确认和迁移冲突界面。
5. 把迁移冲突确认提取为可供首次引导复用的组件，不复制文件操作逻辑。
6. Settings 接受可选 `SettingsTarget`：
   - external-libraries 时定位到对应区域；
   - libraryId 存在时突出或滚动到对应卡片；
   - general 保持正常入口。
7. 前台接纳失败和迁移失败继续用居中 ErrorDialog，不转成右上角通知。

测试：

- downloading 状态下关闭按钮可用；
- pending 接纳期间避免重复提交；
- cancel 可用，remove/migrate 禁用；
- 重新打开读取 Store 当前进度；
- target 正确定位 Library；
- 冲突确认调用统一迁移操作。

验证：

```text
pnpm test -- src/renderer/components/SettingsDialog.test.tsx
pnpm test -- src/renderer/external-libraries
pnpm typecheck
pnpm lint
```

建议提交：

```text
重构：让设置页消费全局运行时状态
```

## 阶段六：首次运行引导

### 任务 8：实现基础组件引导

新增：

- `src/renderer/onboarding/FirstRunOnboarding.tsx`
- `src/renderer/onboarding/FirstRunOnboarding.test.tsx`
- 需要时增加纯状态辅助文件及测试

修改：

- `src/renderer/App.tsx`

步骤：

1. App 启动读取 `AppSetupSnapshot`；读取失败时显示可重试的阻塞错误，不静默跳过。
2. `requiresOnboarding` 为真时显示不可通过遮罩或 Escape 关闭的引导。
3. 引导等待 External Library Store 首次初始化后展示 LibreOffice：
   - 用途；
   - 官方来源；
   - 固定版本；
   - 预计体积；
   - 当前安装目录；
   - 当前状态。
4. “更改存储位置”复用 Store 的 select/migrate 和共享冲突确认组件。
5. “安装推荐组件”严格按以下顺序：
   - Main 接纳安装；
   - 保存引导完成；
   - 关闭引导；
   - 后台安装继续。
6. “暂不安装”只保存引导完成并关闭。
7. 已 available、正在安装和 unsupported 分别提供不会卡住用户的明确主按钮。
8. 安装已接纳但保存引导失败时不取消安装，保留引导并允许仅重试保存。
9. 关闭 Settings、切换 Project 或打开 Workbench 均不影响安装。

测试：

- 第一次显示、完成后不显示；
- 安装、暂不安装、已安装、安装中和 unsupported；
- 开始任务失败不标记完成；
- 设置写入失败不错误关闭；
- 接纳成功后安装在引导卸载后仍更新；
- 目录选择取消；
- 迁移冲突复用共享组件。

验证：

```text
pnpm test -- src/renderer/onboarding
pnpm test -- src/renderer/external-libraries
pnpm typecheck
pnpm lint
```

建议提交：

```text
功能：引导首次配置推荐组件
```

## 阶段七：回归、视觉验收与文档

### 任务 9：完整验证和架构文档同步

修改：

- `TECH_STACK.md`
- `docs/superpowers/specs/2026-07-30-background-runtime-install-and-notifications-design.md`
  的实施状态

自动检查：

```text
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

手工验收：

1. 清除 `completedOnboardingVersion`，验证安装与暂不安装两条首次流程。
2. 开始 LibreOffice 安装，下载开始后立即关闭 Settings。
3. 在 Home、Project 和 Workbench 间切换，确认 UI 不被锁定。
4. 重新打开 Settings，确认进度连续且可以取消。
5. 安装成功后确认右上角通知出现、5 秒消失且 Office 预览可用。
6. 断网制造失败，确认错误通知不会自动消失。
7. 点击“查看详情”，确认打开并定位到 LibreOffice 卡片。
8. 重试安装，确认旧失败通知被清理且不会重复下载。
9. 更改外部组件目录，验证无冲突、保留目标和替换目标三条路径。
10. 验证通知不会被窗口底部 Dock/任务栏遮挡，且不抢占编辑器焦点。

建议提交：

```text
文档：同步后台运行时与首次引导架构
```

完成后停在本地等待用户验收。用户明确确认后，再按项目规范执行
`git pull --rebase` 和 push。

## 实施结果

- 阶段一至阶段六均已按独立提交完成；
- `pnpm check` 通过：129 个测试文件、519 项测试；
- `pnpm smoke:native`、`pnpm package` 和
  `pnpm verify:package:native` 通过；
- 已使用隔离 `userData` 启动打包版，确认首次引导可以展示；
- 已确认“暂不安装”会进入 Home，并持久化
  `completedOnboardingVersion: 1`；
- 视觉验收时发现并修复了 Notification Host 的不稳定 Zustand Selector，
  避免 React 19 生产构建触发无限渲染。

尚需用户在真实环境验收长时间后台下载、关闭 Settings 后的连续进度、完成与失败
通知、取消，以及目录迁移冲突流程。验收前不 push。
