# ProjectLookup 依赖简化设计

> 日期：2026-07-24
>
> 状态：待用户复核

## 目标

移除 `AssetDatabase.loadProject()` 对 `projects` 表的重复查询，统一通过已初始化的 `ProjectDatabase` 内存 Map 判断 Project 是否存在。

## 设计

新增最小只读接口：

```ts
export interface ProjectLookup {
  get(id: string): Project | undefined;
}
```

`ProjectDatabaseApi` 继承 `ProjectLookup`，现有 `ProjectDatabase.get()` 即为接口实现，不新增 Lookup 类或额外 Map。

`AssetDatabase` 构造函数注入 `ProjectLookup`：

```ts
new AssetDatabase(databaseContext, projectDatabase, dependencies)
```

`loadProject()` 的职责调整为：

1. 规范化 Project ID。
2. 通过 `projectLookup.get()` 从 Project 内存 Map 验证 Project。
3. 直接从 `assets` 表查询该 Project 的 Asset。
4. 检查 Locator 并原子替换当前 Asset Map。

## 初始化顺序

应用启动时必须先初始化 Project 容器，再构造或使用 Asset 容器：

```text
ProjectDatabase.initialize()
  -> Project 全量进入 projectMap
  -> AssetDatabase 使用 ProjectDatabase 作为 ProjectLookup
```

如果 ProjectDatabase 尚未初始化，`get()` 保持现有行为并抛出初始化错误，不回退到直接查询 SQLite。

## 测试调整

- AssetDatabase 测试使用真实且已初始化的 `ProjectDatabase`。
- 保留未知 Project 拒绝测试。
- 增加断言，证明 ProjectLookup 是 Project 存在性的入口。
- 现有 Asset 加载、生命周期和 Relink 行为保持不变。

## 明确不做

- 不新增 ProjectLookup 实现类。
- 不在 AssetDatabase 查询 `projects` 表。
- 不修改数据库表或迁移。
- 不处理删除当前 Project 时的跨容器协调；该行为由后续 Workspace 协调器设计负责。
