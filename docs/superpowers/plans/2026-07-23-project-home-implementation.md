# Project 首页与后端数据结构实施计划

> 日期：2026-07-23
>
> 对应设计：`docs/superpowers/specs/2026-07-22-project-home-design.md`

## 目标

实现由 Electron Main 内存仓库驱动的 Project 首页。Renderer 通过类型安全的 Preload API 获取全部 Project 卡片数据，不包含 Project 持久化或写操作。

## 1. 建立共享 Project 契约

修改 `src/shared/ipc.ts`：

- 增加 `project:list` Channel。
- 增加 `ProjectSummary`。
- 为 `LearningCompanionApi` 增加 `listProjects()`。
- 增加单条 Project 和 Project 列表运行时校验。

扩展 `src/shared/ipc.test.ts`，覆盖合法、字段缺失、非法日期和非法来源列表。

## 2. 建立 Main 领域模型与仓库

新增：

- `src/main/projects/project.ts`
- `src/main/projects/project-repository.ts`
- `src/main/projects/in-memory-project-repository.ts`
- 对应 Vitest 测试

`Project` 保存 `id`、`name`、`icon`、`createdTime` 和 `sources`，并生成 IPC Summary。内存仓库复制输入与输出，按创建时间倒序返回。

## 3. 接通 IPC 与 Preload

新增 `src/main/ipc/projects.ts`，向注入的仓库读取列表。修改 Main 生命周期统一注册和移除健康检查与 Project Handler。

修改 `src/preload/index.ts`，只增加 `listProjects()` 白名单方法，不暴露通用 IPC。

运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

通过后单独提交 Project 后端数据结构。

## 4. 实现 Home 页面

新增 `src/renderer/Home.tsx`：

- 从 `window.learningCompanion.listProjects()` 加载卡片数据。
- 校验 IPC 返回值。
- 实现 `loading / ready / empty / failed` 状态。
- 渲染已确认的舒展卡片网格和简化工具栏。
- 使用独立 SVG 维护“最近创建”箭头位置。
- 根据 ID 派生卡片背景色。
- 提供失败重试。

修改 `src/renderer/App.tsx`，只渲染 `<Home />`。

将纯函数放入 `src/renderer/project-view.ts` 并添加测试，覆盖日期、来源数量和色板选择。

## 5. 完整验证

执行：

```bash
pnpm check
pnpm package
pnpm dev
```

通过 Electron 调试目标确认：

- 标题与 Project 卡片可见。
- 卡片内容来自 Main 示例仓库。
- `listProjects()` 存在。
- `window.require` 为 `undefined`。
- 没有横向溢出和控制台错误。

捕获 Electron 页面截图进行视觉检查，确认舒展网格和排序箭头与已批准草图一致。

## 6. Git 交付

1. 提交 Home UI 功能。
2. 确认只包含本功能文件。
3. 执行 `git pull --rebase origin main`。
4. 执行 `git push -u origin main`。
5. 核对本地与远端 `main` 指向同一提交。
