# Asset 聚合关系变化与更新时间设计

> 状态：已确认并实现
>
> 日期：2026-08-30

## 1. 问题

Asset 的 `updatedTime` 表示 Asset 聚合最近一次持久化变化。正文、名称和
Attachment 已经存在更新时间路径，但 Attachment 依赖 Bootstrap 中的一条专用订阅，
`AssetReference` 与 `AssetLink` 则完全不会推进 owner Asset。新增 Workbench 因而可能
正确保存关系，却仍在 Project 列表中显示旧时间。

让各 Workbench 在创建 Attachment、Reference 或 Link 后手动更新时间会复制领域规则，
并使失败、幂等和删除行为逐渐分叉。

## 2. 目标与非目标

目标：

- Attachment、AssetReference 和 AssetLink 的真实变化自动推进 owner Asset；
- Workbench 与 Generation Processor 只调用原领域 Service，不感知 Asset 时间；
- 活动 Project 立即收到 authoritative `AssetChanged`，非活动 Project 也更新数据库；
- 幂等 `ensure`、不存在的删除和查询不更新时间；
- 关系另一端不因入边变化而被误判为自身内容变化。

本轮不包含：

- Project 更新时间；
- Artifact、Workbench State、打开、阅读或选择导致的时间变化；
- 为关系实体增加 `updatedTime` 或数据库迁移；
- 把 Attachment、Reference 和 Link 合并成同一种持久化实体。

## 3. 聚合所有权语义

| 变化 | 推进的 Asset | 不推进的 Asset |
| --- | --- | --- |
| Attachment 创建、更新、删除 | `attachment.assetId` | 无 |
| AssetReference 创建、删除 | `reference.assetId` | `sourceAssetId` |
| AssetLink 创建、删除 | `link.assetId` | `targetAssetId` |
| source/target Asset 删除导致关系级联删除 | 仍存活的 owner Asset | 被删除 Asset |
| owner Asset 删除导致关系级联删除 | 无 | 关系另一端 |

Attachment 是 owner Asset 的组成部分；Reference 和 Link 是 owner Asset 主动保存的出边。
入边变化不表示来源或目标 Asset 自身发生变化。

## 4. 统一变化协议

三个领域 Service 保持原有 CRUD 与幂等语义，同时以 Main 内部协议发布已提交变化：

```ts
interface AssetAggregateMutation {
  readonly projectId: string;
  readonly assetId: string;
  readonly updatedTime: number;
}

interface AssetAggregateMutationSource {
  subscribeAssetMutations(listener): () => void;
}
```

`AttachmentService` 把既有 changed/deleted 事件映射为该协议；
`AssetAssociationService` 只在真实创建或删除后发布，重复 `ensureReference()`、
`ensureLink()` 和不存在的 delete 不发布。

Bootstrap 通过 `trackAssetAggregateMutations()` 一次连接所有 mutation source 与
`AssetService.touch()`：

```text
Workbench / Processor
  -> AttachmentService / AssetAssociationService
  -> 领域写入成功
  -> AssetAggregateMutation
  -> AssetService.touch(projectId, ownerAssetId, updatedTime)
  -> assets.updated_time + Runtime Snapshot + AssetChanged
  -> Renderer 列表更新时间和排序
```

连接层只做协议适配和错误隔离，不保存状态、不解释媒体类型，也不成为另一套 Asset
修改入口。应用 Runtime 释放时统一取消订阅。

## 5. 删除、幂等与失败

- 显式删除关系成功后推进 owner；删除未知 ID 是空操作。
- 删除 source/target Asset 时，SQLite 先级联删除关系，Association Service 再清理
  内存索引，并为仍存活的 owner 发布一次变化。
- 删除 owner Asset 时不触碰来源或目标，也不为即将消失的 owner 制造关系更新时间。
- 领域写入一旦成功，不因更新时间投影失败而向调用方误报失败；连接层记录包含
  Project、Asset 和时间的错误。后续成功变化仍可继续推进时间。
- 订阅器建立中途失败时撤销此前已经建立的订阅，dispose 可重复调用。

更新时间是聚合的辅助投影，并不替代 Attachment/Association 自身的数据库事实。

## 6. 验收矩阵

| 行为 | 正常路径 | 边界/失败 |
| --- | --- | --- |
| Attachment | create/update/delete 推进 owner | missing Asset 不写入；订阅失败不回滚产物 |
| Reference | 首次 ensure、delete 推进 owner | 重复 ensure、重复 delete、跨 Project、自引用不推进 |
| Link | 首次 ensure、delete 推进 owner | 重复 ensure、重复 delete、跨 Project、自链接不推进 |
| 级联删除 | source/target 删除推进存活 owner | owner 删除不推进另一端 |
| 组合层 | 多 mutation source 使用同一 touch port | 部分订阅建立失败回滚；dispose 幂等 |
| Asset 投影 | 活动 Asset 发布完整 Snapshot | 非活动 Asset 只更新数据库；旧时间不倒退 |
