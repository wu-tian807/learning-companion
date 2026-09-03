# Mind Map Agent Locator 数据结构设计

日期：2026-08-31
状态：历史设计归档；当前运行时只保留 v3 AssetTarget 方案

## 0. 2026-09-02 更新：统一为 AssetTarget

本文第 1～5 节记录的是 `.mindmap` v2 `agentLocator` 方案及其当时的设计边界，
仅用于保留设计演进记录，不再代表可读取或可恢复的运行时协议。

当前实现使用 `mindmap.generate@3` 和 `.mindmap` v3：

- 每个 Node 和 Frame 的来源绑定保存
  `referenceId + sourceRevision + target`；
- `target` 统一使用通用 `AssetTarget`，不再为 Mind Map 单独维护自由格式的
  `agentLocator`；
- 各来源 Workbench 自己注册 Target 类型、Agent 描述、payload schema、示例、
  权威校验器和可读描述；
- Mind Map 生成只收集本次所选来源对应的 Target 目录，不包含 PDF、视频、EPUB
  等媒体分支；
- Agent 生成的 Target 必须属于该来源实际选中的 Workbench，并通过其 payload
  校验；无法可靠定位内容时可使用 `{ "scope": "asset" }`；
- 运行时只注册 `mindmap.generate@3`，Content Adapter 只读取 `.mindmap` v3；
  v1/v2 版号不再提供兼容、迁移或任务恢复路线。

以下历史设计中的“本次不做”均指 v2 实现当时的范围。

## 1. 目标

Mind Map 是后续学习大纲和讲义生成可以引用的独立资料。每个 Node 和 Frame 除了知道来源
Asset，还需要保存足够的信息，让未来 Agent 能再次进入该资料并找到支撑当前主题的内容。

这里的定位信息服务于 Agent 检索和阅读，不承诺当前 Workbench 能把它直接转换成 UI 跳转。

## 2. 与 Attachment Anchor 的边界

Attachment Anchor 使用已注册的 `AssetTarget`，承担类型校验、版本化和 Workbench reveal 等
应用交互语义。Mind Map 的来源定位可能覆盖 PDF 页码、标题路径、音视频时间段、原文片段、
图片区域或未来尚未出现的资料格式，如果强行复用 `AssetTarget`，就会让通用 AnchorRegistry
承担 Agent 私有检索提示的协议。

因此二者保持独立：

- `AttachmentAnchor`：应用和 Workbench 可解释、可 reveal 的强类型交互定位；
- `agentLocator`：未来 Agent 可解释的来源内定位，不进入 AnchorRegistry；
- `AssetReference`：两者都可依赖的 Asset 级来源关系。

## 3. `.mindmap` v2

v2 的来源绑定为：

```ts
interface MindMapReferenceBindingV2 {
  referenceId: string;
  sourceRevision: string;
  agentLocator: Record<string, JsonValue>;
}
```

`agentLocator` 只具有三项结构约束：

1. 必须是 JSON 对象；
2. 必须至少包含一个字段；
3. 所有值必须可安全序列化为 JSON。

应用不维护媒体字段枚举。生成 Agent 可以使用 `page`、`headingPath`、`quote`、
`startTimeMs`、`region`、`description` 或自定义组合。提示词要求优先使用稳定结构位置并附带
可辨认的引文或描述，但这些是生成质量规范，不是存储层硬编码。

`sourceRevision` 记录生成时 Agent 实际读取的来源快照。后续消费者可以据此识别来源已经变化，
而不是把旧定位无条件解释到新内容上。

同一个 Node 或 Frame 可以对同一个 `referenceId` 保存多个 `agentLocator`。这些位置具有独立
语义并保留原顺序，不能按来源 ID 去重。

## 4. 生成协议与兼容性

当时的新生成协议为 `mindmap.generate@2`：

- candidate v2 把 `sourceAliases` 改为 `sourceReferences`；
- 每个 Node 和 Frame 至少包含一个 `sourceAlias + agentLocator`；
- alias 必须来自本次任务明确选择的资料；
- 提交时 alias 被映射为 `referenceId + sourceRevision`，Agent 不能自行编造数据库 ID；
- 生成的新文件使用 `.mindmap` v2。

该阶段曾同时注册 `mindmap.generate@1` 并读取 `.mindmap` v1/v2。由于项目当前没有需要
保留的旧 Mind Map 数据，这些兼容分支现已移除；当前实现只接受 v3。

## 5. 本次不做

- 不把 `agentLocator` 接入 Attachment Anchor 或通用 reveal；
- 不为不同媒体建立固定 locator schema；
- 不实现学习大纲或讲义生成；
- 不让 Host 层解释 Mind Map 的来源定位；
- 不自动迁移或重写旧 `.mindmap` 文件。
