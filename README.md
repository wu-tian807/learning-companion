# Learning Companion

一个本地优先的 AI 学习助手桌面应用。用户可以在 Project 中集中管理学习资料，阅读 PDF、Word、PowerPoint 等文档，针对文档中的文字、公式或图像向 AI 自由提问，并把有价值的回答附着回原文位置。

## 当前能力

- Project 卡片与 NotebookLM 风格列表视图，支持搜索、排序、置顶、重命名和删除。
- 导入并阅读 PDF、Word 和 PowerPoint 资料。
- Office 文档自动生成 PDF 预览；Windows 环境优先使用 PowerPoint 导出 PPT 的最终动画状态，尽量保留公式和完整页面内容。
- PDF 统一框选文字、公式和图像区域，并把页码、选区位置与选中文字作为问题上下文交给 AI；区域内容由 Agent 读取原文档理解。
- 框选后提供“解释、举例、翻译、总结、自由提问”快捷操作，也可以输入任意问题继续追问。
- AI 回答支持 Markdown 和数学公式排版，避免直接显示 LaTeX 源码。
- 用户可以选择 AI 回答中的任意内容并附着到原文选区；附着标注支持定位、完整查看和删除。
- Project、Asset、附件及标注使用 SQLite 持久化；界面设置保存到 Electron `userData` 目录。
- Renderer 通过 Preload 白名单 API 调用 Main，不直接访问 Node.js。

> Office 预览依赖本机可用的 Microsoft PowerPoint 或 LibreOffice。文档 AI 功能需要可用的 Codex Runtime 及登录状态。

## 开发环境

- Node.js 22+
- pnpm 10+

## 开始使用

```bash
pnpm install
pnpm dev
```

启动后新建或打开一个 Project，通过左侧“添加资料”导入文档。阅读 PDF 或 Office 预览时，可以直接拖动框选内容，在选区旁使用快捷提问，也可以在右侧 AI 面板中输入自定义问题。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm package
```

也可以使用 `pnpm check` 一次运行类型检查、Lint 和单元测试。

## 进程边界

```text
React Renderer
  -> Preload 白名单 API
  -> Electron Main
  -> SQLite Repository / 本地文件
  -> Office 预览与 Codex Runtime
```

Renderer 禁止直接访问 Node.js。项目通过类型安全的 IPC 提供 Project、Asset、附件、设置、文档预览和 AI 问答能力；数据库访问、文件读写、外部程序调用与 Codex 请求均位于 Main 进程。

完整技术选择见 [`TECH_STACK.md`](./TECH_STACK.md)，Project 首页交互设计见 [`docs/superpowers/specs/2026-07-23-project-home-interactions-design.md`](./docs/superpowers/specs/2026-07-23-project-home-interactions-design.md)，Settings 持久化设计见 [`docs/superpowers/specs/2026-07-23-settings-persistence-ipc-design.md`](./docs/superpowers/specs/2026-07-23-settings-persistence-ipc-design.md)。
