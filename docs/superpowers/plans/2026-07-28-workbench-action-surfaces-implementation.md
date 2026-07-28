# Workbench Action 与交互入口统一架构实施计划

> 依据：`docs/superpowers/specs/2026-07-28-workbench-action-surfaces-design.md`
>
> 日期：2026-07-28
>
> 状态：实施中

## 实施原则

- 先建立可测试的 Runtime 核心，再逐个迁移 UI 入口。
- 每个阶段结束时保持 TypeScript 编译和相关测试通过。
- 四个 Workbench 迁移完成后才删除旧 Portal 契约。
- 不实现真实 AI、生成任务队列或新的数据库表。
- 不修改或提交用户已有的 `AGENTS.md` 和 `tsx教程.md`。
- 每项独立改动单独提交，不自动 push。

## 阶段一：计划落档

1. 写入本实施计划。
2. 核对设计、阶段边界和提交粒度。
3. 确认工作区只包含计划文档和用户已有未跟踪文件。

验证：

```bash
git diff --check
```

提交：

```text
文档：记录 Workbench 统一入口实施计划
```

## 阶段二：共享 Interaction 与 Runtime 核心

### 共享契约

新增：

```text
src/shared/workbench/interaction.ts
src/shared/workbench/interaction.test.ts
```

定义并校验：

- `WorkbenchInteractionSnapshot`；
- `WorkbenchInteractionContext`；
- `WorkbenchInvocationContext`；
- 入口来源 `overflow`、`context-menu`、`generation-center`。

保留现有 `WorkbenchSelectionSnapshot` 作为首版 Selection 载荷，不把
Editor 实例或 DOM Range 放入共享契约。

### Renderer Action 模型

新增：

```text
src/renderer/workbench/actions/workbench-action.ts
src/renderer/workbench/actions/workbench-contribution.ts
```

定义：

- Action ID、enabled、execute；
- Surface、group、order；
- action、checkbox、radio、generation-tool Presentation；
- close policy、快捷键和禁用原因；
- 带命名空间的 Action ID 约束。

### Registry 与 Store

安装并锁定 `zustand`，新增：

```text
src/renderer/workbench/runtime/workbench-action-registry.ts
src/renderer/workbench/runtime/workbench-action-registry.test.ts
src/renderer/workbench/runtime/workbench-runtime-store.ts
src/renderer/workbench/runtime/workbench-runtime-store.test.ts
src/renderer/workbench/runtime/workbench-invocation.ts
src/renderer/workbench/runtime/workbench-invocation.test.ts
```

实现：

- Owner 原子注册和替换；
- Action ID 冲突检测；
- Contribution 引用校验；
- Surface 筛选和稳定排序；
- Interaction 的 Session 身份过滤；
- 右键菜单冻结快照；
- Action 级 busy；
- 过期 Session 拒绝执行；
- 用户错误统一回调；
- Owner 注销和 Runtime 清理。

验证：

```bash
pnpm typecheck
pnpm vitest run \
  src/shared/workbench/interaction.test.ts \
  src/renderer/workbench/runtime
```

提交：

```text
功能：建立 Workbench Action Runtime
```

## 阶段三：Runtime Provider 与通用菜单 UI

### Runtime Provider

新增：

```text
src/renderer/workbench/runtime/WorkbenchRuntimeProvider.tsx
src/renderer/workbench/runtime/use-workbench-contributions.ts
```

Provider 以当前 Project、Asset、Workbench 和 Session 为作用域，向 View
暴露：

- 注册和更新 Action/Contribution；
- 发布 Interaction；
- 打开和关闭右键菜单；
- 调用 Action；
- 查询 Action busy。

### 通用菜单

新增：

```text
src/renderer/workbench/ui/workbench-menu-model.ts
src/renderer/workbench/ui/WorkbenchMenu.tsx
src/renderer/workbench/ui/WorkbenchMenu.test.tsx
```

支持：

- 普通 action；
- checkbox；
- radio；
- group 与 separator；
- shortcut；
- disabled reason；
- macOS 与 Windows 快捷键标签；
- Esc、点击外部和窗口变化关闭；
- Action busy 和 ARIA 语义。

