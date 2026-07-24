# ProjectLookup 依赖简化实施计划

> 依据：`docs/superpowers/specs/2026-07-24-project-lookup-design.md`
>
> 日期：2026-07-24

## 目标

让 `AssetDatabase` 通过 `ProjectDatabase` 的内存 Map 验证 Project，移除对 `projects` 表的重复访问，并将 Asset 加载入口重命名为 `loadFromProject()`。

## 实施步骤

1. 定义最小 `ProjectLookup` 接口，并让 `ProjectDatabaseApi` 继承它。
2. 向 `AssetDatabase` 注入 `ProjectLookup`。
3. 删除 `AssetDatabase` 对 `projects` schema 的导入和查询。
4. 将 `loadProject()` 重命名为 `loadFromProject()`，保留 `unloadProject()`。
5. 调整测试，使每个 AssetDatabase 复用已初始化的真实 ProjectDatabase。
6. 覆盖未初始化 ProjectLookup、未知 Project 和内存 Map 查询边界。
7. 运行完整检查、原生模块验证和 Electron 打包。

## 约束

- 不新增 ProjectLookup 实现类或额外 Map。
- 不修改 SQLite schema 和迁移。
- 不接入 Asset IPC 或 Renderer。
- 不实现跨容器删除协调器。
- 不修改用户的 `AGENTS.md` 和教程草稿。
- 不执行 push，除非用户另行要求。
