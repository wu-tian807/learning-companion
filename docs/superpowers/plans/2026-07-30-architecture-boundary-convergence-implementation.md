# 架构边界收敛重构实施计划

> 状态：已实施，待人工验收
>
> 对应设计：
> `docs/superpowers/specs/2026-07-30-architecture-boundary-convergence-design.md`
>
> 实施日期：2026-07-30
>
> 原则：保持 SQLite Schema、IPC 契约、DOM/CSS、用户交互和启动语义不变；
> 每个边界改动独立测试、独立提交，不自动 Push。

## 0. 实施前基线

### 检查

运行：

```bash
git status --short
pnpm check
```

预期：

- 只有用户已有的未跟踪文件；
- TypeScript、ESLint 和全部 Vitest 测试通过。

如果基线失败，先判断是否为当前代码问题。本计划不以重构掩盖已有失败。

## 1. 消除两处循环依赖

### 1.1 文本编码模块

涉及文件：

- 新增 `src/main/content/text-encoding.ts`
- 新增 `src/main/content/text-encoding.test.ts`
- 修改 `src/main/content/text-content.ts`
- 修改 `src/main/assets/asset-media-type.ts`
- 删除 `src/main/assets/asset-text-encoding.ts`
- 删除 `src/main/assets/asset-text-encoding.test.ts`

步骤：

1. 把 `TextEncoding`、Detector、64 KiB 采样和文件探测移动到
   `main/content/text-encoding.ts`。
2. `text-content.ts` 从同层模块读取编码类型和探测器。
3. `asset-media-type.ts` 单向依赖 Content 编码探测能力。
4. 移动现有测试，保留 UTF-8、GBK、NUL、控制字符和文件采样覆盖。

### 1.2 Workbench Action 模型

涉及文件：

- 修改 `src/renderer/workbench/actions/workbench-action.ts`
- 修改 `src/renderer/workbench/actions/workbench-contribution.ts`
- 新增 `src/renderer/workbench/actions/workbench-action-bundle.ts`
- 修改所有 `WorkbenchActionBundle` 消费者

步骤：

1. `workbench-action.ts` 只保留 Action 和启用判断。
2. `WorkbenchActionClosePolicy` 移到 Contribution 模型。
3. `workbench-action-bundle.ts` 组合 Action 与 Contribution。
4. 更新 Runtime、Action Registry、Preset 和 Workbench Action 文件的类型导入。

### 测试

```bash
pnpm exec vitest run \
  src/main/content/text-encoding.test.ts \
  src/main/content/text-content.test.ts \
  src/main/assets/asset-media-type.test.ts \
  src/renderer/workbench/actions/editor-action-preset.test.ts \
  src/renderer/workbench/runtime/workbench-action-registry.test.ts \
  src/renderer/workbench/runtime/workbench-invocation.test.ts
pnpm typecheck
```

随后运行静态依赖扫描，确认已知两个环消失。

### 提交

```text
重构：消除文本编码与工作台操作循环依赖
```

## 2. 由 AssetService 独占运行时状态

涉及文件：

- 修改 `src/main/assets/asset-database.ts`
- 修改 `src/main/assets/asset-database.test.ts`
- 修改 `src/main/assets/asset-service.ts`
- 修改 `src/main/assets/asset-service.test.ts`
- 修改 `src/main/index.ts`，仅适配构造参数
- 必要时修改依赖 `AssetDatabaseApi` 的测试替身

### 2.1 AssetDatabase

目标 API：

```ts
interface AssetDatabaseApi {
  listByProject(projectId: string): readonly Asset[];
  countByProjectIds(projectIds: readonly string[]): ReadonlyMap<string, number>;
  add(projectId: string, input: CreateAssetInput): Asset;
  update(
    projectId: string,
    assetId: string,
    changes: UpdateAssetInput,
  ): Asset;
  updateContentRef(
    projectId: string,
    assetId: string,
    contentRef: AssetContentRef,
  ): Asset;
  delete(projectId: string, assetId: string): void;
}
```

实现要求：

- 删除 `activeProjectId` 和 `assetMap`；
- 删除 `loadFromProject`、`unloadProject`、`list`、`get`；
- 删除 `ProjectLookup` 构造依赖；
- 每次写入使用 `assetId + projectId` 约束；
- 写冲突仍使用现有 `AppError`；
- ContentRef 数据完整性仍在读取时校验；
- SQLite Schema 不变。

