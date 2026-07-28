# Settings JSON 持久化与 IPC 设计

## 目标

将现有 `AppPreferences` 和 `AppPaths` 连接为真实的本地设置能力，使首页显示模式和排序方式能够在应用重启后恢复。

本功能采用 Main 进程集中管理的 JSON Settings Repository：

- 应用启动时反序列化一次。
- 用户每次修改设置后立即序列化一次。
- 序列化和反序列化仅为 Repository 内部能力。
- Renderer 不接触文件路径、Node.js 文件系统或 JSON 编解码。

## 选定方案

采用 `JsonSettingsRepository` 封装内存状态、JSON 编解码与文件读写。

没有采用以下方案：

- 不在应用关闭时统一保存，因为崩溃、强制结束和断电不保证触发可靠的关闭流程。
- 不使用 Renderer `localStorage`，避免界面层直接承担桌面应用持久化职责。
- 不单独创建 Codec 服务，当前只有一个简单且版本化的设置结构，额外抽象没有实际收益。

## 数据与路径

复用现有共享结构：

```ts
interface AppPreferences {
  readonly schemaVersion: 1;
  readonly home: {
    readonly viewMode: 'grid' | 'list';
    readonly sortMode: 'newest' | 'oldest' | 'title';
  };
}
```

复用现有路径结构：

```text
<Electron userData>/config/settings.json
```

Main 只能在 `app.whenReady()` 后读取 `app.getPath('userData')`，再调用 `createAppPaths()`。Renderer 永远不会收到绝对路径。

### Main-only 文件选择器记忆

文件选择器最近使用的本地目录属于跨 Project、跨重启的应用级
交互状态，继续保存在同一份 `settings.json`，不进入 SQLite，也不使用
Renderer `localStorage`。

持久化文件允许增加以下可选字段：

```json
{
  "fileDialogs": {
    "lastLocalAssetDirectory": "D:\\Resources\\..."
  }
}
```

该字段只由 Main 进程的 `SettingsRepository` 读写，不属于通过
`settings:get` 返回的 `AppPreferences`，因此 Renderer 不会获得用户的
绝对目录。用户成功选中文件后立即更新目录；目录记忆写入失败只记录
警告，不得让本次文件选择或 Asset 导入失败。

## Settings Repository

### 接口

定义不依赖文件系统实现的 `SettingsRepository`：

```ts
interface SettingsRepository {
  initialize(): Promise<void>;
  get(): AppPreferences;
  updateHomePreferences(home: HomePreferences): Promise<AppPreferences>;
  getLastLocalAssetDirectory(): string | undefined;
  updateLastLocalAssetDirectory(directory: string): Promise<void>;
}
```

`get()` 返回不可变副本，调用方不能修改 Repository 的内部状态。

### JSON 实现

`JsonSettingsRepository` 接收：

- `settingsFile`：由 `AppPaths` 提供的绝对路径。
- 可选 logger：默认使用 Main 的 `console`，测试时可注入。

内部拥有以下私有能力：

- `serialize(preferences)`：输出带缩进并以换行结尾的 JSON。
- `deserialize(content)`：执行 `JSON.parse` 和 `isAppPreferences` 校验。
- `persist(preferences)`：创建配置目录并安全写入设置文件。

这些能力不导出到 Preload、IPC 或 Renderer。

### 初始化

`initialize()` 每个 Repository 实例只能执行一次：

1. 尝试读取 `settings.json`。
2. 文件不存在时使用 `DEFAULT_APP_PREFERENCES`，不创建文件。
3. 内容合法时保存为内存状态。
4. JSON 解析失败或结构校验失败时记录警告并恢复默认设置。
5. 其他读取错误同样记录警告并恢复默认设置，保证窗口仍可启动。

损坏文件不会在启动阶段自动删除或覆盖。用户下一次修改设置时，合法内容会替换它。

### 即时写入与并发

`updateHomePreferences()`：

1. 校验并生成下一份完整 `AppPreferences`。
2. 将写入任务追加到 Repository 内部的单一 Promise 队列。
3. 确保配置目录存在。
4. 在目标文件同目录写入临时文件。
5. 用临时文件替换 `settings.json`。
6. 写入成功后更新内存状态并返回完整设置。

