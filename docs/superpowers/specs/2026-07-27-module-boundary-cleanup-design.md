# Project IPC、Asset Shell 与时间契约收口设计

> 日期：2026-07-27
>
> 状态：待实施

## 背景

Project、Asset、Content 和 Workbench 主干完成后，当前还有三个小型边界问题：

- `project:open`、`project:close` 注册在 `ipc/assets.ts`，与 IPC 文件的领域归属不一致。
- `AssetFileService` 当前只封装 Electron Shell 的系统操作，名称容易被理解为文件读取或解析服务。
- Attachment、Workbench State 和 Asset Relation 骨架仍使用 `Date`，与 Project、Asset 已采用的 Unix 毫秒契约不一致。

这些问题应在实现第一个具体 Workbench 前收口，避免后续模块继续引用含义不清或不一致的接口。

## 目标

- Project 生命周期 IPC 由 Project IPC 模块维护。
- 将 `AssetFileService` 重命名为职责更精确的 `AssetShellService`。
- 将尚未持久化的 Attachment、Workbench State、Asset Relation 时间字段统一为 Unix 毫秒 `number`。
- 保持现有行为、错误语义和 Renderer API 不变。

## 非目标

- 不实现任何具体 Workbench。
- 不修改文件选择器；`dialog.showOpenDialog()` 暂时保留在 Asset IPC。
- 不注册 managed-json Resolver 或实现其 Repository。
- 不实现 Attachment、Workbench State、Asset Relation 的数据库表或真实业务。
- 不连接 AttachmentHost。

## Project IPC 归位

`project:open` 和 `project:close` 从 `src/main/ipc/assets.ts` 移至
`src/main/ipc/projects.ts`。

调用链保持不变：

```text
Renderer
  → Preload
  → Project IPC
  → ProjectService
  → WorkbenchSessionManager / AssetService
```

因此：

- `registerProjectHandlers()` 继续只依赖 `ProjectServiceApi`。
- `registerAssetHandlers()` 不再接收 `ProjectServiceApi`。
- `removeProjectHandlers()` 负责移除 Project 打开和关闭通道。
- Preload、共享 IPC 通道名称和 Renderer 调用方式均不改变。

## AssetShellService

文件及类型名称统一改为：

```text
asset-file-service.ts          → asset-shell-service.ts
AssetFileServiceApi            → AssetShellServiceApi
AssetFileServiceDependencies   → AssetShellServiceDependencies
AssetFileService               → AssetShellService
```

该服务属于平台能力适配层，负责把已验证的 local-file Asset 映射到
Electron Shell 或操作系统行为。

当前唯一能力仍是：

```ts
revealInFolder(assetId: string): void;
```

它继续通过 AssetService 取得当前运行时快照，并在调用系统能力前校验：

- Asset 存在。
- `contentRef.kind === 'local-file'`。
- `contentStatus.availability === 'available'`。

它不承担文件选择、文件读取、媒体类型探测、内容解析或 Asset 持久化。

## 时间契约

以下字段由 `Date` 改为 Unix 毫秒 `number`：

```text
AssetAttachment.createdTime
AssetAttachment.updatedTime
WorkbenchStateRecord.updatedTime
AssetRelation.createdTime
```

本轮只统一类型，不新增构造器、运行时守卫、数据库迁移或序列化逻辑。等对应模块开始真实持久化时，再复用共享的 `isUnixMilliseconds()` 完成输入与数据库边界校验。

## 错误处理

不新增错误类型：

- Asset 不存在继续返回 `ASSET_NOT_FOUND`。
- Asset 不是可用本地文件继续返回 `ASSET_UNAVAILABLE`。
- IPC 参数无效继续返回 `INVALID_IPC_REQUEST`。
- 所有异常继续由 `registerIpcHandler()` 统一转换为 IPC 错误响应。

## 测试

- 将 Project 打开、关闭、非法请求和 Handler 移除测试迁移到 `projects.test.ts`。
- Asset IPC 测试不再构造或断言 ProjectService。
- `AssetShellService` 测试随文件和类型一起重命名，行为断言保持不变。
- Empty Service 测试继续确保尚未实现的接口返回空结果或 `FEATURE_NOT_SUPPORTED`。
- 使用静态检索确认生产代码中不再出现旧 `AssetFileService` 名称和骨架 `Date` 字段。
- 运行 `pnpm check`。

## 提交拆分

1. `重构：将 Project 生命周期 IPC 归位`
2. `重构：明确 Asset Shell 平台服务`
3. `重构：统一扩展骨架时间契约`

## 完成标准

- Project 打开和关闭通道只由 Project IPC 注册与移除。
- Asset IPC 不再依赖 ProjectService。
- 旧 `AssetFileService` 文件和类型名称全部删除。
- Attachment、Workbench State、Asset Relation 的契约不再使用 `Date`。
- 全量类型检查、Lint 和测试通过。
