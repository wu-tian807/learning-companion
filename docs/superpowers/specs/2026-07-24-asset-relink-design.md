# Asset Relink 后端设计

> 日期：2026-07-24
>
> 状态：后端接口已实施

## 目标

为 AssetDatabase 增加可用的 Main 层 Relink 能力，使本地文件移动或重命名后，现有 Asset 可以安全指向新路径。

Relink 只表示“同一类型学习资料的重新定位”，不表示用完全不同的内容替换 Asset。

本阶段实现后端方法，但不接入 IPC、Preload、文件选择器或 Renderer。

## API

```ts
export interface AssetDatabaseApi {
  // 现有接口……
  relink(assetId: string, newPath: string): Promise<Asset>;
}
```

`UpdateAssetInput` 继续只允许修改：

- `name`
- `lastUsedTime`

不把 `path` 加入普通 update，避免调用方绕过文件检查和媒体兼容性规则。

## 不变字段

Relink 成功后保持以下字段不变：

- `id`
- `projectId`
- `name`
- `mediaType`
- `createdTime`
- `lastUsedTime`

只允许变化：

- `contentLocator.path`
- `contentLocator.availability`
- `contentLocator.checkedTime`

Asset 名称始终保持原样。即使新文件名不同，也不自动重命名，因为名称可能已经由用户编辑。

## Relink 流程

```text
relink(assetId, newPath)
  -> 要求已加载 Project
  -> 找到当前 Project 中的 Asset
  -> 记录当前 Project 生命周期版本
  -> LocalFileLocatorChecker 检查并规范化 newPath
  -> 确认检查期间 Project 未切换或卸载
  -> 如果规范化路径相同，只刷新内存 Locator 并返回
  -> 文件必须 available
  -> 验证媒体类型兼容
  -> SQLite 只更新 content_path
  -> 检查影响行数为 1
  -> 创建完整的新 Asset 快照
  -> 替换当前 Map 中的 Asset
  -> 返回克隆快照
```

异步文件检查结束后，必须复用现有 AssetDatabase 生命周期保护。如果 Project 已切换或卸载，Relink 失败，不写 SQLite，也不修改内存 Map。

## 媒体兼容性

Relink 会从新路径临时推导 MIME，但不会修改 Asset 中已保存的 `mediaType`。

### 已知 MIME

如果旧 Asset 的 `mediaType` 不是 `application/octet-stream`：

```text
detectAssetMediaType(newPath) === asset.mediaType
```

才允许 Relink。

示例：

```text
旧：/old/book.pdf -> application/pdf
新：/new/book.PDF -> application/pdf
结果：允许
```

```text
旧：/old/book.pdf -> application/pdf
新：/new/notes.md -> text/markdown
结果：拒绝
```

### 未知 MIME

未知或暂不支持的扩展名统一存储为 `application/octet-stream`，因此不能只比较 MIME。

当旧 Asset 的 MIME 为 `application/octet-stream` 时，新旧路径的最后一个后缀必须相同，比较时忽略大小写：

```text
.docx -> .DOCX：允许
.docx -> .xlsx：拒绝
无后缀 -> 无后缀：允许
无后缀 -> .bin：拒绝
```

Relink 不验证文件内容指纹，因此不能从技术上证明新旧文件内容相同。首版把用户主动选择新路径视为重新定位意图，媒体兼容检查只防止明显的跨类型替换。

## 相同路径

如果 Checker 规范化后的新路径与旧 `contentLocator.path` 完全相同：

- 不执行 SQLite UPDATE。
- 使用检查结果刷新内存 Locator。
- 允许结果为 `available`、`missing`、`inaccessible` 或 `invalid`。
- 行为等价于 `refreshAvailability()`。

路径相等使用规范化后的字符串比较，不在本阶段解析真实路径、符号链接身份或 Windows 大小写等价关系。

## 新路径不可用

如果新路径与旧路径不同，则新 Locator 必须为 `available`。

以下状态均拒绝 Relink：

- `missing`
- `inaccessible`
- `invalid`

失败时保留旧数据库路径、旧 MIME、旧 Locator 和所有内存状态。

## SQLite 写穿

Relink 不需要数据库迁移。现有 `assets.content_path` 已满足持久化要求。

更新条件同时限制 Asset 和当前 Project：

```sql
UPDATE assets
SET content_path = ?
WHERE id = ?
  AND project_id = ?;
```

只有影响一行才算成功。SQLite 成功后才替换内存 Map。

不更新：

- `name`
- `media_type`
- `content_kind`
- `created_time`
- `last_used_time`

同一物理路径仍然允许被多个 Asset 引用，`content_path` 不增加唯一约束。

## 与未来运行时资源的关系

当前没有 LoadedAssetPool，因此 Relink 只更新轻量 Asset 快照。

未来引入 PDF.js、Markdown AST、EPUB 实例或全文索引后，Relink 成功事件必须使旧路径对应的运行时资源和索引失效。该行为不属于本阶段。

## Replace Content

跨媒体类型替换不属于 Relink：

```text
PDF Asset -> Markdown 文件
```

未来如有需求，应建立独立 `replaceContent()` 设计，并明确处理：

- 阅读进度清理。
- 来源锚点失效。
- 笔记引用迁移。
- 全文索引重建。
- 媒体特有数据删除或转换。

本阶段不预留 `replaceContent()` 接口。

## 错误边界

需要区分：

- AssetDatabase 尚未加载 Project。
- 当前 Project 中不存在 Asset。
- 新路径为空或不是绝对路径。
- 异步检查期间 Project 已变化。
- 新路径不可用。
- 新旧媒体类型不兼容。
- SQLite 更新失败或影响行数不为 1。

任何失败都不得部分修改数据库或内存 Map。

## 测试范围

- 已知 MIME 相同的路径 Relink 成功。
- 已知 MIME 不同的路径被拒绝。
- 未知 MIME 的相同后缀忽略大小写后成功。
- 未知 MIME 的不同后缀被拒绝。
- 无后缀到无后缀允许，无后缀到有后缀拒绝。
- Relink 不修改名称、MIME、ID、Project ID 和时间。
- 新路径不可用时旧数据库和旧 Map 保持不变。
- SQLite 写入失败时旧 Map 保持不变。
- 相同规范化路径不写数据库，只刷新 Locator。
- 检查期间卸载或切换 Project 时不写入旧结果。
- Relink 只操作当前 Project 中的 Asset。
- 返回值不暴露 Asset、Locator 或 Date 引用。

## 本阶段明确不做

- Asset Relink IPC。
- 文件选择器。
- Renderer 更新或提示界面。
- 自动搜索移动后的文件。
- 文件指纹或内容一致性校验。
- 自动修改 Asset 名称。
- 修改持久化 mediaType。
- LoadedAssetPool 和索引失效。
- Replace Content。