### 两个菜单 Host

新增：

```text
src/renderer/workbench/host/WorkbenchOverflowHost.tsx
src/renderer/workbench/host/WorkbenchContextMenuHost.tsx
```

临时保留旧 `headerActionsTarget`，让旧 Workbench 可以与新 Host 共存，
直到阶段五完成全部迁移。

验证：

```bash
pnpm typecheck
pnpm vitest run src/renderer/workbench
```

提交：

```text
功能：建立 Workbench 通用菜单宿主
```

## 阶段四：迁移纯文本与 Markdown 右上角入口

新增：

```text
src/workbenches/plain-text/renderer-actions.ts
src/workbenches/markdown/renderer-actions.ts
```

迁移纯文本：

- 自动换行；
- 行号；
- LF/CRLF；
- UTF-8/GBK；
- 编码切换禁用原因。

迁移 Markdown：

- 大纲；
- 源码自动换行；
- LF/CRLF；
- UTF-8/GBK；
- 在文件夹中显示。

删除：

```text
src/workbenches/plain-text/workbench-menu.tsx
src/workbenches/markdown/workbench-menu.tsx
```

Markdown 源码右键菜单在本阶段先迁入临时独立文件，阶段六统一替换，
避免删除 `workbench-menu.tsx` 时丢失现有功能。

验证：

```bash
pnpm typecheck
pnpm vitest run \
  src/workbenches/plain-text \
  src/workbenches/markdown \
  src/renderer/workbench
```

提交：

```text
重构：迁移文本工作台标题栏操作
```

## 阶段五：迁移 PDF 与图片右上角入口

新增：

```text
src/workbenches/pdf/renderer-actions.ts
src/workbenches/image/renderer-actions.ts
```

迁移 PDF：

- 连续滚动和单页翻页；
- 缩略图和目录；
- 适应宽度、适应整页和实际大小；
- 顺时针与逆时针旋转；
- 在文件夹中显示。

迁移图片：

- 适应窗口和实际大小；
- 顺时针与逆时针旋转；
- 重置视图；
- 在文件夹中显示。

完成后删除：

```text
src/workbenches/pdf/workbench-menu.tsx
src/workbenches/image/workbench-menu.tsx
```

再从 `RendererWorkbenchViewProps` 和全部 View 中移除：

- `headerActionsTarget`；
- Workbench 自己的 `createPortal()`；
- `AssetWorkbenchHost` 中旧 Portal Target。

移动并整理宿主文件：

```text
src/renderer/workbench/AssetWorkbenchHost.tsx
  -> src/renderer/workbench/host/AssetWorkbenchHost.tsx

src/renderer/workbench/AttachmentHost.tsx
  -> src/renderer/workbench/host/AttachmentHost.tsx
```

同步更新引用，保持 Registry 与 Lifecycle 的职责独立。

验证：

```bash
pnpm typecheck
pnpm vitest run \
  src/workbenches/pdf \
  src/workbenches/image \
  src/renderer/workbench
rg -n "headerActionsTarget|workbench-menu|createPortal" \
  src/workbenches src/renderer/workbench
```

允许的 `createPortal` 只剩通用 Context Menu Host 或应用级 Dialog。

提交：

```text
重构：统一查看器标题栏操作
```

## 阶段六：统一编辑器右键菜单

### Editor Action Preset

新增：

```text
src/renderer/workbench/editor/editor-action-adapter.ts
src/renderer/workbench/editor/codemirror-action-adapter.ts
src/renderer/workbench/actions/editor-action-preset.ts
```

统一 Action：

- undo；
- redo；
- cut；
- copy；
- paste；
- find；
- select-all；
- AI 扩展分组占位。

不支持的 Action 保持显示但禁用。

### CodeMirror

纯文本与 Markdown 源码共用 CodeMirror Adapter：

- 右键点在已有选区内时保留选区；
- 点在选区外时移动光标；
- 捕获菜单打开时的 selection ranges；
- clipboard、undo/redo、find 和 select-all 使用相同实现；
- 保持滚轮、拖动选择和滚动条行为。

### Vditor

扩展 Markdown Adapter：

