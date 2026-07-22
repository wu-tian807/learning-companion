# Learning Companion

一个本地优先的 AI 学习助手桌面应用。当前仓库提供 Electron + React 的可运行空壳，为后续文档阅读、对话、自动笔记和思维导图建立安全边界。

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
  -> 未来的文件、SQLite 与 Codex 能力
```

Renderer 禁止直接访问 Node.js。当前唯一开放的本地能力是类型安全的健康检查。

完整技术选择见 [`TECH_STACK.md`](./TECH_STACK.md)，空壳边界见 [`docs/superpowers/specs/2026-07-22-runnable-shell-design.md`](./docs/superpowers/specs/2026-07-22-runnable-shell-design.md)。
