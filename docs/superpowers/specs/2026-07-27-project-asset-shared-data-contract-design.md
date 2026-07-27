# Project 与 Asset 共享数据契约收敛设计

> 日期：2026-07-27
>
> 状态：待实施
>
> 前置设计：`2026-07-27-asset-workbench-architecture-design.md`

## 背景

资料工作台第一阶段完成后，Project 和 Asset 已具备清晰的 Database、Service 与 Renderer 边界，但同一份数据在各层仍有多套表达：

- SQLite Asset Row 使用 `contentKind` 和 `contentPath`。
- Main Asset 使用 `contentRef`、`Date` 和嵌套的 `AssetRuntimeSnapshot`。
- Renderer 使用 `AssetSummary`、`contentLocator` 和 ISO 日期字符串。
- Project 同样在 Main 使用 `Project + Date`，在 IPC 和 Renderer 使用 `ProjectSummary + ISO 字符串`。
- Project IPC 同时依赖 ProjectDatabase 和 ProjectService，绕过了统一的高层用例入口。

项目仍处于开发阶段，现有 Asset 只用于测试。当前应优先得到长期干净的数据模型，而不是为测试数据保留兼容映射。

## 目标

- Database 上层、Main、Preload 和 Renderer 共用一套 Project/Asset 纯数据契约。
- Project 与 Asset 采用对称的 Entity → Service → Snapshot 分层。
- 删除 `ProjectSummary`、`ProjectOverview`、`AssetSummary`、`AssetRuntimeSnapshot` 和 `contentLocator` 等重复表达。
- SQLite Asset 表直接保存 `AssetContentRef` JSON。
- 所有跨层时间统一使用 Unix 毫秒。
- 只清空并重建 Asset 表，保留现有 Projects。
- 保持 Renderer 无 Node、文件系统、数据库或 `ContentHandle` 能力的安全边界。

## 非目标

- 不新增 Project 或 Asset 业务功能。
- 不实现 managed JSON 的真实存储。
- 不实现具体媒体 Workbench。
- 不修改 Workbench、Attachment、Anchor 或 Relation 的业务能力。
- 不保留现有测试 Asset。
- 不清空或重建 Projects。

## 共享数据契约

新增两个聚焦的共享模块：

```text
src/shared/
├── projects.ts
└── assets.ts
```

### Project

```ts
interface Project {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly createdTime: number;
  readonly pinned: boolean;
}

interface ProjectSnapshot extends Project {
  readonly assetCount: number;
}
```

`Project` 是持久化实体；`ProjectSnapshot` 是首页需要的运行时/展示快照。

### Asset

```ts
type AssetContentRef =
  | {
      readonly kind: 'local-file';
      readonly path: string;
    }
  | {
      readonly kind: 'managed-json';
      readonly contentId: string;
    };

interface Asset {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly contentRef: AssetContentRef;
  readonly createdTime: number;
  readonly lastUsedTime: number;
}

type AssetAvailability =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'invalid';

interface AssetContentStatus {
  readonly availability: AssetAvailability;
  readonly checkedTime: number;
}

interface AssetSnapshot extends Asset {
  readonly contentStatus: AssetContentStatus;
}
```

`Asset` 是持久化实体；`AssetSnapshot` 在其上增加不持久化的内容检查结果。

### 时间

所有 Project/Asset 时间统一为 Unix 毫秒：

- SQLite 使用 `INTEGER`。
- Drizzle 使用普通 number 模式，不转换为 `Date`。
- Main 内存对象使用 `number`。
- IPC 直接结构化克隆 `number`。
- Renderer 使用 `new Date(timestamp)` 进行显示。

共享守卫要求时间为非负安全整数。系统不再执行 `Date ↔ ISO string` 转换。

### 共享模块职责

共享模块包含：

- 纯数据类型。
- 字段长度常量。
- ContentRef、Entity 和 Snapshot 的运行时守卫。
- 不依赖 Node、Electron、React 或 SQLite 的克隆/校验函数。

Main 可以继续保留聚焦的创建输入和更新输入，但不得重新定义 Project、Asset、ContentRef 或 Snapshot 数据形状。

## SQLite 设计

### 最终 Asset 表

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  last_used_time INTEGER NOT NULL,
  FOREIGN KEY (project_id)
    REFERENCES projects(id)
    ON DELETE CASCADE,
  CHECK (json_valid(content_ref)),
  CHECK (
    (
      json_extract(content_ref, '$.kind') = 'local-file'
      AND typeof(json_extract(content_ref, '$.path')) = 'text'
      AND length(trim(json_extract(content_ref, '$.path'))) > 0
    )
    OR
    (
      json_extract(content_ref, '$.kind') = 'managed-json'
      AND typeof(json_extract(content_ref, '$.contentId')) = 'text'
      AND length(trim(json_extract(content_ref, '$.contentId'))) > 0
    )
  )
);

