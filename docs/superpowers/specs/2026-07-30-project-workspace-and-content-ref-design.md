# Project Workspace 与文件型 ContentRef 设计

> 状态：已实施（Workspace Missing 的 Home 状态与外部链接 UI 入口待后续补充）
>
> 决策日期：2026-07-30
>
> 范围：Project Workspace、Asset 文件引用、Workspace 切换、文件导入以及
> `managed-json` 退役。本设计不实现 Attachment 业务类型、网络 ContentRef 或
> Agent 编辑会话。

## 1. 背景

Learning Companion 已经建立以下基础：

- Project 和 Asset 使用纯数据对象；
- `ProjectDatabase` 维护全量 Project 内存 Map，并同步 SQLite；
- `AssetDatabase` 维护当前 Project 的 Asset 内存 Map，并同步 SQLite；
- `AssetService` 维护带运行时可用状态的 Asset Snapshot；
- `ContentRef → ContentResolver → ContentHandle` 隔离持久化引用与运行时访问；
- 当前生产环境只注册 `local-file` Resolver；
- `managed-json` 只存在于类型、测试和未注册的 Resolver 中，没有真实业务数据表。

此前为应用内生成内容预留了 `managed-json`，计划让思维导图等 Asset 通过
数据库 Repository 取得 JSON 正文。现在决定取消这条路线：

- 所有 Asset 正文都以真实文件为主；
- 应用生成的 Markdown、JSON、HTML 和思维导图也先落盘；
- Project 拥有明确的 Workspace；
- Workspace 内的文件使用相对引用，外部链接使用绝对引用；
- ContentRef 永远只定位内容，不保存内容；
- SQLite 保留 Project、Asset、Anchor、关系和运行时状态等结构化数据。

## 2. 设计目标

本次设计必须满足：

1. 创建 Project 时允许选择 Workspace。
2. 未选择时使用 Documents 下的默认 Project 根目录。
3. Add Asset 文件选择器默认打开当前 Project Workspace。
4. Workspace 内文件使用可迁移的相对路径。
5. Workspace 外文件只有在用户明确选择链接时才使用绝对路径。
6. 默认导入会把外部文件复制进 Workspace。
7. 应用生成的 Asset 也使用 `local-file`。
8. 退役 `managed-json`，但保留 Content Resolver 扩展架构。
9. 切换 Workspace 不移动文件，允许相对 Asset 因而变成 Missing。
10. Project 和 Asset 删除默认不删除真实文件。
11. Windows 与 macOS 使用同一领域契约。

## 3. 非目标

本阶段不实现：

- `remote-url`、网页快照或云端文件；
- Attachment 具体类型与持久化表；
- Agent 编辑草稿、Diff 审查和应用流程；
- Workspace 自动移动；
- Workspace 实时文件监听；
- 自动清理 Workspace 中未被数据库引用的文件；
- 把 SQLite、设置、缓存和认证数据迁入 Documents；
- 全局 Portable Mode。

## 4. 目录模型

### 4.1 应用私有目录

Electron `userData` 继续保存应用级状态：

```text
<Electron userData>/
├── config/
│   └── settings.json
├── data/
│   └── learning-companion.sqlite3
├── cache/
└── recovery/
```

其中：

- `settings.json` 保存全局偏好和默认 Workspace 根目录；
- SQLite 保存 Project、Asset、Workbench State 及后续关系数据；
- `cache` 保存可重建缓存；
- `recovery` 保存编辑恢复和未来 Agent Editing Session 临时数据。

### 4.2 默认 Project 根目录

全局设置增加：

```ts
interface AppSettings {
  readonly defaultProjectWorkspace: string;
}
```

默认值：

```text
<Documents>/Learning Companion/Projects
```

该值是创建 Project 时使用的父目录，不是某个 Project 的实际 Workspace。

### 4.3 Project Workspace

应用默认创建：

```text
<defaultProjectWorkspace>/
└── <project-directory>/
    ├── assets/
    │   ├── imported/
    │   └── generated/
    ├── attachments/
    └── .learning-companion/
        └── workspace.json
```

含义：