- 捕获和恢复 DOM Range；
- 支持 undo、redo、cut、copy、paste、select-all；
- 查找在首版不可用时显示禁用；
- 右键菜单失焦后仍使用冻结选区；
- 编辑后继续触发现有 input、恢复快照和 dirty 逻辑。

清理：

- 删除纯文本 `renderer.tsx` 中内联右键菜单 JSX；
- 删除 Markdown 临时源码菜单；
- 三个编辑面只调用 `runtime.openContextMenu()`。

验证：

```bash
pnpm typecheck
pnpm vitest run \
  src/renderer/workbench/editor \
  src/workbenches/plain-text \
  src/workbenches/markdown
```

提交：

```text
功能：统一文本编辑器右键菜单
```

## 阶段七：统一 Interaction 与生成中心

### Interaction 发布

将现有选区状态迁入 Runtime：

- PDF 继续发布稳定 `pdf.text-range@1`；
- 纯文本发布文字和文本范围 Anchor；
- Markdown 源码发布文字和源码范围 Anchor；
- Markdown WYSIWYG 发布文字及可稳定表达的 Markdown Anchor；
- Asset 或 Session 切换时清空旧 Interaction。

如果 WYSIWYG 首版无法生成稳定源码范围，则只发布选中文字和
Workbench 特化 Anchor，不伪造不可靠行号。

### Generation Center

将 `ProjectPage.tsx` 内的 `GenerationPanel` 移到：

```text
src/renderer/generation/GenerationCenter.tsx
src/renderer/generation/GenerationCenter.test.tsx
```

接入：

- 当前 Asset；
- 当前 Workbench；
- 当前 Interaction；
- 应用级工具占位；
- Workbench `generation-center` Contribution；
- 无 Asset、无工具、无选区的明确空状态。

本阶段所有 AI 工具保持禁用，不产生网络请求。

验证：

```bash
pnpm typecheck
pnpm vitest run \
  src/renderer/generation \
  src/renderer/ProjectPage.tsx \
  src/renderer/workbench
```

提交：

```text
功能：连接 Workbench 上下文与生成中心
```

## 阶段八：目录清理与完整验收

### 静态检查

- 通用层不导入 Vditor、PDF.js 或图片查看器类型；
- Workbench 不再渲染标题栏菜单；
- 三个编辑面没有重复菜单 JSX；
- Registry 中没有卸载 Workbench 的 Action；
- 共享契约只包含 JSON 可序列化数据；
- 没有新的 Renderer 文件系统、数据库或 Node.js 访问；
- 用户未跟踪文件保持原样。

### 自动验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### Electron 实机验证

右上角：

- 纯文本、Markdown、PDF 和图片菜单行为与迁移前一致；
- checkbox 和 radio 状态实时更新；
- 异步错误进入统一弹窗；
- Workbench 切换后菜单立即替换。

右键菜单：

- 三个编辑面菜单结构一致；
- 复制、剪切、粘贴、撤销、重做、查找和全选；
- 菜单打开后选区不丢失；
- 不支持项正确置灰；
- 右键、滚轮、拖动选区和滚动条互不干扰。

生成中心：

- 正确显示当前 Asset 和 Workbench；
- 能感知文字或 PDF 选区；
- 切换 Asset 后不保留旧选区；
- 不发起 AI 或网络调用。

打包：

- macOS 本地包启动；
- 原生 SQLite 模块可加载；
- 记录 Windows 真机仍需执行的菜单与剪贴板验证，不在 macOS 上虚假宣称完成。

最终修复按问题类型单独提交，不将无关修复混入架构提交。

## 完成标准

- 设计文档第 16 节全部验收标准满足。
- 四个旧 `workbench-menu.tsx` 已删除。
- `headerActionsTarget` 已从双端 Renderer 契约删除。
- 三个编辑面共用一个菜单组件和 Editor Action Preset。
- 纯文本与 Markdown 源码共用 CodeMirror Adapter。
- Generation Center 只读取 Runtime，不直接依赖编辑器。
- `pnpm check`、原生模块验证和 macOS 打包通过。
- 所有改动细粒度提交到本地 Git，未经用户验证不 push。
