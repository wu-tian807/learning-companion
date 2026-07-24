# Asset 后端结构设计

> 日期：2026-07-24
>
> 状态：后端结构已实施

## 目标

建立 Project 下的 Asset 后端结构，为后续本地文件选择、媒体阅读器、阅读进度和笔记组件提供稳定的数据边界。

本阶段只实现：

- Project 与 Asset 的一对多关系。
- 当前 Project 的 Asset 动态加载与卸载。
- `local-file` Content Locator。
- 本地文件有效性检查。
- 根据文件路径后缀推导标准 MIME。
- Asset 的 SQLite 持久化和内存写穿同步。

本阶段不实现 Source 实体。Asset 直接拥有内容定位器。

## 核心关系

```text
Project
└── Asset
    ├── ContentLocator
    ├── ReadingState（后续）
    ├── Notes（后续）
    ├── AI Annotations（后续）
    └── Media-specific Data（后续）
```

每个 Asset 当前只拥有一个 Content Locator。同一物理文件可以分别加入多个 Project，产生多个完全独立的 Asset。它们拥有不同的 Asset ID、名称、阅读进度、笔记和 AI 沉淀。

文件路径相同不构成 Asset 去重条件。

## 不建立 Source 实体

Source 目前没有独立身份、生命周期或复用行为。如果引入 Source，只会形成：

```text
Asset -> sourceId -> 本地路径
```

这会增加数据库查询和领域间接层，但没有提供当前产品需要的能力。因此：

- 不创建 `sources` 表。
- 不创建 SourceDatabase。
- 不创建 Source 内存池。
- 不在 Asset 中保存 `sourceId`。

未来只有在 Source 需要被多个 Asset 共享并独立管理时，才重新评估是否提取 Source 实体。

## Asset 数据结构

Asset 是纯数据快照，不直接持有数据库连接、文件句柄、解析器或业务服务。

```ts
export interface Asset {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentLocator: LocalFileContentLocator;
  readonly createdTime: Date;
  readonly lastUsedTime: Date;
}
```

字段含义：

- `id`：应用生成的 UUID，同时作为 SQLite 主键和内存 Map Key。
- `projectId`：所属 Project ID，创建后不可修改。
- `name`：用户看到的 Asset 名称。创建时默认取文件名并移除最后一个后缀，后续允许独立修改。
- `mediaType`：标准 MIME，由 Main 根据本地路径的后缀推导。
- `contentLocator`：内容位置和当前内存有效性状态。
- `createdTime`：Asset 创建时间。
- `lastUsedTime`：用户最后打开或使用 Asset 的时间。

Asset 快照必须冻结。向调用方返回 Asset 时复制 `Date` 和嵌套 Locator，避免调用方修改内部 Map。

## LocalFileContentLocator

Content Locator 描述“内容在哪里、怎样访问”。媒体类型描述“取得内容后是什么格式”，二者是不同维度。

```ts
export type LocalFileAvailability =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'invalid';

export interface LocalFileContentLocator {
  readonly kind: 'local-file';
  readonly path: string;
  readonly availability: LocalFileAvailability;
  readonly checkedTime: Date;
}
```

本阶段只支持 `local-file`。保留 `kind` 判别字段，是为了未来能够安全扩展：

```ts
type AssetContentLocator =
  | LocalFileContentLocator
  | WebUrlContentLocator
  | ManagedFileContentLocator;
```

当前不实现后两种类型。

### 持久化边界

SQLite 只保存稳定信息：

- `content_kind`
- `content_path`

`availability` 和 `checkedTime` 不写入 SQLite。文件系统才是真实来源，持久化的可用状态容易过期。每次加载 Project 时重新检查，并把结果写入当前内存 Locator。

## Locator 状态检查

Locator 只记录状态，文件系统检查由独立对象负责：

```ts
export interface LocalFileLocatorChecker {
  check(path: string): Promise<LocalFileContentLocator>;
}
```

检查器使用异步文件系统 API，避免网络磁盘或异常文件系统长时间阻塞 Electron Main。

状态映射：

```text
路径是可读取的普通文件       -> available
ENOENT / ENOTDIR            -> missing
EACCES / EPERM              -> inaccessible
路径存在但不是普通文件       -> invalid
```

检查器返回新的冻结 Locator，不修改已有对象。