### 2.2 AssetService

实现要求：

- 新增并独占 `activeProjectId`；
- `runtimeMap` 成为唯一当前 Project Asset Map；
- `loadFromProject` 开始时使旧 Project 失活；
- 先在临时数组和 Map 中完成数据库读取、ContentRef 解析及状态检查；
- 只有版本仍有效时才一次性提交目标 Project；
- 失败后保持未激活、空 Map；
- 并发被替代继续抛出现有 superseded/context changed 错误；
- 所有数据库写操作显式传入活动 `projectId`；
- `countByProjectIds` 继续为无状态查询；
- IPC 和 `ProjectService` 公共契约不变。

### 测试

先更新测试以表达新边界，并覆盖：

1. Database 查询不改变任何内存状态；
2. Database CRUD 必须携带 Project；
3. Service 成功加载后拥有唯一 Map；
4. Service 加载解析失败后处于未激活状态；
5. Service 加载被卸载或新加载替代时不提交迟到结果；
6. add/update/relink/delete 使用活动 Project ID；
7. Artifact 清理顺序不变。

运行：

```bash
pnpm exec vitest run \
  src/main/assets/asset-database.test.ts \
  src/main/assets/asset-service.test.ts \
  src/main/projects/project-service.test.ts \
  src/main/ipc/assets.test.ts \
  src/main/ipc/projects.test.ts
pnpm typecheck
```

### 提交

```text
重构：由资产服务独占运行时状态
```

## 3. 收敛 Attachment 文件化契约

涉及文件：

- 修改 `src/shared/workbench/attachment.ts`
- 修改 `src/main/attachments/attachment.ts`
- 修改 `src/main/attachments/attachment.test.ts`
- 修改受影响的 Attachment Registry / 空服务测试

目标：

```ts
interface AssetAttachment {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetAttachmentTarget;
  readonly metadata: JsonValue;
  readonly content?: {
    readonly ref: ProjectWorkspaceLocalFileContentRef;
    readonly mediaType: string;
  };
  readonly createdTime: number;
  readonly updatedTime: number;
}
```

实现要求：

- `payload` 改名为 `metadata`；
- 可选正文只能引用 Project Workspace 相对文件；
- 校验并克隆 `content.ref`，禁止绝对引用；
- 校验非空 `mediaType`；
- 保持纯数据和冻结语义；
- 不新增表、不新增 IPC、不实现 Attachment CRUD；
- 16 KiB 上限留给未来真正的 Attachment Service，不在纯数据创建函数中假设序列化策略。

### 测试

```bash
pnpm exec vitest run \
  src/main/attachments/attachment.test.ts \
  src/main/attachments/attachment-registry.test.ts \
  src/main/attachments/empty-services.test.ts
pnpm typecheck
```

### 提交

```text
重构：收敛附件文件化数据契约
```

## 4. 统一 Workbench 双端注册

涉及文件：

- 新增 `src/workbenches/catalog/builtin-workbenches.ts`
- 新增 `src/workbenches/catalog/register-main-workbenches.ts`
- 新增 `src/workbenches/catalog/register-renderer-workbenches.ts`
- 新增 `src/workbenches/catalog/builtin-workbenches.test.ts`
- 修改 `src/main/index.ts`
- 修改 `src/renderer/workbench/host/AssetWorkbenchHost.tsx`

### Catalog

`builtin-workbenches.ts` 导出内置 Manifest 和稳定 ID 列表，不导入 Main Provider
或 React Renderer。

### Main 注册

`register-main-workbenches.ts`：

- 接收 `WorkbenchRegistry` 和明确的依赖对象；
- 创建并注册 Plain Text、Markdown、PDF、Office、HTML、EPUB、Image、Audio、
  Video Provider；
- 不创建 Repository、Service 或 Registry；
- 不注册 Unsupported fallback。

### Renderer 注册

`register-renderer-workbenches.ts`：

- 接收 `RendererWorkbenchRegistry`；
- 为同一批 ID 注册动态 `import()` Loader；
- 保持 Vditor 和其他重型依赖懒加载；
- `AssetWorkbenchHost` 只创建 Registry 并调用统一注册函数。

