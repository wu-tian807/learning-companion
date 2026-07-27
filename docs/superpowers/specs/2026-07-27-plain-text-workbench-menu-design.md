# Plain Text Workbench 菜单与格式控制设计

## 目标

将资料工作台标题栏中的三个点从禁用占位符改造成真正的 Workbench 扩展入口，并为 Plain Text Workbench 实装首批编辑选项：

- 自动换行；
- 显示行号；
- LF / CRLF 行尾序列；
- 使用 UTF-8 / GBK 编码重新打开文件。

这次改动同时验证 Renderer Workbench 的标题栏扩展能力。未来 PDF、Markdown、思维导图等 Workbench 可以注入自己的操作入口，而 `AssetWorkbenchHost` 不需要理解任何媒体类型的内部功能。

## 非目标

- 不实现“保存为指定编码”。
- 不增加 UTF-8 和 GBK 之外的新编码。
- 不建设通用的 JSON 菜单描述协议。
- 不把 Asset 的删除、重新定位、在文件夹中显示等通用操作复制到 Workbench 菜单。
- 不引入新的菜单组件依赖。

## 参考行为与简化

VS Code 将自动换行作为编辑器显示配置，将行尾序列作为文件格式修改，并将编码操作区分为“使用编码重新打开”和“使用编码保存”。

本项目首版采用更简单的单一“当前编码”模型：

1. 用户选择 UTF-8 或 GBK；
2. 主进程使用该编码重新读取磁盘文件；
3. 重新读取成功后，该编码成为当前编辑会话的编码；
4. 后续保存继续使用当前编码。

这项操作用于按照指定编码解释磁盘字节，不承担文件编码转换功能。

## 方案选择

### 方案 A：宿主写死菜单

直接在 `AssetWorkbenchHost` 中判断 Plain Text Workbench 并渲染菜单。

优点是实现最少；缺点是宿主会逐渐依赖 UTF-8、CRLF、PDF 旋转等类型细节，破坏 Workbench 隔离。

### 方案 B：Renderer 注入标题栏插槽

`AssetWorkbenchHost` 提供通用的 Header Actions 挂载点，具体 Renderer 通过 React Portal 注入自己的按钮和菜单。

优点：

- 菜单与编辑器共享同一个 Renderer 状态；
- 宿主不理解类型特化命令；
- 没有操作的 Workbench 不显示三个点；
- 新 Workbench 可以注入完全不同的标题栏操作。

缺点是 Renderer Props 会增加一个仅用于 React DOM 的挂载目标。

### 方案 C：Manifest 声明菜单

在 Workbench Manifest 中用 JSON 描述菜单、选项和命令。

这种方式适合成熟的第三方插件平台，但会过早固定不同 Workbench 的交互能力，也不适合复杂弹窗和动态状态。

### 决策

采用方案 B。

## Renderer 扩展结构

`AssetWorkbenchHost` 在媒体类型标签后提供一个空的 Header Actions 容器，并通过 `RendererWorkbenchViewProps` 将容器传给当前 Renderer。

```text
AssetWorkbenchHost
├── 标题
├── Media Type
├── Header Actions Target
│   └── PlainTextWorkbenchMenu（Portal）
└── Renderer Workbench View
    └── CodeMirror
```

约束：

- 宿主不再渲染禁用的三个点占位符。
- Header Actions Target 为空时不占用额外宽度。
- Plain Text Renderer 自己决定是否渲染三个点。
- 菜单使用现有应用的圆角、暗色、悬浮和焦点样式。
- 菜单支持点击外部关闭、Escape 关闭以及正确的 ARIA menu 属性。

## Plain Text 菜单

首版菜单结构：

```text
✓ 自动换行
✓ 显示行号
────────────
行尾序列
  ○ LF
  ● CRLF
────────────
使用编码打开
  ○ UTF-8
  ○ GBK
```

菜单不提供保存按钮。保存仍然是编辑器工具栏中的显式主操作。

### 自动换行

- 通过 CodeMirror `EditorView.lineWrapping` Extension 控制。
- 切换后立即重配置编辑器，不修改文件。
- 默认开启。

### 显示行号

- 控制 CodeMirror 的 line numbers Extension。
- 切换后立即重配置编辑器，不修改文件。
- 默认开启。

### 行尾序列

- 支持 `lf` 和 `crlf`。
- 切换只修改当前 Workbench Runtime，不立即写文件。
- 当前行尾序列与磁盘基线不一致时，编辑器进入未保存状态。
- 下次保存时按当前行尾序列重新编码并原子写入。
- 保存成功后，当前值成为新的磁盘基线。

### 使用编码打开

- 支持 `utf-8` 和 `gbk`。
- 仅在编辑会话处于干净状态时允许选择。
- 当前正文、行尾序列或恢复内容存在未保存修改时，选项禁用，并显示“请先保存或放弃当前修改”。
- 选择后由主进程重新读取文件，不使用 Renderer 中已有的字符串转换。
- 成功后替换正文、编码、行尾序列、BOM、revision 和保存基线。
- 编辑器重新挂载以清空旧文件内容对应的撤销历史。
- 尽量保留光标和滚动位置，并将超出新内容长度的位置安全收缩。
- 解码失败时保持原编辑器状态不变。

## 状态模型

### 磁盘基线

Plain Text Runtime 保留最近一次读取或保存成功的 `ResolvedTextContent`：

- `content`
- `encoding`
- `lineEnding`
- `hasByteOrderMark`
- `revision`

### 当前编辑状态

