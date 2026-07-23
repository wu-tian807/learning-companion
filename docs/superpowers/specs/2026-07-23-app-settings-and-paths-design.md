# 应用设置与路径结构设计

## 目标

为后续 JSON Settings Repository 建立稳定的数据契约和跨平台路径契约，但本阶段不接入任何持久化行为。

本阶段完成后：

- Main 侧拥有可复用、可测试的 `AppPaths` 路径结构。
- Shared 层拥有 Renderer 与 Main 均可引用的 `AppPreferences` 设置结构。
- 首页现有排序和显示模式继续只保存在 React state 中，应用行为不发生变化。

## 范围

### 包含

- 定义设置结构、默认值和运行时类型校验。
- 定义 `userData`、配置目录和设置文件的绝对路径结构。
- 覆盖默认值、非法设置和路径拼接的单元测试。
- 将首页使用的显示模式与排序模式类型收敛到 Shared 层，避免重复定义。

### 不包含

- 不在 Main 启动流程中实例化路径结构。
- 不创建 `config` 目录或 `settings.json`。
- 不读取、写入或迁移 JSON。
- 不增加 Settings Repository、IPC 或 Preload API。
- 不把设置连接到 React 页面。
- 不接入 SQLite。

## 设置数据结构

设置契约放在 `src/shared/app-preferences.ts`：

```ts
type ProjectViewMode = 'grid' | 'list';
type ProjectSortMode = 'newest' | 'oldest' | 'title';

interface HomePreferences {
  readonly viewMode: ProjectViewMode;
  readonly sortMode: ProjectSortMode;
}

interface AppPreferences {
  readonly schemaVersion: 1;
  readonly home: HomePreferences;
}
```

该模块同时导出：

- `APP_PREFERENCES_SCHEMA_VERSION`
- `DEFAULT_APP_PREFERENCES`
- `isAppPreferences(value: unknown): value is AppPreferences`

默认设置为舒展卡片视图和最近创建排序。搜索关键词属于一次性页面状态，不进入设置文件。

`schemaVersion` 用于未来 JSON 格式迁移。运行时校验只接受已知版本和有效枚举值，避免损坏或人工修改的 JSON 直接进入应用状态。

`src/renderer/project-view.ts` 不再自己定义两种模式类型，而是从 Shared 层引用并重新导出，以保持现有 Renderer 调用点兼容。

## 路径数据结构

路径契约放在 `src/main/paths/app-paths.ts`：

```ts
interface AppPaths {
  readonly userDataDirectory: string;
  readonly configDirectory: string;
  readonly settingsFile: string;
}
```

纯函数 `createAppPaths(userDataDirectory)` 接收 Electron 将来提供的 `app.getPath('userData')`，生成不可变路径结构：

```text
userDataDirectory = <Electron userData>
configDirectory   = <Electron userData>/config
settingsFile      = <Electron userData>/config/settings.json
```

函数使用 Node.js `path.join`，因此遵循 Windows、macOS 和 Linux 的原生路径分隔符。它只计算路径，不访问文件系统。输入必须是绝对路径，避免开发目录或当前工作目录意外成为数据目录。

未来接入时，Main 只能在 Electron ready 之后调用：

```ts
const appPaths = createAppPaths(app.getPath('userData'));
```

本阶段不会加入这行连接代码。

## 边界与依赖方向

```text
Shared AppPreferences
    ↑              ↑
Renderer        Main（未来）

Electron app.getPath('userData')（未来）
    ↓
createAppPaths
    ↓
AppPaths.settingsFile
    ↓
JsonSettingsRepository（未来）
```

`AppPaths` 不依赖 Electron，便于单元测试。未来的 JSON Settings Repository 只接收 `settingsFile`，不自行推断系统目录，也不依赖 Renderer。

Project 的 `pinned` 继续属于 Project 业务数据，未来由 Project Repository/SQLite 持久化，不进入 `AppPreferences`。

## 错误处理

- `createAppPaths` 收到空路径或相对路径时立即抛出错误。
- `isAppPreferences` 对 `null`、非对象、未知版本或非法模式返回 `false`。
- 本阶段没有文件系统操作，因此没有目录权限、JSON 解析或写入失败分支。

## 测试

- 默认设置严格符合 `AppPreferences`。
- 合法设置通过运行时校验。
- 未知版本、缺失字段及非法枚举值被拒绝。
- 路径工厂生成 `config/settings.json`。
- 路径工厂拒绝空路径和相对路径。
- 现有首页排序、显示与 Project 测试继续通过。

## 验收标准

- `pnpm check` 通过。
- `pnpm package` 通过。
- 没有生成任何用户数据文件或目录。
- Renderer 的当前显示、排序及重启行为保持不变。