### 测试

测试必须验证：

- Catalog ID 唯一；
- Main 与 Renderer 注册声明覆盖全部 Catalog；
- Manifest ID 与注册 ID 一致；
- 未支持 ID 仍进入 Unsupported；
- Renderer Loader 仍为懒加载。

运行：

```bash
pnpm exec vitest run \
  src/workbenches/catalog/builtin-workbenches.test.ts \
  src/main/workbench/workbench-registry.test.ts \
  src/renderer/workbench/renderer-workbench-registry.test.ts
pnpm typecheck
```

### 提交

```text
重构：统一内置工作台双端注册
```

## 5. 拆分 Main 启动和应用装配

涉及文件：

- 新增 `src/main/bootstrap/application-runtime.ts`
- 新增 `src/main/bootstrap/create-application-runtime.ts`
- 新增 `src/main/bootstrap/create-external-library-runtime.ts`
- 新增 `src/main/bootstrap/register-application-ipc.ts`
- 新增相应测试
- 修改 `src/main/index.ts`

### 5.1 External Library 装配

`create-external-library-runtime.ts` 负责：

- Definition Registry；
- Installer Registry；
- Downloader、Path Manager、Installation Store；
- `ExternalLibraryService` 创建和初始化。

只返回已初始化 Service，不处理 UI 或 Electron 生命周期。

### 5.2 ApplicationRuntime

Runtime 显式持有：

- DatabaseContext；
- ProjectService、AssetService；
- WorkbenchSessionManager；
- ContentResourceService；
- ExternalLibraryService；
- SandboxFrameInteractionBridge；
- IPC 和 Content Protocol 释放函数。

公开：

```ts
closeActiveWorkbench(): Promise<void>;
shutdown(): Promise<void>;
dispose(): void;
```

关闭 Workbench 的任务合并语义从 `index.ts` 原样迁移。

### 5.3 IPC 装配

`register-application-ipc.ts` 调用现有各领域注册函数并返回幂等 `dispose()`。
不修改 Channel、校验、错误协议或 Handler 实现。

### 5.4 index.ts

只保留：

- Scheme privilege 的 ready 前注册；
- Squirrel 早退；
- `app.whenReady()`；
- Runtime 创建和失败清理；
- BrowserWindow 创建、activate；
- window-all-closed、before-quit、will-quit。

### 测试

新增测试覆盖：

- IPC 组合注册和幂等释放；
- Runtime 重复关闭 Workbench 时合并任务；
- shutdown 同时等待 Workbench 和外部运行时；
- dispose 释放协议、资源、Bridge 和 Database；
- 初始化失败可以安全释放已创建资源。

运行：

```bash
pnpm exec vitest run \
  src/main/bootstrap \
  src/main/ipc \
  src/main/workbench/workbench-session-manager.test.ts
pnpm typecheck
```

### 提交

```text
重构：拆分主进程启动与应用装配
```

## 6. 拆分 Project 页面

涉及文件：

- 保留 `src/renderer/ProjectPage.tsx` 作为兼容入口
- 新增 `src/renderer/project/ProjectPage.tsx`
- 新增 `src/renderer/project/use-project-session.ts`
- 新增 `src/renderer/project/use-project-assets.ts`
- 新增 `src/renderer/project/ProjectAssetPanel.tsx`
- 新增 `src/renderer/project/AssetActionsMenu.tsx`
- 新增 `src/renderer/project/AssetRenameDialog.tsx`
- 新增 `src/renderer/project/AssetDeleteDialog.tsx`
- 视实际边界移动仅属于 Project 页的辅助类型和纯函数

实现顺序：

1. 先提取纯展示菜单和对话框，保持 JSX、Class 和 aria 属性原样；
2. 提取 Project 打开、关闭、重试和 Workbench 生命周期等待；
3. 提取 Asset 列表、选择、导入、拖拽、刷新、重命名、删除、Relink；
4. 新 `ProjectPage` 只组合三栏布局、Hook 和 Workbench Host；
5. 原入口只重导出，`App.tsx` 无需改变公共导入。

约束：

