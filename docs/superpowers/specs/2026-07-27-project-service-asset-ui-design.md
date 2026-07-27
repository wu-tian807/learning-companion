# ProjectService 与 Asset UI 接入设计

> 日期：2026-07-27
>
> 状态：已讨论，待用户复核

## 目标

把 Project 页面从静态演示数据迁移到真实的 Main 进程 Asset 状态，并新增 `ProjectService` 统一管理 Project 工作区的加载、卸载和删除顺序。

首期支持：

- 加载当前 Project 的 Asset。
- 通过文件选择器批量添加本地文件。
- 通过拖拽批量添加本地文件。
- 选择 Asset。
- 重命名 Asset。
- Relink Asset 的本地文件。
- 删除 Asset。
- 刷新 Asset 可用状态。
- 删除 Project 时卸载当前 Asset Map，并由 SQLite 级联删除持久化 Asset。

## ProjectService

新增 Main 进程服务：

```ts
export interface ProjectServiceApi {
  openProject(projectId: string): Promise<readonly Asset[]>;
  closeProject(projectId: string): void;
  deleteProject(projectId: string): void;
}
```

它组合：

- `ProjectDatabase`
- `AssetDatabase`

### openProject

```text
openProject(projectId)
  -> ProjectDatabase 内存 Map 验证 Project
  -> AssetDatabase.loadFromProject(projectId)
  -> 返回该 Project 的真实 Asset 快照
```

`AssetDatabase` 仍然只维护一个当前 Project 的 Asset Map。

### closeProject

```text
closeProject(projectId)
  -> 如果当前未加载 Project，幂等返回
  -> 如果当前 Project ID 不匹配，拒绝
  -> AssetDatabase.unloadProject()
```

该操作只卸载内存，不修改 SQLite。

### deleteProject

```text
deleteProject(projectId)
  -> ProjectDatabase 内存 Map 验证 Project
  -> 如果 AssetDatabase 当前加载的是该 Project
       -> 先 AssetDatabase.unloadProject()
  -> ProjectDatabase.delete(projectId)
  -> SQLite ON DELETE CASCADE 删除所属 Asset
```

删除的不是当前 Project 时，不卸载其他 Project 的 Asset Map。

不向 Renderer 暴露“批量删除某 Project 的 Asset”接口，避免前端编排两个可能部分成功的删除请求。

## Asset IPC

共享协议新增：

```ts
openProject({ projectId }): Promise<AssetSummary[]>
closeProject({ projectId }): Promise<void>
selectLocalAssetFiles(): Promise<string[]>
addLocalAssets({ paths }): Promise<AddLocalAssetsResult>
renameAsset({ assetId, name }): Promise<AssetSummary>
relinkAsset({ assetId, path }): Promise<AssetSummary>
deleteAsset({ assetId }): Promise<void>
refreshAsset({ assetId }): Promise<AssetSummary>
```

除 `openProject` 外，Asset 操作只针对 `AssetDatabase` 当前已加载的 Project，调用方不能自行传入或覆盖 `projectId`。

`AssetSummary` 包含：

- `id`
- `projectId`
- `name`
- `mediaType`
- `contentLocator.kind`
- `contentLocator.path`
- `contentLocator.availability`
- `contentLocator.checkedTime`
- `createdTime`
- `lastUsedTime`

Date 统一序列化为 ISO 字符串。

所有 IPC 请求在 Main 进程重新校验，Renderer 传入的数据不视为可信输入。

## 批量添加

文件选择器使用 Electron Main 进程 `dialog.showOpenDialog()`：

- 允许多选。
- 只选择普通文件。
- 用户取消时返回空数组。

拖拽只接受本地普通文件：

- 支持一次拖入多个文件。
- 不递归扫描文件夹。
- 拒绝 URL、纯文本和文件夹。
- 通过受限 Preload 能力取得拖入文件的本地路径。

文件选择器和拖拽最终共用：

```ts
addLocalAssets({ paths })
```