CREATE INDEX assets_project_id_index
  ON assets(project_id);
```

Drizzle 使用 JSON text 模式把 `content_ref` 映射为 `AssetContentRef`。数据库读取后仍必须调用共享运行时守卫，不能把 JSON 类型标注视为数据可信证明。

### 迁移

- 更新 `0002-create-assets`，使全新数据库直接创建最终结构。
- 新增 version 3 的 `0003-recreate-assets`。
- version 3 在同一个迁移事务中：
  1. `DROP TABLE assets`；
  2. 按最终结构重新创建；
  3. 重建 `assets_project_id_index`。
- Projects 表及其数据不变。
- 现有 Asset 全部清空，不尝试转换或备份。
- 迁移失败时事务回滚，数据库仍停留在 version 2 和旧 Asset 表。

`projects.created_time` 已经以整数存储，只需移除 Drizzle 的 Date 映射，不需要 Project 数据迁移。

## 对称分层

```text
ProjectDatabase → Project → ProjectService → ProjectSnapshot → Renderer
AssetDatabase   → Asset   → AssetService   → AssetSnapshot   → Renderer
```

### Database

Database 层只负责：

- SQLite Row 与共享 Entity 的一一映射。
- Map 缓存。
- CRUD、查询与写入冲突检查。
- 数据库 JSON 的运行时完整性校验。

Database 层不负责：

- 计算展示字段。
- 内容可用性检查。
- Workbench 生命周期。
- IPC DTO 转换。

### Service

Service 层是应用用例的唯一入口：

- `ProjectService` 组合 ProjectDatabase、AssetService 和 Workbench Session。
- `AssetService` 组合 AssetDatabase、ContentResolverRegistry 和媒体类型识别。
- Service 在纯 Entity 上补充运行时信息，返回共享 Snapshot。
- IPC 不直接调用 Database。

### Snapshot

Snapshot 只包含消费方确实需要的派生状态：

- `ProjectSnapshot` 比 `Project` 多 `assetCount`。
- `AssetSnapshot` 比 `Asset` 多 `contentStatus`。

Snapshot 不包含方法、Handle、数据库对象或 Electron 对象，因此可以原样跨 IPC。

## Project 数据流

### ProjectDatabase

保持现有全量 Project Map：

- `initialize`
- `list`
- `get`
- `add`
- `update`
- `delete`

方法返回共享 `Project`，`createdTime` 为 number。

### ProjectService

成为所有 Project 用例的唯一入口：

- `listProjects(): readonly ProjectSnapshot[]`
- `getProject(projectId): ProjectSnapshot | undefined`
- `createProject(input): ProjectSnapshot`
- `renameProject(projectId, name): ProjectSnapshot`
- `setProjectPinned(projectId, pinned): ProjectSnapshot`
- `openProject(projectId): Promise<readonly AssetSnapshot[]>`
- `closeProject(projectId): Promise<void>`
- `deleteProject(projectId): Promise<void>`

删除顺序保持：

```text
Workbench Session → AssetService → ProjectDatabase
```

Project IPC 只依赖 ProjectService，不再依赖 ProjectDatabase，不再存在 `ProjectOverview` 或 `toProjectSummary()`。

## Asset 数据流

### AssetDatabase

- 直接读写共享 `Asset`。
- `content_ref` 直接映射为 `contentRef`。
- 数据库读取时使用 `isAssetContentRef` 校验 JSON。
- 不再存在 `contentKind/contentPath` 映射。
- 不执行文件访问或 availability 检查。

### AssetService

- 活动 Map 类型为 `Map<string, AssetSnapshot>`。
- Service API 直接返回 `AssetSnapshot`。
- 删除 `AssetRuntimeContent` 和 `AssetRuntimeSnapshot`。
- 调用方直接使用 `snapshot.name`、`snapshot.contentRef` 和 `snapshot.contentStatus`，不再访问 `snapshot.asset` 或 `snapshot.content`。

### Content Resolver

统一命名：

```ts
interface ResolvedAssetContent {
  readonly contentRef: AssetContentRef;
  readonly contentStatus: AssetContentStatus;
  readonly handle?: ContentHandle;
}
```

删除同一概念的 `ref/status` 简写。`ContentHandle` 仍然只存在于 Main。

### Asset IPC

- 删除 `AssetSummary` 和 `toAssetSummary()`。
- 直接返回共享 `AssetSnapshot`。
- 导入、重命名、Relink、刷新和批量刷新接口均使用同一返回类型。
- Preload 只暴露白名单调用，不改写数据。

## Renderer

Renderer 从共享模块直接导入 `ProjectSnapshot` 和 `AssetSnapshot`：

```text
project.createdTime
asset.createdTime
asset.lastUsedTime
asset.contentRef
asset.contentStatus
```

主要替换：

```text
ProjectSummary                         → ProjectSnapshot
AssetSummary                           → AssetSnapshot
asset.contentLocator.path              → asset.contentRef.path
asset.contentLocator.availability      → asset.contentStatus.availability
asset.contentLocator.checkedTime       → asset.contentStatus.checkedTime
Date.parse(project.createdTime)        → project.createdTime
new Date(ISO string)                   → new Date(timestamp)
```

ProjectPage、AssetWorkbenchHost、UnsupportedWorkbench、Home 和列表/排序辅助函数全部使用共享 Snapshot。

Renderer 得到本地路径只用于展示和发回受限命令；它仍不能自行读取该路径。

## Workbench

Workbench Session 保持两个不同职责的数据：

- `asset: Asset`：持久化身份和语义数据。
- `content: ResolvedAssetContent`：本次打开得到的状态和能力 Handle。

SessionManager 从 `AssetSnapshot` 取得 Asset 字段，再通过 AssetService 获取 `ResolvedAssetContent`。Bootstrap 只发送 Renderer 启动所需的可序列化字段，不发送 Handle。

Workbench 协议中的 availability 类型改为从 `shared/assets.ts` 导入，消除 `shared/workbench/protocol.ts → shared/ipc.ts` 的反向依赖。

## 错误处理

- 非法 `content_ref`：`DATA_INTEGRITY_ERROR`。
- 无效 Project/Asset/Snapshot IPC 返回值：Renderer 统一显示内部契约错误。
- 无效或越界时间戳：数据完整性错误或无效 IPC 请求。
- 迁移失败：事务回滚并关闭数据库，不部分应用新 Schema。
- 找不到 Project、Asset、Resolver 或 Workbench：继续使用现有领域错误。
- 文件不可用：仍以 `contentStatus` 返回业务状态，不视为数据库错误。

## 测试

### 共享契约

- Project、ProjectSnapshot、Asset、AssetSnapshot 守卫。
- local-file 与 managed-json ContentRef。
- 空字符串、未知 kind、无效 MIME、非法时间和非法 availability。

### 数据库迁移

- 新数据库最终 `user_version = 3`。
- 全新数据库直接具有 JSON Asset Schema。
- version 2 升级后 Projects 保留、Assets 清空。
- 外键、级联删除、JSON CHECK 和 Project 索引有效。
- 重复初始化不重复迁移。

### Database 与 Service

- Project/Asset Row 映射返回共享 Entity。
- Asset JSON 在读取边界被校验。
- 两个 Service 返回共享 Snapshot。
- Project IPC 只调用 ProjectService。
- Asset IPC 不再转换 DTO。
- Project/Asset CRUD、计数、加载、卸载、刷新、Relink 和删除顺序回归。

### Renderer 与 Workbench

- Home 排序与日期格式化使用 timestamp。
- ProjectPage 的状态、路径和日期展示回归。
- AssetWorkbenchHost 的切换键使用 `contentStatus.checkedTime`。
- UnsupportedWorkbench 的路径和 availability 展示回归。
- Workbench Session 打开、替代和关闭回归。

### 完整验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

Electron 手动验证：

1. 启动新版应用，确认已有 Projects 仍存在且 Asset 数量为 0。
2. 打开 Project 并批量添加本地文件。
3. 切换 Asset，确认中栏和状态来自真实 `AssetSnapshot`。
4. 移动文件后刷新，确认 missing 状态。
5. Relink 同类型文件并恢复 available。
6. 返回 Home，确认 Asset 数量和 Project 排序正确。

## 完成标准

- Database 上层到 Renderer 不再存在 Project/Asset DTO 转换。
- `Project`/`ProjectSnapshot` 与 `Asset`/`AssetSnapshot` 成为唯一数据类型。
- `contentKind`、`contentPath`、`contentLocator`、`ProjectSummary`、`ProjectOverview`、`AssetSummary` 和 `AssetRuntimeSnapshot` 从生产代码删除。
- Project IPC 只依赖 ProjectService。
- version 3 迁移保留 Projects 并清空 Assets。
- 所有自动化、原生依赖和打包验证通过。
