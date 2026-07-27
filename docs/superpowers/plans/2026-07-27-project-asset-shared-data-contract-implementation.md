# Project 与 Asset 共享数据契约实施计划

> 依据：`docs/superpowers/specs/2026-07-27-project-asset-shared-data-contract-design.md`
>
> 日期：2026-07-27
>
> 状态：执行中

## 实施原则

- 现有 Projects 必须保留，现有 Assets 明确允许清空。
- 先建立共享契约，再逐层替换 Main、IPC 和 Renderer。
- 每个阶段保持 TypeScript 可检查，避免同时维护两套长期兼容层。
- 每个功能改动独立提交，提交前运行与改动相称的测试。
- 不修改或提交用户已有的 `AGENTS.md` 和 `tsx教程.md`。

## 阶段一：共享 Project/Asset 契约

### 新增

- `src/shared/projects.ts`
- `src/shared/projects.test.ts`
- `src/shared/assets.ts`
- `src/shared/assets.test.ts`

### 修改

- `src/shared/ipc.ts`
- `src/shared/ipc.test.ts`
- `src/shared/workbench/protocol.ts`
- `src/shared/workbench/protocol.test.ts`

### 内容

1. 定义唯一的 `Project`、`ProjectSnapshot`、`AssetContentRef`、`Asset`、`AssetContentStatus` 和 `AssetSnapshot`。
2. 所有时间改为非负 Unix 毫秒安全整数。
3. 提供运行时守卫和不可变克隆/创建函数。
4. IPC API 改为引用共享 Snapshot，不再定义 Summary。
5. Workbench 协议直接依赖共享 availability 类型。

### 验证

```bash
pnpm typecheck
pnpm vitest run src/shared/projects.test.ts src/shared/assets.test.ts src/shared/ipc.test.ts src/shared/workbench/protocol.test.ts
```

### 提交

```text
重构：统一 Project 与 Asset 共享数据契约
```

## 阶段二：数据库 Schema 与 Entity

### 新增

- `src/main/database/migrations/0003-recreate-assets.ts`

### 修改

- `src/main/database/migrations/0002-create-assets.ts`
- `src/main/database/schema/projects.ts`
- `src/main/database/schema/assets.ts`
- `src/main/database/initialize-database.ts`
- `src/main/database/initialize-database.test.ts`
- `src/main/projects/project.ts`
- `src/main/projects/project-database.ts`
- `src/main/projects/project.test.ts`
- `src/main/projects/project-database.test.ts`
- `src/main/assets/asset.ts`
- `src/main/assets/asset-database.ts`
- `src/main/assets/asset.test.ts`
- `src/main/assets/asset-database.test.ts`

### 内容

1. Project 与 Asset Entity 改为共享 number 时间契约。
2. Asset Schema 使用 JSON `content_ref`，删除 `content_kind/content_path`。
3. 新数据库直接创建最终表。
4. version 2 数据库通过 version 3 迁移保留 Projects、清空并重建 Assets。
5. AssetDatabase 在读取 JSON 后执行共享守卫。

### 验证

```bash
pnpm typecheck
pnpm vitest run src/main/database/initialize-database.test.ts src/main/projects/project.test.ts src/main/projects/project-database.test.ts src/main/assets/asset.test.ts src/main/assets/asset-database.test.ts
```

### 提交

```text
数据库：重建 Asset 表并采用共享实体
```

## 阶段三：ContentResolver 与 AssetService

### 修改

- `src/main/content/content-ref.ts`
- `src/main/content/content-resolver-registry.ts`
- `src/main/content/resolvers/local-file/*`
- `src/main/content/resolvers/managed-json/*`
- `src/main/assets/asset-service.ts`
- `src/main/assets/asset-file-service.ts`
- 相关测试。

### 内容

1. `ResolvedAssetContent` 字段统一为 `contentRef/contentStatus/handle`。
2. 删除 Main 内部重复的 ContentRef 和 Status 类型定义。
3. AssetService Map 改为共享 `AssetSnapshot`。
4. 删除 `AssetRuntimeContent` 和 `AssetRuntimeSnapshot`。
5. 更新加载、导入、刷新、Relink、Reveal 和 Workbench 内容解析调用。