- `assets/imported` 保存复制进入 Project 的资料；
- `assets/generated` 保存应用或 Agent 生成的 Asset；
- `attachments` 预留给笔记、AI 解释等正文文件；
- `.learning-companion/workspace.json` 只记录 Workspace 标识和格式版本。

`workspace.json` 不是 Project、Asset 或 Attachment 的业务事实来源，不复制
SQLite 的完整内容。它用于识别 Workspace 是否已经绑定其他 Project，以及未来
重新定位或打开已有 Workspace。

用户可以选择已有目录作为 Workspace。应用只创建缺失的内部目录，不移动、
重命名或覆盖已有文件。

## 5. Project 数据模型

Project 增加：

```ts
interface Project {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly workspacePath: string;
  readonly createdTime: number;
  readonly pinned: boolean;
}
```

约束：

- `workspacePath` 在 SQLite 和 Project Map 中保存为规范化绝对路径；
- 普通 `update` 不允许修改 `workspacePath`；
- Workspace 修改必须走独立的 `changeProjectWorkspace`；
- Project 重命名不自动重命名 Workspace；
- Workspace 缺失时 Project 仍保留在首页；
- Workspace 不可用时禁止新增 Asset，并提供重新定位能力。

实际状态归属：

```text
ProjectDatabase
└── Project Map
    └── Project.workspacePath

ProjectService
└── 创建、打开、关闭、删除和 Workspace 切换编排

ProjectWorkspaceManager
└── 无状态目录、路径、文件选择和系统文件操作
```

## 6. ContentRef 数据模型

### 6.1 LocalFileContentRef

使用显式路径基准：

```ts
type LocalFileContentRef =
  | {
      readonly kind: 'local-file';
      readonly base: 'project-workspace';
      readonly path: string;
    }
  | {
      readonly kind: 'local-file';
      readonly base: 'absolute';
      readonly path: string;
    };
```

Workspace 内示例：

```json
{
  "kind": "local-file",
  "base": "project-workspace",
  "path": "assets/imported/线性代数.pdf"
}
```

外部链接示例：

```json
{
  "kind": "local-file",
  "base": "absolute",
  "path": "D:\\Books\\线性代数.pdf"
}
```

### 6.2 ContentRef 原则

- ContentRef 只描述持久化定位方式；
- ContentRef 不保存正文、JSON、二进制、缓存或可用状态；
- `project-workspace` 路径必须为相对路径；
- 相对路径统一使用 `/` 持久化；
- 相对路径禁止盘符、UNC 前缀、空字节和越出 Workspace 的 `..`；
- `absolute` 路径必须满足当前平台绝对路径规则；
- 运行时绝对路径、availability、checkedTime 和文件句柄属于解析结果；
- 应用生成内容和用户导入内容使用同一 `local-file` Resolver。

### 6.3 扩展边界

本次移除：

```text
ManagedJsonContentRef
ManagedJsonContentResolver
ManagedJsonContentRepository
managed-json
```

保留：

```text
ContentResolverRegistry
ContentResolver
ContentHandle
ResolvedAssetContent
```

未来网络来源可以新增真正的引用类型：

```ts
interface RemoteUrlContentRef {
  readonly kind: 'remote-url';
  readonly url: string;
}
```

远程响应正文和下载缓存仍不进入 ContentRef。

## 7. ProjectWorkspaceManager

### 7.1 生命周期

`ProjectWorkspaceManager` 是在 `app.whenReady()` 后创建的应用级单例，直到应用
退出。它不保存当前 Project、当前 Workspace 或活动 Asset。

建议接口：

```ts
interface ProjectWorkspaceManagerApi {
  prepareWorkspace(input: {
    projectId: string;
    workspacePath: string;
  }): Promise<void>;

  selectWorkspace(
    defaultPath: string,
  ): Promise<string | undefined>;

  selectAssetFiles(
    workspacePath: string,
  ): Promise<readonly string[]>;

  classifyLocalFile(
    workspacePath: string,
    absolutePath: string,
  ): Promise<LocalFileContentRef>;

  resolveLocalFile(
    workspacePath: string,
    ref: LocalFileContentRef,
  ): Promise<string>;

  copyImportedFile(
    workspacePath: string,
    sourcePath: string,
  ): Promise<LocalFileContentRef>;

  openWorkspace(workspacePath: string): Promise<void>;

  revealFile(absolutePath: string): Promise<void>;
}
```

