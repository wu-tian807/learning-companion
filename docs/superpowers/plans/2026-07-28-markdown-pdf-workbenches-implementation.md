# Markdown 与 PDF Workbench 实施计划

> 依据：`docs/superpowers/specs/2026-07-28-markdown-pdf-workbenches-design.md`
>
> 日期：2026-07-28
>
> 状态：实施中

## 实施原则

- Markdown 与 PDF 由两个子任务并行开发，文件边界互不重叠。
- 主任务负责依赖、共享契约、IPC、注册、打包资源与最终验收。
- 不修改或提交用户已有的 `AGENTS.md` 和 `tsx教程.md`。
- 每个独立阶段单独提交，提交前运行对应测试。
- 不在本阶段实现 Range、OCR、Attachment、AI 菜单或 Markdown 相邻资源解析。
- 完成后只提交到本地 Git，不自动推送。

## 并行任务边界

### Markdown 子任务

只修改：

```text
src/workbenches/markdown/**
```

负责：

1. Shared Manifest、Payload、State、命令与运行时校验。
2. Main Provider 的文本读取、Buffer 状态机、恢复、保存与规范化确认。
3. Vditor Adapter、CodeMirror 源码模式和 React Renderer。
4. Markdown 菜单、状态栏、错误与单元测试。

不得修改：

- `package.json`、`pnpm-lock.yaml`；
- Main Composition Root；
- AssetWorkbenchHost 与共享 Workbench 契约；
- Vite 配置；
- IPC 与 Preload。

### PDF 子任务

只修改：

```text
src/workbenches/pdf/**
```

负责：

1. Shared Manifest、Payload、State、`pdf.text-range@1` 与运行时校验。
2. Main Provider 的内容 URL、状态持久化和 Session 生命周期。
3. PDF.js Adapter、分页、搜索、目录、缩略图、密码与选区。
4. PDF 菜单、状态栏、错误与单元测试。

不得修改：

- `package.json`、`pnpm-lock.yaml`；
- Main Composition Root；
- AssetWorkbenchHost 与共享 Workbench 契约；
- Vite 配置；
- IPC 与 Preload。

## 阶段一：计划落档

1. 写入本实施计划。
2. 确认并行文件边界。
3. 提交计划文档。

验证：

```bash
git diff --check
```

提交：

```text
文档：记录 Markdown 与 PDF 工作台实施计划
```

## 阶段二：共享基础与依赖

### 依赖

安装并固定：

- `vditor@3.11.2`；
- `pdfjs-dist@6.1.200`；
- `@codemirror/lang-markdown`；
- `diff-match-patch`；
- 必要类型定义与静态资源复制插件。

### 共享选区

新增：

- `WorkbenchSelectionSnapshot`；
- `WorkbenchSelectionEnvelope`；
- Renderer View 的 `onSelectionChange`；
- Host 的 Asset/Session 身份过滤；
- ProjectPage 的当前选区状态和切换清理。

### 外部链接

新增：

- `openExternal` IPC Request；
- Shared 参数校验；
- Preload 白名单方法；
- Main `shell.openExternal` Handler；
- 只允许 `http:` 和 `https:`；
- Renderer View 的 `onOpenExternal` 回调。

### 静态资源

配置本地打包：

- Vditor `dist`；
- PDF.js Worker；
- CMap；
- Standard Fonts；
- WASM；
- ICC；
- Annotation 图片与 Viewer CSS。

验证：

```bash
pnpm typecheck
pnpm vitest run src/shared src/main/ipc src/renderer/workbench
```

分为独立提交：

```text
功能：建立工作台通用选区出口
功能：建立受限外部链接接口
构建：接入 Markdown 与 PDF 本地运行资源
```

## 阶段三：Markdown Workbench 集成

1. 审查子任务 Shared/Main/Renderer 契约。
2. 接入 Main WorkbenchRegistry。
3. 接入 Renderer 动态 Loader。
4. 对齐 `AppError` 与统一错误弹窗。
5. 验证 Vditor 不访问 CDN。
6. 验证 Source 保存与 WYSIWYG 规范化确认。
7. 验证恢复快照、编码、行尾和外部修改冲突。

验证：

```bash
pnpm typecheck
pnpm vitest run src/workbenches/markdown
```

按独立能力提交：

```text
功能：建立 Markdown 工作台主进程模型
功能：实现 Markdown 可视化与源码编辑器
```

## 阶段四：PDF Workbench 集成

1. 审查子任务 Shared/Main/Renderer 契约。
2. 接入 Main WorkbenchRegistry。
3. 接入 Renderer 动态 Loader。
4. 对齐通用选区与外部链接回调。
5. 验证连续滚动、单页翻页和状态恢复。
6. 验证 Text Layer、页内 Anchor、连续模式跨页 Anchor 和文档身份。
7. 验证 Worker、CMap、字体、WASM 和 ICC 的本地路径。

验证：

```bash
pnpm typecheck
pnpm vitest run src/workbenches/pdf
```

按独立能力提交：

```text
功能：建立 PDF 工作台主进程模型
功能：实现 PDF 分页阅读与文字选区
```

## 阶段五：主任务统一验收与修复

### 代码审查

- Workbench Core 不包含 Vditor 或 PDF.js 特有类型。
- Provider 和 Renderer Manifest 完全一致。
- 所有 IPC、Command、Bootstrap、State 和 Anchor 具备运行时校验。
- 旧 Session 不能污染新 Asset 的选区和状态。
- Markdown WYSIWYG 保存不能绕过规范化确认。
- PDF Anchor 不会跨不同文档身份静默命中。
- 无绝对路径、密码或恢复正文泄漏给不必要的模块。

### 自动验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### Electron 实机验证

Markdown：

- CommonMark、GFM、Front Matter、HTML；
- Mermaid 与 LaTeX；
- WYSIWYG/源码切换；
- 显式保存、规范化确认与恢复；
- UTF-8、GBK、BOM、LF、CRLF。

PDF：

- 多页、中文、扫描、目录、链接、密码和损坏 PDF；
- 连续滚动、单页翻页、跳页、缩放、旋转和搜索；
- 页内选择与连续模式跨页选择；
- Asset 切换清除选区；
- 状态恢复和旧 Token 失效。

打包：

- macOS 本地包验证；
- 记录 Windows 真实设备仍需执行的项目，不在 macOS 上虚假宣称完成。

### 最终修复

对验收发现的问题由主任务统一修复并增加回归测试。未经用户验证不推送。

## 完成标准

- 两个 Workbench 均连接真实 Asset、ContentHandle 和 WorkbenchState。
- Markdown 和 PDF 不再进入 Unsupported Workbench。
- 设计文档中的源码保护、分页和选区边界全部兑现。
- Plain Text、Image 与现有 Project/Asset 流程无回归。
- 自动检查、原生模块检查和 macOS 打包验证通过。
- 工作区只保留用户原有未跟踪文件。