只有写入成功的设置才成为 Repository 当前状态。写入失败时保留上一份有效内存状态，并向 IPC 调用方抛出错误。

连续修改必须按调用顺序执行，后一次设置最终覆盖前一次设置，不允许两个写操作同时写同一个文件。

应用关闭时不执行额外序列化。

## IPC 与 Preload

新增两个白名单通道：

```text
settings:get
settings:update-home
```

共享 API：

```ts
interface LearningCompanionApi {
  getAppPreferences(): Promise<AppPreferences>;
  updateHomePreferences(request: HomePreferences): Promise<AppPreferences>;
}
```

Main 对 `settings:update-home` 的未知输入执行运行时校验。无效请求在进入 Repository 前失败。

IPC 返回完整 `AppPreferences`，确保 Renderer 使用的是 Main 已确认并成功持久化的状态。

注册和移除 Settings handlers 与现有 Project handlers 使用相同模式。

## Main 启动顺序

Main 的 ready 流程调整为：

```text
app.whenReady()
  → createAppPaths(app.getPath('userData'))
  → new JsonSettingsRepository(appPaths.settingsFile)
  → await repository.initialize()
  → register Settings IPC
  → register 其他 IPC
  → createMainWindow()
```

窗口只在 Repository 初始化完成后创建，避免 Renderer 首次请求与文件加载竞争。

应用退出时移除 Settings handlers，但不再次写文件。

## Renderer 接入

首页初始化时并行请求：

- Project 列表
- App Preferences

设置加载成功后，将 `home.viewMode` 和 `home.sortMode` 写入 React state。

用户切换显示或排序选项时：

1. 根据当前设置生成一份完整的下一状态，并分配递增的请求版本号。
2. 立即更新 React state，保证交互反馈即时。
3. 调用 `updateHomePreferences()`。
4. 成功时更新 Renderer 保存的“最近一次已确认设置”。
5. 只有最新请求的结果可以校正当前 React state，较旧请求的返回不能覆盖用户更新的选择。
6. 最新请求失败时恢复最近一次已确认设置，并显示非阻塞错误；已有更新请求排在其后时不执行过期回滚。

搜索关键词继续是一次性 React state，不参与持久化。

在设置加载完成前，首页使用 `DEFAULT_APP_PREFERENCES`，不会阻塞 Project 内容显示。

## 错误处理

- 文件不存在：静默使用默认设置。
- JSON 语法错误：警告并恢复默认设置。
- JSON 结构或版本非法：警告并恢复默认设置。
- 读取权限失败：警告并恢复默认设置。
- 写入或替换失败：保留上一份内存设置，通过 IPC 返回错误，Renderer 回滚对应选择。
- IPC 输入非法：拒绝请求，不调用 Repository。

警告不得包含设置文件内容，避免日志意外记录未来可能加入的敏感设置。

## 测试

### Repository

- 首次启动且文件不存在时返回默认设置，不创建文件。
- 合法 JSON 能够反序列化。
- 损坏 JSON、非法结构和未知版本会记录警告并恢复默认设置。
- 更新后生成合法、格式化的 JSON。
- 保存后创建新 Repository 能够恢复更新值。
- 写入失败时保留旧内存状态。
- 连续更新按顺序落盘，最终内容为最后一次设置。

### IPC 与共享契约

- 合法 Home Preferences 请求通过校验。
- 缺失字段和非法枚举值被拒绝。
- Settings handlers 调用对应 Repository 方法。

### Renderer

- 设置加载成功后恢复显示和排序。
- 修改时调用更新 API。
- 更新失败时回滚并展示错误。
- Project 加载行为和搜索状态不受影响。

### 回归

- `pnpm check` 通过。
- `pnpm package` 通过。
- Electron 实际启动后修改设置，重启应用能够恢复。
- Renderer 仍然无法访问 Node.js 和设置文件绝对路径。

## 验收标准

- 首页显示模式和排序方式在每次修改后立即持久化。
- 正常关闭、强制关闭后重新启动均能恢复最近一次成功写入的设置。
- 损坏设置文件不会阻止应用启动。
- JSON 编解码与路径均未暴露给 Renderer。
- 没有引入 SQLite 或 Project 数据持久化。