Manager 的方法接收显式路径，不依赖 `ProjectDatabase`，从而保持无状态并避免
隐含的“当前 Workspace”。

### 7.2 吸收现有职责

移入 `ProjectWorkspaceManager`：

- `ipc/assets.ts` 中的文件选择器逻辑；
- Add Asset 的 `defaultPath`；
- Project Workspace 目录选择器；
- Workspace 目录初始化和 marker 校验；
- 相对/绝对路径分类；
- 路径归一化、跨平台转换和越界校验；
- 导入复制与重名处理；
- Project Workspace 的 `shell.openPath`；
- 已解析文件的 `shell.showItemInFolder`。

退役：

- 跨重启持久化的 `lastLocalAssetDirectory` 设置；
- `AssetShellService` 及其独立注册。

文件选择器仍保留 Main 进程内的临时目录记忆：以 `workspacePath`
为作用域，第一次从 Project Workspace 打开，成功选择文件后记住该文件目录，
应用退出后自然清空。该状态由独立的内存 Store 持有，不进入 SQLite、
`settings.json` 或 Renderer。

仍然独立：

- `ProjectService`：业务和生命周期编排；
- `ProjectDatabase`：Project Map 与 SQLite；
- `AssetService`：Asset 业务和 Runtime Map；
- `AssetDatabase`：当前 Project Asset Map 与 SQLite；
- `LocalFileContentResolver`：availability 和 ContentHandle；
- `LocalFileContentInspector`：`stat`、读取权限和文件类型检查；
- 媒体类型检测。

## 8. Content Resolver 上下文

相对引用必须由当前 Project Workspace 解析：

```ts
interface ContentResolveContext {
  readonly projectId: string;
  readonly projectWorkspace: string;
}

interface ContentResolver {
  readonly kind: AssetContentKind;

  resolve(
    ref: AssetContentRef,
    context: ContentResolveContext,
  ): Promise<ResolvedAssetContent>;
}
```

运行时结果可以携带仅 Main 可见的实际位置：

```ts
interface ResolvedLocalFileLocation {
  readonly kind: 'local-file';
  readonly absolutePath: string;
}

interface ResolvedAssetContent {
  readonly contentRef: AssetContentRef;
  readonly contentStatus: AssetContentStatus;
  readonly location?: ResolvedLocalFileLocation;
  readonly handle?: ContentHandle;
}
```

媒体检测、Workbench、Content Resource Protocol、Relink 和系统文件操作只能
使用解析后的 `location` 或 `ContentHandle`，不能假设 `contentRef.path` 是绝对
路径。

## 9. Project 创建

创建输入增加可选 Workspace：

```ts
interface CreateProjectInput {
  readonly name: string;
  readonly workspacePath?: string;
}
```

流程：

1. 未指定路径时，在 `defaultProjectWorkspace` 下生成稳定且不冲突的目录名；
2. 用户指定路径时校验目录和读写权限；
3. 检查现有 `workspace.json` 是否属于其他 Project；
4. 创建缺失的内部目录；
5. 写入 Workspace marker；
6. 写入 SQLite 并更新 Project Map；
7. 任一步失败时只回滚本次创建的内容，不删除用户已有目录。

`ProjectService.createProject()` 因文件系统操作改为异步。跨 SQLite 与文件系统
无法形成单一事务，因此必须记录本次创建的目录和文件，并执行补偿式回滚。

## 10. Add Asset 与拖放

文件选择器必须携带发起操作时的 `projectId`。每个 Workspace 第一次使用：

```ts
dialog.showOpenDialog({
  defaultPath: project.workspacePath,
  properties: ['openFile', 'multiSelections'],
});
```

成功选中文件后，Main 进程内存 Store 记录第一个文件所在目录；同一 Workspace
后续打开从该目录继续，不同 Workspace 的记录互不影响。

### 10.1 Workspace 内文件

不复制，保存 `base: 'project-workspace'` 的相对引用。

### 10.2 Workspace 外文件

