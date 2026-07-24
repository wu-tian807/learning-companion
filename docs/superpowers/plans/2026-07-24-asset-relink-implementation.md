# Asset Relink 后端实施计划

> 依据：`docs/superpowers/specs/2026-07-24-asset-relink-design.md`
>
> 日期：2026-07-24

## 目标

在不接入 IPC 和 Renderer 的前提下，为当前 Project 的 `AssetDatabase` 增加安全的本地文件 Relink 能力，并保持 Asset 的身份、名称、媒体类型和时间字段不变。

## 阶段一：媒体兼容判断

修改：

- `src/main/assets/asset-media-type.ts`
- `src/main/assets/asset-media-type.test.ts`

步骤：

1. 新增 Relink 媒体兼容判断函数。
2. 已知 MIME 使用新路径重新推导后精确比较。
3. 未知 MIME 使用新旧路径最后一个后缀比较，忽略大小写。
4. 覆盖已知类型、未知类型和无后缀文件的兼容边界。

## 阶段二：AssetDatabase Relink

修改：

- `src/main/assets/asset-database.ts`
- `src/main/assets/asset-database.test.ts`

步骤：

1. 在 `AssetDatabaseApi` 增加异步 `relink(assetId, newPath)`。
2. 使用 Locator Checker 校验并规范化新路径。
3. 复用 Project 生命周期版本，阻止异步检查结果写入已卸载或切换的 Project。
4. 相同规范化路径只刷新内存 Locator，不写 SQLite。
5. 不同路径要求文件可用且媒体类型兼容。
6. SQLite 只更新当前 Project 所属 Asset 的 `content_path`，成功后再替换内存快照。
7. 验证返回值为深克隆，且失败时数据库与内存保持旧值。

## 阶段三：完整验证

步骤：

1. 执行 Asset 定向测试、类型检查和 lint。
2. 执行完整 `pnpm check`。
3. 执行 `pnpm smoke:native`。
4. 执行 `pnpm package`。
5. 执行 `pnpm verify:package:native`。
6. 检查工作区，只提交 Relink 实现和相关文档。

## 实施约束

- 不把 `path` 加入 `UpdateAssetInput`。
- 不修改持久化的 `mediaType`。
- 不增加数据库迁移或路径唯一约束。
- 不实现内容指纹、真实路径或符号链接身份判断。
- 不实现 `replaceContent()`。
- 不接入 IPC、Preload、文件选择器或 Renderer。
- 不修改用户的 `AGENTS.md` 和教程草稿。
- 不执行 push，除非用户另行要求。
