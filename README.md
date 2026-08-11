# Learning Companion

一个本地优先的 AI 学习助手桌面应用。当前仓库已经具备 Electron + React 桌面空壳、Project 舒展/列表首页，以及通过 Electron Main 管理 Project 的完整内存数据链路，为后续文档阅读、对话、自动笔记和思维导图建立安全边界。

## 当前能力

- 舒展卡片与 NotebookLM 风格列表视图。
- 按标题搜索，按最近创建、最早创建或标题排序。
- 显示模式和排序方式通过 Main 写入本地 JSON，并在应用重启后恢复。
- 新建、重命名、置顶和删除 Project。
- Renderer 通过 Preload 白名单 API 调用 Main，不直接访问 Node.js。

Project 当前使用调试用内存仓库：操作在本次应用进程中真实生效，但应用重启后会恢复内置示例数据。本阶段尚未接入 SQLite。新建 Project 时由 Main 自动分配占位图标 `📘`，后续将在后端替换为模型生成或挑选图标，不要求用户手动填写。

界面设置保存在 Electron `userData/config/settings.json`。文件不存在或内容损坏时使用默认设置继续启动；用户每次修改显示或排序选项后立即安全写入，不依赖应用关闭事件。

## 开发环境

- Node.js 22+
- pnpm 10+

## 开始使用

```bash
pnpm install
pnpm dev
```

## AI 自动划重点（Markdown）

启动应用前配置 AI 服务，然后在 Markdown 工作台点击“AI 划重点”。应用只会在该按钮被点击后发送当前文档内容；AI 返回原文中的精确句子，应用将其映射为只读高亮（源码和渲染视图都会显示），不会自动修改或保存原文件。

默认使用 OpenAI：设置环境变量 `OPENAI_API_KEY`，默认模型 `gpt-5.6-terra`，可通过 `LEARNING_COMPANION_OPENAI_MODEL` 覆盖。

使用 DeepSeek：设置以下环境变量后重启应用：

- `LEARNING_COMPANION_AI_PROVIDER=deepseek`
- `LEARNING_COMPANION_AI_API_KEY=<你的 DeepSeek API Key>`
- 可选 `LEARNING_COMPANION_AI_MODEL=deepseek-v4-flash`（默认）或 `deepseek-v4-pro`

其他 OpenAI 兼容服务：设置 `LEARNING_COMPANION_AI_BASE_URL` 指向其接口地址（如 `https://api.deepseek.com`），并使用 `LEARNING_COMPANION_AI_API_KEY` 提供密钥。

## 纯文本阅读与 AI 答疑

- 打开 `.txt` 资料后，默认进入阅读模式，把文本渲染成适合学习的页面并保留阅读位置；
  标题栏可随时切换「编辑 / 阅读」。
- 在任意支持文字选区的资料（纯文本、Markdown、PDF、EPUB、HTML）中选中一段文字，
  右键选择「解释选中内容」，即可让 AI 解释该段落；在右侧 AI 面板中可以继续输入
  追问，AI 会结合原文回答。

AI 答疑复用与「AI 划重点」相同的服务配置（`OPENAI_API_KEY` 或
`LEARNING_COMPANION_AI_API_KEY` 等环境变量），选中文字与追问只会在你点击菜单后
发送，不会自动上传整个文档。

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
  -> Project Repository（当前为内存实现）
  -> JSON Settings Repository
  -> 未来的文件、SQLite 与 Codex 能力
```

Renderer 禁止直接访问 Node.js。当前通过类型安全的 IPC 开放健康检查、Settings 读取与更新，以及 Project 的列表、创建、重命名、置顶、删除操作；两种首页视图使用同一份 Main Repository 数据。Project 当前包含 `id`、`name`、`icon`、`createdTime`、`sources` 和 `pinned`，内存实现后续可以在不改变 Renderer 调用方式的前提下替换为 SQLite。

完整技术选择见 [`TECH_STACK.md`](./TECH_STACK.md)，Project 首页交互设计见 [`docs/superpowers/specs/2026-07-23-project-home-interactions-design.md`](./docs/superpowers/specs/2026-07-23-project-home-interactions-design.md)，Settings 持久化设计见 [`docs/superpowers/specs/2026-07-23-settings-persistence-ipc-design.md`](./docs/superpowers/specs/2026-07-23-settings-persistence-ipc-design.md)。
