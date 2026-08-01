# Mind Map Workbench

Mind Map 是正式的 generated Asset，媒体类型为
`application/vnd.learning-companion.mindmap+json`。

文档保存完整、规范化的节点树，并通过 `nodeAssociations` 保存节点级绑定：

- `references` 使用 `referenceId + sourceTarget` 对应节点引用的来源位置；
- `linkIds` 对应从节点派生或链接的目标 Asset；
- Asset 级来源和链接本身由通用 `AssetReference`、`AssetLink` 表保存；
- 文档中的失效关系 ID 不阻止整张 Mind Map 打开。

节点还提供 `mindmap.node` Anchor，供 Selection、Attachment、AI 工具和其他
Workbench 使用。节点正文扩展、生成流程和 Renderer 交互将在后续阶段实现。