- 不新增全局 Store；
- 不改变发起导入时携带 Project ID 的语义；
- 不改变错误 Dialog；
- 不改变当前 Asset 的选择回退规则；
- 不改变 Workbench lifecycle task 的等待顺序；
- 不改变任何可见文案和样式。

### 测试

对纯状态转换和抽出的组件补充测试；继续运行：

```bash
pnpm exec vitest run \
  src/renderer/project-view.test.ts \
  src/renderer/workbench/workbench-lifecycle.test.ts \
  src/renderer/components/AssetImportSplitButton.test.tsx \
  src/renderer/project
pnpm typecheck
```

### 提交

```text
重构：拆分项目页面职责
```

## 7. 拆分 Home 页面

涉及文件：

- 保留 `src/renderer/Home.tsx` 作为兼容入口
- 新增 `src/renderer/home/Home.tsx`
- 新增 `src/renderer/home/use-projects.ts`
- 新增 `src/renderer/home/use-home-preferences.ts`
- 必要时移动仅属于 Home 的辅助类型和纯函数

职责：

- `use-projects`：加载、创建、修改、置顶、删除、打开 Workspace；
- `use-home-preferences`：排序、显示模式、筛选和 settings 持久化；
- `Home`：Toolbar、Grid/List、空状态、Dialog 编排。

保持 Project Card/List、菜单、排序弹层和创建/编辑 Dialog 的 DOM 与 Props 不变。

### 测试

```bash
pnpm exec vitest run \
  src/renderer/project-view.test.ts \
  src/renderer/components/ProjectDialog.test.tsx \
  src/renderer/home
pnpm typecheck
```

如果仓库不存在某个列出的组件测试，则只运行实际存在的文件并为新纯逻辑补测。

### 提交

```text
重构：拆分首页项目与偏好状态
```

## 8. 拆分 Settings 页面

涉及文件：

- 保留 `src/renderer/components/SettingsDialog.tsx` 作为兼容入口
- 新增 `src/renderer/settings/SettingsDialog.tsx`
- 新增 `src/renderer/settings/GeneralSettingsSection.tsx`
- 新增 `src/renderer/settings/ExternalLibrariesSettingsSection.tsx`
- 移动只属于 Settings 的辅助组件

职责：

- Dialog 外壳只管理目标 Section、导航和关闭；
- General Section 管理通用路径与设置；
- External Libraries Section 消费现有全局 Store，保留迁移冲突 Dialog；
- 后台下载生命周期继续属于 Main 和全局 Store。

保持 `SettingsTarget`、通知跳转、安装/取消/删除/迁移流程和所有用户文案不变。

### 测试

```bash
pnpm exec vitest run \
  src/renderer/components/SettingsDialog.test.tsx \
  src/renderer/external-libraries \
  src/renderer/settings
pnpm typecheck
```

### 提交

```text
重构：拆分设置页面职责
```

## 9. 同步架构文档和完整验证

涉及文件：

- 修改 `TECH_STACK.md`
- 必要时修正设计文档中的真实命令名称

文档更新：

- `AssetDatabase` 改为无状态 SQLite CRUD；
- `AssetService` 独占活动 Project Asset Map；
- Workbench Catalog 双端注册；
- Main Bootstrap / ApplicationRuntime；
- Renderer feature 目录和 Hook 职责；
- Attachment `metadata + workspace content ref`；
- 循环依赖扫描结果。

### 完整验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

另外执行：

- 生产源码静态依赖扫描，确认循环依赖为零；
- `git diff --check`；
- `git status --short`，确认只剩用户原有未跟踪文件。

### 提交

```text
文档：同步架构边界收敛结果
```

## 10. 人工验收清单

完成自动测试后交给用户本地验收：

1. Home 项目排序、网格/列表切换、创建、改名、置顶、删除；
2. 打开 Project、返回 Home、快速切换和重试；
3. 单个/批量/拖拽添加资料，以及链接外部文件；
4. Asset 刷新、重命名、删除、重新定位、在文件夹中显示；
5. Plain Text、Markdown、PDF、HTML、EPUB、Image、Audio、Video、Office 打开；
6. 右键菜单、Overflow、文字选区和 Workbench 状态恢复；
7. Settings 打开、跳转 External Libraries、后台下载和通知；
8. 退出应用时 Workbench、下载任务和 SQLite 正常释放。

人工验收完成前不 Push。