后端逐项调用 `AssetDatabase.add()`，采用部分成功语义：

```ts
interface AddLocalAssetsResult {
  added: AssetSummary[];
  failed: Array<{
    path: string;
    message: string;
  }>;
}
```

单个失败不回滚已经成功添加的 Asset。路径顺序和返回结果顺序保持一致。同一路径允许创建多个独立 Asset，沿用当前数据库模型。

## Project 删除 IPC

现有 Project 删除 Handler 改为依赖 `ProjectService.deleteProject()`，不再直接调用 `ProjectDatabase.delete()`。

Project 的列表、创建、重命名和置顶仍由 `ProjectDatabase` 处理。

## Renderer 状态

删除 `ProjectPage` 中的 `DISPLAY_ASSETS`。

Project 页面状态至少区分：

- `loading`
- `ready`
- `failed`

`ready` 状态保存后端返回的 `AssetSummary[]` 和当前选中的 Asset ID。

### 生命周期

```text
ProjectPage 挂载
  -> openProject(project.id)
  -> 使用后端结果渲染左侧栏

ProjectPage 卸载或返回 Home
  -> closeProject(project.id)
```

异步响应必须忽略已卸载页面或已经切换 Project 的旧结果。

### 选择规则

- 初次加载时，优先选择 `lastUsedTime` 最新的 `available` Asset。
- 没有可用项时选择列表第一项。
- 新增成功后选择本批次第一个成功项。
- 删除当前项后优先选择下一项，否则选择上一项。
- Relink 或刷新后变为不可用时仍保持选中。
- 空列表显示添加资料空状态。

### 左侧栏

左侧栏完全由真实 Asset 状态驱动：

- 名称来自 `name`。
- 类型来自 `mediaType`。
- 最近使用时间来自 `lastUsedTime`。
- 状态标记来自 `contentLocator.availability`。
- 选中状态来自当前 Asset ID。

每个 Asset 提供重命名、Relink、刷新状态和删除入口。删除需要确认。

### 中间阅读器

本阶段不实现具体媒体渲染器。

- 未选择 Asset：显示空状态。
- `missing`：显示文件已移动或删除，并提供 Relink。
- `inaccessible`：显示无权限提示，并提供刷新。
- `invalid`：显示路径无效提示。
- `available` 但媒体类型尚无阅读器：显示“暂不支持渲染此类型”。
- 已知可支持类型仍只保留预览器骨架，后续按媒体类型分别实现。

## 错误处理

- 页面加载失败显示重试入口。
- Mutation 期间禁用对应操作，防止重复提交。
- Mutation 失败保留上一次已确认的前端状态。
- 批量添加展示成功数量和逐项失败摘要。
- Project 关闭请求失败只记录错误，不阻止 Renderer 返回 Home。
- Project 删除失败由 Home 页面保留原 Project 并显示错误。

## 测试范围

### Main

- ProjectService 打开、关闭与删除顺序。
- 删除当前 Project 时先卸载 Asset Map。
- 删除其他 Project 时不卸载当前 Map。
- SQLite 外键级联删除 Project Asset。
- Asset IPC 请求校验和响应序列化。
- 批量添加的全成功、部分成功和全部失败。
- 文件选择器取消、多选和错误。

### Renderer

- Project 加载、失败和空状态。
- 初始选择规则。
- 添加、拖拽、重命名、Relink、刷新和删除状态更新。
- 当前项删除后的相邻选择。
- 不可用状态和不支持媒体提示。
- 卸载时关闭 Project，并忽略迟到响应。

## 本阶段不做

- 文件夹递归导入。
- URL 或网页拖拽导入。
- 批量选择和批量删除 Asset。
- 跨 Project 移动或复制 Asset。
- 重复路径去重。
- PDF、Markdown、EPUB 等具体阅读器。
- 阅读进度、索引、笔记和 AI 会话资源卸载。
- 多窗口同时打开多个 Project。
