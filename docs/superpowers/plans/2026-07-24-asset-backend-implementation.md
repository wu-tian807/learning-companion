# Asset 后端结构实施计划

> 依据：`docs/superpowers/specs/2026-07-24-asset-backend-design.md`
>
> 日期：2026-07-24

## 目标

在不接入 IPC 和 Renderer 的前提下，实现 Project 所属 Asset 的 SQLite 结构、纯数据模型、本地文件 Locator 检查，以及只维护一个当前 Project 的 AssetDatabase 写穿容器。

## 阶段一：Asset 数据库结构

新增：

- `src/main/database/migrations/0002-create-assets.ts`
- `src/main/database/schema/assets.ts`

修改：

- `src/main/database/database-context.ts`
- `src/main/database/initialize-database.ts`
- `src/main/database/initialize-database.test.ts`

步骤：

1. 新增 `assets` 表和 `project_id` 索引。
2. 使用外键连接 `projects.id`，删除 Project 时级联删除 Asset。
3. `content_kind` 首版只允许 `local-file`，`content_path` 不加唯一约束。
4. 将数据库迁移版本升级到 2，并保持已有数据库顺序迁移。
5. 组合 projects 与 assets Drizzle schema。
6. 测试新数据库、从版本 1 升级、幂等初始化、索引、外键和级联删除。
7. 执行 `pnpm check` 与原生模块冒烟测试。
8. 独立提交“数据库：新增 Asset 持久化结构”。

## 阶段二：Asset 与 Local File Locator 纯模型

填写或新增：

- `src/main/assets/asset.ts`
- `src/main/assets/asset-content-locator.ts`
- `src/main/assets/asset-media-type.ts`
- 对应测试

步骤：

1. 定义纯数据 `Asset`、创建输入和更新输入。
2. 实现 Asset 的校验、冻结与深克隆。
3. 定义只存在于内存的 `availability` 和 `checkedTime`。
4. 实现异步 LocalFileLocatorChecker，把文件系统结果映射为四种状态。
5. 对路径执行绝对路径检查和平台规范化。
6. 从文件名生成去除最后一个后缀的默认名称。
7. 从不区分大小写的路径后缀推导标准 MIME，未知类型回退到 `application/octet-stream`。
8. 使用可注入时钟和文件系统依赖覆盖可用、缺失、无权限和非普通文件测试。
9. 执行 `pnpm check`。
10. 独立提交“功能：实现 Asset 与本地文件 Locator”。

## 阶段三：当前 Project 的 AssetDatabase

填写：

- `src/main/assets/asset-database.ts`
- `src/main/assets/asset-database.test.ts`

步骤：

1. 实现 `activeProjectId` 和单个 `Map<assetId, Asset>`。
2. `loadProject` 验证 Project、查询所属 Asset、检查 Locator，并在全部成功后原子替换 Map。
3. `unloadProject` 清空当前 Project 和 Map，不额外写数据库。
4. 实现当前 Project 内的 list、get、add、update、delete 和 refreshAvailability。
5. add 从当前 Project 自动取得 `projectId`，调用方只传本地路径。
6. CRUD 先提交 SQLite，再替换 Map；失败时保持内存不变。
7. 读取结果返回深克隆快照，禁止调用方修改内部状态。
8. 覆盖未加载、切换 Project、失效文件保留、自动绑定、跨 Project 隔离和写穿失败测试。
9. 执行 `pnpm check`。
10. 独立提交“功能：实现 Project 级 Asset 写穿容器”。

## 阶段四：完整验证

步骤：

1. 执行 `pnpm check`。
2. 执行 `pnpm smoke:native`。
3. 执行 `pnpm package`。
4. 执行 `pnpm verify:package:native`。
5. 检查数据库版本、Asset 表结构和 Project 级联删除。
6. 检查工作区，只暂存 Asset 后端与文档涉及文件。

## 实施约束

- 不创建 Source 实体、Source 表或 SourceDatabase。
- 不接入 Asset IPC、Preload 或 Renderer。
- 不实现文件选择器、阅读器或 RendererRegistry。
- 不实现 LoadedAssetPool。
- 不实现文件重新定位和变化监听。
- 不实现阅读进度、笔记或 AI Annotation。
- 不维护多个 Project 的 Asset Map。
- 不修改用户的 `AGENTS.md` 和教程草稿。
- 不执行 push，除非用户另行要求。