### 验证

```bash
pnpm typecheck
pnpm vitest run src/main/content src/main/assets/asset-service.test.ts src/main/assets/asset-file-service.test.ts
```

### 提交

```text
重构：统一 Asset 内容解析与运行时快照
```

## 阶段四：ProjectService 与 IPC

### 修改

- `src/main/projects/project-service.ts`
- `src/main/projects/project-service.test.ts`
- `src/main/ipc/projects.ts`
- `src/main/ipc/projects.test.ts`
- `src/main/ipc/assets.ts`
- `src/main/ipc/assets.test.ts`
- `src/main/ipc/workbench.ts`
- `src/main/ipc/workbench.test.ts`
- `src/main/index.ts`
- `src/preload/index.ts`

### 内容

1. ProjectService 成为所有 Project 用例的唯一入口。
2. 删除 `ProjectOverview` 和 Project IPC 对 ProjectDatabase 的直接依赖。
3. Project/Asset IPC 直接返回共享 Snapshot。
4. 删除 `toProjectSummary()` 和 `toAssetSummary()`。
5. 保持 Workbench → AssetService → ProjectDatabase 的关闭与删除顺序。

### 验证

```bash
pnpm typecheck
pnpm vitest run src/main/projects/project-service.test.ts src/main/ipc/projects.test.ts src/main/ipc/assets.test.ts src/main/ipc/workbench.test.ts
```

### 提交

```text
重构：以 Service 统一 Project 与 Asset IPC
```

## 阶段五：Renderer 与 Workbench

### 修改

- `src/renderer/App.tsx`
- `src/renderer/Home.tsx`
- `src/renderer/ProjectPage.tsx`
- `src/renderer/project-view.ts`
- `src/renderer/project-view.test.ts`
- `src/renderer/asset-view.ts`
- `src/renderer/asset-view.test.ts`
- `src/renderer/components/ProjectActionsMenu.tsx`
- `src/renderer/components/ProjectGrid.tsx`
- `src/renderer/components/ProjectList.tsx`
- `src/renderer/workbench/*`
- `src/workbenches/unsupported/renderer.tsx`
- `src/main/workbench/*`
- 相关测试。

### 内容

1. Renderer 全部改用共享 ProjectSnapshot 和 AssetSnapshot。
2. 日期排序与显示改用毫秒时间戳。
3. `contentLocator` 全部替换为 `contentRef/contentStatus`。
4. Workbench Session 适配扁平 AssetSnapshot 和统一 ResolvedAssetContent。
5. 删除生产代码中的旧 Summary、RuntimeSnapshot 和 Locator 表达。

### 验证

```bash
pnpm check
rg -n "ProjectSummary|ProjectOverview|AssetSummary|AssetRuntimeSnapshot|contentLocator|contentKind|contentPath" src
```

预期 `rg` 只允许命中明确描述旧结构的迁移测试字符串，不允许命中生产代码。

### 提交

```text
界面：切换至共享 Project 与 Asset 快照
```

## 阶段六：真实迁移与打包回归

### 自动验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### Electron 验证

1. 用当前 version 2 开发数据库启动新版应用。
2. 确认 Projects 保留且 Asset 计数归零。
3. 打开 Project，添加多个本地文件。
4. 切换 Asset 并确认 UnsupportedWorkbench 正常。
5. 移动文件、刷新、Relink 并确认状态恢复。
6. 返回 Home，确认 Project 计数和排序正确。

### 文档

- 将设计文档与本计划状态更新为“已实施/已完成”。
- 记录实际测试数量、打包结果和设计差异。

### 提交

```text
文档：记录共享数据契约改造结果
```

## 完成标准

- Project/Asset 从 Database 上层到 Renderer 使用唯一共享类型。
- Project IPC 只依赖 ProjectService。
- version 3 自动保留 Projects 并清空 Assets。
- 旧数据表达从生产代码删除。
- 全量测试、原生模块和打包验证全部通过。