默认操作是复制到 `assets/imported`：

1. 使用临时文件完成原子复制；
2. 文件名冲突时追加 ` (2)`、` (3)`；
3. 生成 Workspace 相对 ContentRef；
4. 检测媒体类型；
5. 写入 AssetDatabase；
6. 数据库写入失败时只删除本次复制的文件。

用户明确选择“链接原文件”时不复制，保存 `base: 'absolute'`。

批量选择和拖放遵循同一规则。切换 Project 后，旧请求必须因 `projectId` 或
生命周期版本不匹配而失败，不能把文件导入后来激活的 Project。

## 11. Workspace 切换

Home 的 Project 编辑界面允许修改 Workspace：

```ts
changeProjectWorkspace(
  projectId: string,
  workspacePath: string,
): Promise<ProjectSnapshot>;
```

UI 必须提示：

> 更换工作区不会移动任何文件。Workspace 相对路径会改为相对于新目录解析，
> 找不到的资料将被标记为失效；外部绝对路径不受影响。

活动 Project 的切换流程：

1. 进入 `ProjectService` 生命周期串行队列；
2. 校验新 Workspace；
3. 关闭活动 Workbench；
4. 卸载当前 Asset Runtime Map；
5. 更新 `Project.workspacePath`；
6. 写入或校验 Workspace marker；
7. 重新加载当前 Project 的 Asset；
8. 所有相对引用在新 Workspace 下重新解析；
9. Missing 是正常结果，不触发回滚。

如果 SQLite 更新或重新加载发生内部错误，则恢复旧 `workspacePath` 并尝试重新
加载旧 Workspace。Project 未打开时只更新路径，下次打开时统一解析。

Workspace 切换不重新计算 Asset `mediaType`，因为 Asset 没有更换 ContentRef；
用户可以通过单 Asset Relink 修复失效文件。

## 12. UI 行为

### 12.1 创建 Project

创建弹窗包含：

- Project 名称；
- Workspace 路径；
- “选择”按钮；
- 默认路径预览。

名称变化时，只有尚未手动选择 Workspace 才更新默认目录预览。一旦用户手动
选择路径，继续编辑名称不再改变目录。

### 12.2 编辑 Project

Home 的编辑界面包含：

- 名称；
- 当前 Workspace；
- “更换”按钮；
- “在文件夹中打开”操作。

仅名称变化时走普通更新；Workspace 变化时显示风险确认并走专用切换接口。

### 12.3 Project 与 Asset 系统操作

- Project“在文件夹中打开”打开 `Project.workspacePath`；
- Add Asset 默认定位到 `Project.workspacePath`；
- Asset“在文件夹中显示”定位解析后的实际文件；
- Workspace 不可用时禁用 Add Asset，并提供重新定位。

## 13. 删除策略

第一阶段以安全为先：

- 删除 Asset 只删除数据库记录，不删除真实文件；
- 删除 Project 只删除数据库记录，不删除 Workspace；
- UI 文案使用“从 Learning Companion 中移除”；
- 未来“同时移到废纸篓”必须是独立、显式且二次确认的操作。

该策略避免用户选择已有资料目录作为 Workspace 后，删除 Project 意外清空
目录。文件所有权和孤儿文件清理后续单独设计。

## 14. Attachment 边界

Attachment 不在本阶段实现，但后续必须遵守：

- `typeId`、Anchor、版本、关系和时间等结构化元数据可以进入 SQLite；
- 用户笔记、AI 解释等正文保存为 Workspace 文件；
- Attachment 通过内容引用定位正文；
- 小型类型参数可以作为数据库元数据；
- 不允许任意大 `payload` 演变成另一套 `managed-json` 内容仓库。

## 15. 数据迁移

实施时新增数据库迁移：

1. `projects` 增加 `workspace_path`；
2. 现有 Project 在默认根目录下创建 Workspace；
3. 旧 `{ kind: 'local-file', path: absolute }` 转换为
   `{ kind: 'local-file', base: 'absolute', path }`；
4. 开发阶段已有 `managed-json` Asset 可以删除，并依靠外键清理对应
   Workbench State；