加载 Project 时，即使文件变成 `missing`、`inaccessible` 或 `invalid`，Asset 仍然进入内存 Map。这样 Asset 的笔记和其他学习状态不会因物理文件暂时失效而丢失。

新增 Asset 时必须先检查文件，只有 `available` 才允许写入数据库。重新定位失效文件属于后续功能。

## MIME 检测

Main 根据规范化路径的最后一个后缀推导 MIME：

```text
.md / .markdown -> text/markdown
.pdf            -> application/pdf
.txt            -> text/plain
.epub           -> application/epub+zip
未知或无后缀     -> application/octet-stream
```

后缀比较不区分大小写。

媒体类型检测和渲染支持是两个不同概念：

```text
path
  -> 后缀
  -> 标准 MIME
  -> RendererRegistry（后续）
```

没有对应 Renderer 的文件仍然可以创建 Asset。未来打开这类 Asset 时，中间阅读区域显示“暂时不支持渲染此类型”，而不是拒绝或删除 Asset。

后续可以把 MIME 检测升级为文件头探测，不改变 Asset 或 Renderer 的接口。

## 默认名称

创建 Asset 时从路径生成默认名称：

```text
/资料/Transformer 学习笔记.md -> Transformer 学习笔记
/资料/attention.v2.pdf         -> attention.v2
```

只移除最后一个后缀。无后缀文件使用完整文件名。名称生成后独立于物理文件名；后续重命名 Asset 不修改本地文件。

## SQLite 结构

新增 `assets` 表：

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_kind TEXT NOT NULL
    CHECK (content_kind = 'local-file'),
  content_path TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  last_used_time INTEGER NOT NULL,
  FOREIGN KEY (project_id)
    REFERENCES projects(id)
    ON DELETE CASCADE
);

CREATE INDEX assets_project_id_index
  ON assets(project_id);
```

规则：

- 一个 Project 可以拥有多个 Asset。
- 一个 Asset 只能属于一个 Project。
- `project_id` 创建后不可修改。
- `content_path` 不加唯一约束。
- 删除 Project 时由 SQLite 级联删除所属 Asset。
- 数据库迁移版本从 1 升级到 2。

## AssetDatabase 内存模型

当前应用一次只打开一个 Project，因此只维护一个活动 Project 的 Asset Map：

```ts
export class AssetDatabase {
  private activeProjectId: string | undefined;
  private assetMap = new Map<string, Asset>();
}
```

不实现多 Project Map，不实现 LRU，也不预加载全部 Asset。

### 接口

```ts
export interface AssetDatabaseApi {
  loadProject(projectId: string): Promise<readonly Asset[]>;
  unloadProject(): void;

  getActiveProjectId(): string | undefined;
  list(): readonly Asset[];
  get(assetId: string): Asset | undefined;

  add(input: CreateAssetInput): Promise<Asset>;
  update(assetId: string, changes: UpdateAssetInput): Asset;
  delete(assetId: string): void;
  refreshAvailability(assetId: string): Promise<Asset>;
}
```

`CreateAssetInput` 不包含 `projectId`、`name` 或 `mediaType`：

```ts
export interface CreateAssetInput {
  readonly path: string;
}
```

创建时由 AssetDatabase：

1. 取得当前 `activeProjectId`。
2. 规范化并验证绝对路径。
3. 调用 LocalFileLocatorChecker。
4. 从路径生成默认名称。
5. 从路径后缀生成 MIME。
6. 生成 Asset UUID 和时间。
7. 写入 SQLite。
8. 写入当前内存 Map。

调用方不能指定 `projectId`，避免把 Asset 写入非当前 Project。

`UpdateAssetInput` 首版只允许修改：

- `name`
- `lastUsedTime`

不允许修改 `id`、`projectId`、`mediaType` 或 `contentLocator`。失效文件重新定位将在单独设计中实现。

## 加载与卸载

### 加载

```text
loadProject(projectId)
  -> 验证 Project 存在
  -> 查询 assets.project_id = projectId
  -> 验证每一条持久化数据
  -> 检查每一个本地文件
  -> 创建临时 Map
  -> 所有记录完成后原子替换当前 Map
  -> 设置 activeProjectId
