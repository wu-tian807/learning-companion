# Project 组合式持久化实施计划

> 依据：`docs/superpowers/specs/2026-07-23-project-database-design.md`
>
> 日期：2026-07-23

## 目标

将 Project 改为纯数据快照，以 `ProjectDatabase` 组合内存 Map 和 SQLite/Drizzle，实现启动加载和 CRUD 写穿同步。Source 与 Asset 保持未接入状态。

## 阶段一：数据库基础设施

修改或新增：

- `package.json`
- `pnpm-lock.yaml`
- `src/main/paths/app-paths.ts`
- `src/main/paths/app-paths.test.ts`
- `src/main/database/database-context.ts`
- `src/main/database/initialize-database.ts`
- `src/main/database/initialize-database.test.ts`
- `src/main/database/migrations/0001-create-projects.ts`
- `src/main/database/schema/projects.ts`

步骤：

1. 添加 `drizzle-orm` 运行时依赖。
2. 在 AppPaths 中增加 `dataDirectory` 和 `databaseFile`。
3. 定义同时持有 better-sqlite3 与 Drizzle 的 DatabaseContext。
4. 实现数据库目录创建、连接、PRAGMA 和基于 `user_version` 的静态迁移。
5. 定义 projects Drizzle schema，由 schema 转换时间戳与布尔值。
6. 使用临时数据库验证初始化、幂等迁移、表结构与关闭。
7. 执行 `pnpm check` 和原生模块冒烟测试。
8. 独立提交“功能：初始化 Project SQLite 数据库”。

## 阶段二：纯 Project 与写穿容器

修改或新增：

- `src/main/projects/project.ts`
- `src/main/projects/project.test.ts`
- `src/main/projects/project-database.ts`
- `src/main/projects/project-database.test.ts`

删除：

- `src/main/projects/project-repository.ts`
- `src/main/projects/in-memory-project-repository.ts`
- `src/main/projects/in-memory-project-repository.test.ts`

步骤：

1. 将 Project class 替换为只读接口和纯快照函数。
2. 集中实现名称、图标、日期与 ID 校验。
3. 实现 ProjectDatabase 初始化、list、get、add、update 和 delete。
4. 所有写操作先提交 SQLite，再替换内存 Map。
5. 使用独立 Project 和 Date 快照隔离调用方与内部状态。
6. 覆盖启动加载、CRUD、一致性失败、未知 ID、空更新和重复初始化测试。
7. 执行 `pnpm check`。
8. 独立提交“功能：实现 Project 写穿容器”。

## 阶段三：IPC 与 Main 生命周期

修改：

- `src/main/ipc/projects.ts`
- `src/main/index.ts`
- 相关 IPC 测试

步骤：

1. Project IPC 改为依赖 ProjectDatabase。
2. 在 IPC 层使用纯函数把 Project 转换为 ProjectSummary。
3. 暂时把 `ProjectSummary.sources` 映射为空数组。
4. rename 与 setPinned 请求分别转换为 ProjectDatabase update。
5. Main 在窗口创建前初始化数据库和 ProjectDatabase。
6. 退出时移除 handler 并关闭唯一数据库连接。
7. 删除示例 InMemoryProjectRepository 接线。
8. 执行 `pnpm check`。
9. 独立提交“功能：接入 Project SQLite 持久化”。

## 阶段四：完整验证

步骤：

1. 执行 `pnpm check`。
2. 执行 `pnpm smoke:native`。
3. 执行 `pnpm package`。
4. 执行打包产物原生模块验证。
5. 启动 Electron，创建、重命名、置顶和删除 Project。
6. 重启 Electron，确认 Project 从 SQLite 恢复。
7. 确认 Renderer 仍无法接触数据库或 Node.js。
8. 检查工作区，只暂存本功能涉及文件；不改动 Source 草稿和用户文档。

## 实施约束

- 不创建 `project-row-mapper.ts`。
- 不为 Source 或 Asset 建表。
- 不向 Create Project UI 增加 icon 输入。
- 不在 ProjectDatabase 中实现 UI 排序。
- 不写入示例 Project；首次数据库为空时由首页显示现有空状态。
- 不执行 push，除非用户另行要求。