Runtime 额外维护：

- `bufferContent`
- `currentLineEnding`
- `viewState`
- `viewOptions`
- `recovery`

未保存状态定义为：

```text
bufferContent !== source.content
或
currentLineEnding !== source.lineEnding
```

编码重新打开只允许在未保存状态为 false 时执行，因此不需要把 encoding 作为额外的 dirty 条件。

### View Options

Plain Text Workbench State 升级为 V2：

```ts
interface PlainTextViewOptions {
  wordWrap: boolean;
  lineNumbers: boolean;
}

interface PlainTextWorkbenchStateV2 {
  viewState?: PlainTextViewState;
  viewOptions: PlainTextViewOptions;
  recovery?: PlainTextRecoveryState;
}
```

显示选项按 Asset 持久化在现有 `workbench_states` 中。这与光标、滚动位置一样属于该 Asset 的 Workbench 状态，不进入全局 `settings.json`。

读取 V1 状态时执行内存迁移：

- 保留旧 `viewState` 和 `recovery`；
- 补入默认 `wordWrap: true`；
- 补入默认 `lineNumbers: true`；
- 下一次状态写入时保存为 V2。

不增加数据库迁移。

### Recovery

格式修改也必须进入恢复逻辑。

- 即使正文与磁盘完全相同，只要 `currentLineEnding` 不同，也需要创建恢复状态。
- Recovery metadata 记录当前行尾序列。
- 重新打开时，只有正文和行尾序列都与磁盘基线一致，才能自动清理 Recovery。
- 恢复草稿时同时恢复正文和行尾序列。
- Recovery 弹窗显示期间禁用标题栏菜单。

## Workbench 命令

新增命令：

```text
plain-text:set-view-options
plain-text:set-line-ending
plain-text:reopen-with-encoding
```

### set-view-options

请求：

```ts
{
  wordWrap: boolean;
  lineNumbers: boolean;
}
```

主进程验证后写入 Plain Text Workbench State，并返回最终值。

### set-line-ending

请求：

```ts
{
  lineEnding: "lf" | "crlf";
}
```

主进程更新 Runtime，必要时安排恢复快照，并返回当前行尾序列与 dirty 状态。

### reopen-with-encoding

请求：

```ts
{
  encoding: "utf-8" | "gbk";
}
```

处理顺序：

1. Main Provider 再次检查 Runtime 是否干净；
2. Content Handle 使用指定编码读取当前磁盘字节；
3. 严格解码并生成新的 revision；
4. 更新 Runtime 磁盘基线和当前状态；
5. 返回完整的 Plain Text Source Snapshot。

Renderer 只有在成功响应后才替换现有编辑器内容。

## Content Handle 调整

文本读取接口增加可选请求：

```ts
interface ReadTextContentRequest {
  readonly encoding?: "utf-8" | "gbk";
}

readText(request?: ReadTextContentRequest): Promise<ResolvedTextContent>;
```

没有指定编码时保持现有自动检测行为；指定编码时使用严格解码。

Local File Resolver 支持这两个编码。Managed JSON Resolver 只接受未指定编码或 UTF-8，其他编码返回“不支持”错误。

所有文件访问继续发生在 Electron Main，Renderer 不获得路径读取能力。

## 错误与边界

- 有未保存修改时重新打开编码：返回用户可见错误，不改变任何状态。
- 编码不支持或解码失败：返回用户可见错误，保留原内容。
- GBK 无法表示当前文本：沿用现有无损校验，拒绝保存。
- 文件在编辑期间被外部修改：沿用 revision 冲突保护。
- 切换行尾序列后关闭 Workbench：关闭流程先保存 Recovery。
- 菜单命令失败：Renderer 回滚本地选择并使用现有居中错误弹窗反馈。
- 同一 Session 的菜单命令和编辑命令继续经过 `AssetWorkbenchHost` 的串行命令队列，避免乱序。

## 测试

### Shared Contract

- V1/V2 Workbench State 校验和迁移；
- 新命令 payload 与结果校验；
- 非法编码和行尾序列被拒绝。

### Main Provider

- 显示选项保存并重新打开后恢复；
- 只切换行尾序列也进入 dirty 和 recovery；
- 保存后写入目标行尾序列并恢复 clean；
- dirty 状态拒绝编码重新打开；
- UTF-8 / GBK 重新打开成功后更新完整基线；
- 重新打开失败不改变 Runtime；
- 格式-only Recovery 可以正确恢复和丢弃。

### Content Resolver

- 自动检测路径保持不变；
- 指定 UTF-8 / GBK 严格读取；
- 无效字节序列失败；
- Managed JSON 拒绝 GBK。

### Renderer 与 Electron

- 不支持菜单的 Workbench 不显示三个点；
- Plain Text Workbench 显示并可关闭菜单；
- 自动换行和行号立即生效；
- LF / CRLF 切换更新未保存状态；
- dirty 时编码选项禁用；
- 重新打开编码后内容与状态标签刷新；
- 恢复弹窗期间菜单不可操作；
- 运行 `pnpm check`、`pnpm package` 和 packaged native verification。

## 完成标准

- 标题栏三个点不再是宿主层静态占位符。
- Plain Text 菜单的四类选项均可真实操作。
- 所有文件格式修改通过 Main Provider 和 Content Handle 完成。
- 格式-only 修改不会在切换 Asset、关闭 Project 或退出应用时静默丢失。
- 其他 Workbench 可以复用同一 Header Actions 插槽而无需修改宿主业务逻辑。