5. `assets.content_ref` 继续保存 JSON 引用，但数据库不保存正文；
6. Settings 初始化必须能取得 Electron Documents 路径并生成默认值。

迁移不得复制现有绝对路径 Asset；它们继续作为外部链接存在，用户可以随后
选择导入 Workspace。

## 16. 错误模型

需要覆盖：

- Workspace 不存在；
- Workspace 不是目录；
- Workspace 无读写权限；
- Workspace 已绑定其他 Project；
- 相对路径越界；
- 外部文件复制失败；
- 文件名冲突处理失败；
- Workspace 切换期间 Project 上下文变化；
- ContentRef 数据损坏；
- SQLite 与文件系统补偿式回滚失败。

用户错误进入统一 `AppError` 与模态错误反馈；内部一致性错误记录完整日志，并
显示通用恢复建议。

## 17. 测试

### 17.1 纯路径测试

- POSIX 与 Windows 相对路径编码；
- Windows 盘符大小写；
- 不同盘符；
- UNC 路径；
- `..` 越界；
- 分隔符转换；
- Unicode 文件名；
- 符号链接指向 Workspace 外。

路径测试应通过注入 `path.posix` / `path.win32` 或平台策略运行，不能只依赖
开发机操作系统。

### 17.2 Manager 测试

- 默认目录准备；
- 已有目录不被覆盖；
- marker 冲突；
- 文件选择器 defaultPath；
- 文件选择器按 Workspace 记忆最近一次成功选择目录；
- 批量复制；
- 重名处理；
- 打开 Workspace；
- 显示具体文件；
- 失败补偿不删除用户文件。

### 17.3 Service 与数据库测试

- Project 创建写入 Workspace；
- Workspace 切换关闭 Workbench 并卸载 Asset；
- 相对 Asset 在新 Workspace 下重新解析；
- Missing 不导致 Workspace 切换回滚；
- 内部错误触发旧路径回滚；
- 外部绝对 Asset 不受 Workspace 切换影响；
- 旧 ContentRef 数据迁移；
- `managed-json` 退役。

### 17.4 IPC 与 Renderer 测试

- 创建和编辑 Project 的 Workspace 字段；
- 路径选择取消；
- 更换 Workspace 的风险确认；
- Add Asset 携带 `projectId`；
- 文件选择器首次以 Workspace 为默认路径，随后使用该 Workspace 的内存记忆；
- Workspace Missing 的 UI 状态；
- Project 与 Asset 两种文件管理器操作不混淆。

## 18. 命名约定

本设计使用：

- `Project` / `Asset`：纯数据；
- `ProjectDatabase` / `AssetDatabase`：SQLite 与内存 Map；
- `ProjectService` / `AssetService`：领域编排和运行时状态；
- `ProjectWorkspaceManager`：不保存领域状态的路径与文件系统操作；
- `InMemoryFileDialogDirectoryStore`：按 Workspace 保存进程内文件选择目录；
- `ContentResolver`：把持久化引用解析为运行时内容；
- `ContentHandle`：面向 Workbench 的能力句柄；
- `Repository`：按稳定键保存和读取特定记录。

“Manager 不持有领域状态、Service 持有领域运行时状态”是本次
Project/Asset 数据层的局部命名约定。文件选择器目录属于短期 UI 状态，
因此放入独立 Store，而不把 Workspace Manager 改成 Service。
现有 `WorkbenchSessionManager` 按“管理活动 Session 生命周期”的既有语义保留，
不在本次无关改造中重命名。

## 19. 验收条件

- 新建 Project 拥有绝对 `workspacePath`；
- 默认 Workspace 位于 Documents；
- Add Asset 默认打开当前 Workspace；
- Workspace 内引用持久化为相对路径；
- 外部链接持久化为绝对路径；
- 应用生成 Asset 使用 `local-file`；
- 生产代码和共享契约中不存在 `managed-json`；
- Registry 和 Resolver 扩展边界保留；
- 切换 Workspace 后相对 Asset 正确 Available 或 Missing；
- Project 与 Asset 的文件管理器行为符合各自语义；
- 删除数据库对象不会自动删除真实文件；
- macOS 与 Windows 路径测试通过；
- `pnpm check` 通过。
