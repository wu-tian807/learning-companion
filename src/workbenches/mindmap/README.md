# Mind Map Workbench

Mind Map 是正式的 generated Asset，媒体类型为
`application/vnd.learning-companion.mindmap+json`。content 中的 `nodes` 是唯一的
知识拓扑，必须形成一棵从 `rootNodeId` 出发的严格有序树。

文档还预留独立 `frames`。Frame 通过 `nodeIds` 覆盖一个或多个知识节点，但不是
特殊树节点，也不改变父子关系。它可以作为一次覆盖多个节点的讲义生成范围。

关系通过稀疏的 `associations.nodes` 和 `associations.frames` 保存：

- v2 `references` 使用 `referenceId + sourceRevision + agentLocator` 保存来源与
  Agent 可重新定位的依据；`agentLocator` 是非空、自由结构的 JSON 对象，不要求所有媒体共享
  固定字段；
- v1 文档中的 `referenceId + sourceTarget` 继续可读，但只作为旧格式兼容；
- `linkIds` 对应从节点派生或链接的目标 Asset；
- Asset 级来源和链接本身由通用 `AssetReference`、`AssetLink` 表保存；
- 文档中的失效关系 ID 不阻止整张 Mind Map 打开。

`agentLocator` 面向后续 Agent 获取证据内容，不是 Workbench 可直接 reveal 的
`AttachmentAnchor`，也不注册到通用 AnchorRegistry。生成协议只校验它是可序列化的非空对象，
并在提示词中建议按资料类型填写页码、章节路径、引文、时间范围或内容描述。新生成任务要求每个
Node 和 Frame 至少提供一项来源定位；同一来源的多个位置会按原顺序保留，不按
`referenceId` 去重。

Node 和 Frame 分别提供 `mindmap.node`、`mindmap.frame` Anchor，供 Selection、
Attachment、AI 工具和其他 Workbench 使用。节点折叠、当前选中目标、画布坐标和
缩放属于 Workbench Runtime/State，不写入 content。

当前基础 Workbench 使用 React Flow + Dagre 渲染只读树：支持自动布局、缩放平移、
节点选中、逐层展开、子树收起、视口恢复和 Workbench 专属右键菜单。点击已收起
节点只展开它的直接下一层；内联按钮只在节点展开时出现，并且只负责收起。选中节点会发布
`mindmap.node` Interaction；折叠节点与视口保存到版本化 `workbench_state`，当前选中
状态只留在 Runtime。尚无 State 的 Mind Map 第一次打开时，所有含有子节点的节点
默认收起；之后恢复用户最后保存的展开状态。Frame 数据已经进入协议和 Bootstrap，
但框选范围的视觉渲染及生成流程仍在后续实现。

文件边界：

- `document.ts` 定义并校验 `.mindmap`；
- `mindmap-content-adapter.ts` 通过通用 `ContentHandle` 读写 UTF-8 JSON 和 Revision；
- `main.ts` 读取文档、解析通用关系并维护 Workbench State；
- `layout.ts` 将可见树交给 Dagre 计算 Renderer 坐标；
- `renderer.tsx` 提供 React Flow 画布与 Interaction；
- `shared.ts` 保存 Manifest、Bootstrap/Command、State 与 Anchor 协议；
- Adapter 不拥有 Handle 生命周期，不存在 Mind Map 专用 `HandleManager`。

当前新任务使用 `mindmap.generate@2` 和 `.mindmap` v2。`mindmap.generate@1` 与
`.mindmap` v1 仍注册/可读，专用于恢复升级前尚未完成的任务和打开旧文件。
