# Asset 统一更新入口与更新时间实施计划

> 依据：`docs/superpowers/specs/2026-08-01-asset-updated-time-design.md`
>
> 日期：2026-08-01

## 实施原则

- `AssetService.update()` 是已有 Asset 持久化字段的唯一领域更新入口。
- `AssetDatabase` 只处理规范化纯数据，不解释业务时间。
- Workbench 和 LocalFile Resolver 不直接依赖 AssetService。
- 正文写入成功但时间同步失败时，正文保存仍然成功。
- Renderer 只消费 Main 发布的完整 Asset Snapshot，不复制领域 Patch 逻辑。
- 不实现 Attachment CRUD 和文件系统常驻 Watcher。
- 每个阶段测试通过后独立提交。
- 不暂存用户的 `AGENTS.md` 与 `tsx教程.md`。

## 阶段一：字段迁移与数据库更新边界

### 修改或新增

- `src/shared/assets.ts`
- `src/main/assets/asset.ts`
- `src/main/assets/asset-database.ts`
- `src/main/database/schema/assets.ts`
- `src/main/database/migrations/0009-rename-asset-updated-time.ts`
- `src/main/database/initialize-database.ts`
- 所有受影响的测试 Fixture 和数据库测试

### 步骤

1. 把共享 Asset、Main Asset Input 和 Clone/Guard 的 `lastUsedTime` 全量重命名为
   `updatedTime`。
2. 新增版本 9 数据库迁移，把 `last_used_time` 原位重命名为 `updated_time`。
3. 更新 Drizzle Schema 和 Row Mapper。
4. 定义领域 `UpdateAssetInput`、`AssetUpdateTiming` 与持久化
   `PersistAssetUpdateInput`。
5. 让 `AssetDatabase.update()` 支持名称、ContentRef 和规范化的更新时间。
6. 删除 `AssetDatabase.updateContentRef()`。
7. 测试旧数据库升级、Fresh Database、数值保留和通用字段更新。
8. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
数据库：迁移 Asset 更新时间字段
```

## 阶段二：AssetService 统一更新流水线

### 修改

- `src/main/assets/asset-service.ts`
- `src/main/assets/asset-service.test.ts`
- 必要的 IPC 与 Project Service 测试 Fixture

### 步骤

1. 为 AssetService 注入 `now`。
2. 实现名称、ContentRef 和时间候选的比较与规范化。
3. 保证更新时间单调，并截断未来的观察时间。
4. 只在持久化字段实际变化时调用数据库。
5. 支持 Relink 把新 `contentStatus` 和 ContentRef 一次性提交到 Runtime Map。
6. 重命名和 Relink 调用统一 Update，不显式传当前时间。
7. 使用不可变 Snapshot 身份保护异步 Refresh/Relink 结果，避免覆盖并发更新。
8. 覆盖空操作、数据库失败、Project 切换和过期异步结果测试。
9. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
重构：统一 Asset 更新流水线
```

## 阶段三：文件时间与正文写入跟踪

### 新增

- `src/main/content/tracked-content-handle.ts`
- `src/main/content/tracked-content-handle.test.ts`

### 修改

- `src/main/content/resolvers/local-file/local-file-content-inspector.ts`
- `src/main/content/resolvers/local-file/local-file-content-inspector.test.ts`
- `src/main/content/content-ref.ts`
- `src/main/assets/asset-service.ts`
- 对应 AssetService、Resolver 和 Workbench 测试

### 步骤

1. Local File Inspection 在 Available 时返回 `Stats.mtimeMs`。
2. 把文件观察时间沿 Resolved Content 的 Main-only 契约传给 AssetService。
3. 加载、刷新、刷新全部和内容解析使用 `observed` 模式做最佳努力同步。
4. 实现通用 TrackedContentHandle，透明转发全部能力和关闭行为。
5. AssetService.resolveContent 为可写 Handle 注入 `onDidWrite` 回调。
6. 正文写入成功后使用 `now` 模式更新时间。
7. 时间同步失败只记录警告，不改变正文写入成功结果。
8. 测试 mtime、能力转发、一次回报、失败隔离和外部时间修复。
9. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
功能：自动跟踪 Asset 内容更新时间
```

## 阶段四：AssetChanged 主动投影

### 新增

- `src/preload/asset-events.ts`
- `src/preload/asset-events.test.ts`

### 修改

- `src/shared/assets.ts`
- `src/shared/ipc.ts`
- `src/main/assets/asset-service.ts`
- `src/main/ipc/assets.ts`
- `src/main/bootstrap/register-application-ipc.ts`
- `src/preload/index.ts`
- `src/renderer/project/use-project-assets.ts`
- 对应 Main IPC、Preload 和 Renderer 测试

### 步骤

1. 定义并校验带 Project ID 和完整 Snapshot 的 AssetChangedEvent。
2. AssetService 提供进程内 Subscribe，并在 Snapshot 成功提交后发布。
3. Main IPC 把事件发送到现有应用窗口，并在卸载时取消订阅。
4. Preload 暴露白名单 `onAssetChanged`，过滤非法事件并支持 Dispose。
5. Project Asset Hook 在读取前订阅事件，忽略其他 Project，并按 ID 幂等替换。
6. 确保 `updatedTime` 不进入 Workbench 身份 Key，不触发编辑器重开。
7. 测试订阅清理、错误隔离、Project 过滤、排序更新和 Workbench 稳定性。
8. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
功能：同步 Asset 更新到 Renderer
```

## 阶段五：文档与完整回归

### 修改

- `TECH_STACK.md`
- 必要的测试和实现细节

### 步骤

1. 更新 Asset 数据结构、相对时间排序、单一更新入口、mtime 和事件投影说明。
2. 确认仓库中除历史迁移外不存在 `lastUsedTime` 或 `last_used_time`。
3. 执行 `pnpm check`。
4. 执行 `pnpm package`。
5. 检查数据库迁移、Plain Text/Markdown 保存、重命名、Relink 和外部修改路径。
6. 修复回归后重新执行相关测试和完整检查。

### 提交

```text
文档：更新 Asset 更新时间架构
```

## 最终交付约束

- 不执行 push，除非用户另行要求。
- 不实现 Attachment 持久化，只保留已确认的装饰器接入边界。
- 不增加第二个最近使用时间字段。
- 不让 Renderer、Workbench Provider 或 Resolver 直接修改 Asset 元数据。
- 不把用户的未跟踪文件纳入提交。
