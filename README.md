# Learning Companion

一个本地优先的 AI 学习助手桌面应用。当前仓库已经具备 Electron + React 桌面空壳，以及从 Electron Main 读取 Project 列表并展示在首页的完整链路，为后续文档阅读、对话、自动笔记和思维导图建立安全边界。

## 开发环境

- Node.js 22+
- pnpm 10+

## 开始使用

```bash
pnpm install
pnpm dev
```

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
  -> 未来的文件、SQLite 与 Codex 能力
```

Renderer 禁止直接访问 Node.js。当前通过类型安全的 IPC 开放健康检查和 `listProjects`；首页卡片全部由 Main 进程维护的 Project Repository 提供。Project 当前包含 `id`、`name`、`icon`、`createdTime` 和 `sources`，内存实现后续可以在不改变 Renderer 调用方式的前提下替换为 SQLite。

完整技术选择见 [`TECH_STACK.md`](./TECH_STACK.md)，Project 首页设计见 [`docs/superpowers/specs/2026-07-22-project-home-design.md`](./docs/superpowers/specs/2026-07-22-project-home-design.md)。