```

如果当前已加载另一个 Project，成功加载新 Project 后直接替换旧 Map。调用方忘记卸载也不会遗留旧 Asset。

数据库记录无效时，整个加载失败并保留旧 Map。单个文件物理失效不会导致加载失败，只会得到非 `available` 状态。

重复加载同一个 Project 也重新查询 SQLite 和检查文件，以恢复最新状态。

Project 是否存在由 AssetDatabase 直接使用同一个 DatabaseContext 查询
`projects` 表，不依赖 ProjectDatabase 的内存实现。这样 AssetDatabase 只依赖数据库
Context、Locator Checker 和可注入的 ID/时钟，不形成两个写穿容器之间的行为耦合。

### 卸载

```text
unloadProject()
  -> assetMap.clear()
  -> activeProjectId = undefined
```

所有修改都即时写穿 SQLite，因此卸载时不执行额外保存。

### 未加载状态

没有活动 Project 时：

- `getActiveProjectId()` 返回 `undefined`。
- `list()`、`get()`、`add()`、`update()`、`delete()` 和 `refreshAvailability()` 抛出“AssetDatabase 尚未加载 Project”。

## 写穿一致性

AssetDatabase 延续 ProjectDatabase 的写穿原则：

```text
创建、更新、删除
  -> 先提交 SQLite
  -> 检查影响行数
  -> 再替换内存 Map
```

SQLite 失败时不得修改内存 Map。

读取接口返回克隆快照。更新时创建完整的新 Asset，不原地修改旧对象。

所有根据 `assetId` 进行的操作，都必须确认 Asset 存在于当前 Map。这样操作天然限制在当前活动 Project。

## 运行时重资源边界

当前 Asset Map 只保存轻量数据快照，不保存：

- 文件句柄。
- PDF.js 文档实例。
- Markdown 语法树。
- EPUB 阅读实例。
- 全文索引句柄。

未来这些重资源由独立 `LoadedAssetPool` 管理。它不属于本阶段，也不应混入 AssetDatabase。

## 错误处理

需要明确区分：

- Project 不存在。
- AssetDatabase 尚未加载 Project。
- Asset 不存在于当前 Project。
- 路径不是绝对路径。
- 新增文件不是 `available`。
- Asset 持久化记录结构无效。
- SQLite 影响行数不符合预期。

文件变成 `missing`、`inaccessible` 或 `invalid` 是业务状态，不是 Project 加载错误。

## 测试范围

### Asset 纯数据

- Asset ID、Project ID、名称、MIME 和日期校验。
- 嵌套 Locator 和 Date 的冻结与克隆。
- 不允许无效 `content_kind`、空路径或无效日期。
- 默认名称只移除最后一个后缀。
- 后缀到 MIME 的映射和未知类型回退。

### Locator Checker

- 普通可读文件为 `available`。
- 不存在路径为 `missing`。
- 目录为 `invalid`。
- 权限错误映射为 `inaccessible`。
- `checkedTime` 由可注入时钟生成。

### AssetDatabase

- 启动时没有活动 Project。
- 加载 Project 后只包含该 Project 的 Asset。
- 加载另一个 Project 原子替换当前 Map。
- 卸载后清空 Project ID 和 Map。
- 加载时保留物理文件失效的 Asset。
- 新增 Asset 自动绑定当前 Project。
- 新增时自动生成名称、MIME、UUID 和时间。
- 未加载时所有数据操作失败。
- CRUD 成功后数据库和 Map 一致。
- SQLite 失败时 Map 保持不变。
- 不允许跨当前 Project 操作 Asset。
- Project 删除时 SQLite 级联删除 Asset。

## 文件安排

计划新增或填写：

```text
src/main/assets/asset.ts
src/main/assets/asset-database.ts
src/main/assets/asset-content-locator.ts
src/main/assets/asset-media-type.ts
src/main/database/schema/assets.ts
src/main/database/migrations/0002-create-assets.ts
```

为上述模块分别增加测试。

需要修改数据库 Context，使 Drizzle schema 同时包含 `projects` 和 `assets`。

## 本阶段明确不做

- Source 实体、Source 表或 SourceDatabase。
- Asset IPC、Preload 或 Renderer 接线。
- 文件选择器。
- Markdown、PDF、EPUB 等阅读器。
- RendererRegistry。
- LoadedAssetPool。
- 文件重新定位。
- 文件变化监听。
- 阅读进度、笔记或 AI Annotation 表。
- 多 Project 同时加载。
- 多窗口一致性。
