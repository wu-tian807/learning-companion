# Learning Companion 可运行空壳实施计划

> 日期：2026-07-22
>
> 对应设计：`docs/superpowers/specs/2026-07-22-runnable-shell-design.md`

## 目标

交付一个使用 pnpm 管理、可以开发启动和生产打包的 Electron Forge + Vite + React + TypeScript + Tailwind 空壳，并完成 Renderer 到 Main 的类型安全健康检查闭环。

## 实施步骤

### 1. 建立工程配置

创建以下基础文件：

- `package.json` 与 `.npmrc`
- `.gitignore`、`.editorconfig`
- `forge.config.ts`
- `vite.main.config.ts`
- `vite.preload.config.ts`
- `vite.renderer.config.ts`
- `vitest.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`

配置 pnpm 的 hoisted node linker，使用 Electron Forge Vite Plugin 构建三个进程，并提供 `dev`、`typecheck`、`lint`、`test`、`package` 和 `make` 脚本。

### 2. 实现共享 IPC 契约

创建 `src/shared/ipc.ts`，定义：

- 健康检查 Channel 常量。
- `HealthCheckResponse`。
- `LearningCompanionApi`。
- 健康响应构造与运行时校验函数。

使用 Vitest 覆盖健康响应的成功构造和校验失败路径。

### 3. 实现 Electron Main

创建 `src/main/index.ts` 与聚焦的 IPC 模块：

- 注册 `app:health-check` Handler。
- 创建启用隔离和沙箱的 BrowserWindow。
- 阻止未授权导航和窗口创建。
- 处理跨平台应用生命周期。

### 4. 实现 Preload

创建 `src/preload/index.ts`：

- 通过 `contextBridge` 暴露 `window.learningCompanion`。
- 只映射 `healthCheck()`。
- 不暴露 `ipcRenderer` 或 Node.js API。

为 Renderer 的 `Window` 增加全局 TypeScript 声明。

### 5. 实现 React 空壳

创建 Renderer 入口、根组件和样式：

- 左侧文档阅读占位区。
- 右侧 AI 助手与笔记占位区。
- 后端连接中、成功和失败状态。
- 最小响应式布局和桌面视觉基础。

Tailwind 使用当前官方 Vite Plugin，不初始化 shadcn/ui。

### 6. 安装与自动验证

使用 pnpm 安装依赖并生成 `pnpm-lock.yaml`，随后依次执行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm package
```

发现问题时只修改相关模块，并重新执行失败项和完整验证。

### 7. 启动冒烟与提交

运行 `pnpm dev`，确认 Electron 窗口创建、Renderer 加载和 IPC Handler 正常。完成后检查 Git 差异，不纳入工作区原有的无关文件，使用中文提交脚手架变更。

## 完成定义

- 设计中的八项验收标准全部满足。
- 所有自动检查退出码为 0。
- 当前平台生成未签名 Electron 应用包。
- 本地 Git 历史保留技术栈、设计、计划和脚手架的独立提交。
