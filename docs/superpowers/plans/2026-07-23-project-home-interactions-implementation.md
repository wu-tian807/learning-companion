# Project 首页交互实施计划

> 依据：`docs/superpowers/specs/2026-07-23-project-home-interactions-design.md`
>
> 日期：2026-07-23

## 目标

在不引入 SQLite 的前提下，完成 Project 首页两种视图、顶部工具栏与内存 CRUD 闭环，并保持 Renderer 无 Node.js 权限。

## 阶段一：领域模型与共享契约

修改：

- `src/main/projects/project.ts`
- `src/main/projects/project-repository.ts`
- `src/main/projects/in-memory-project-repository.ts`
- 对应测试文件
- `src/shared/ipc.ts`
- `src/shared/ipc.test.ts`

步骤：

1. 为 `Project` 与 `ProjectSummary` 增加 `pinned`。
2. 定义创建、重命名、置顶和删除请求类型与运行时守卫。
3. 扩展 Repository 接口并实现内存 CRUD、克隆保护和找不到项目错误。
4. 增加领域、仓库与共享契约测试。
5. 执行 `pnpm check`。
6. 独立提交“功能：扩展 Project 内存操作”。

## 阶段二：Electron IPC 与 Preload

修改：

- `src/main/ipc/projects.ts`
- `src/main/index.ts`
- `src/preload/index.ts`

步骤：

1. 注册四个 Project 写操作 Handler。
2. Handler 使用共享守卫校验未知输入，再调用 Repository。
3. Preload 仅暴露明确方法，不提供任意 Channel 入口。
4. App 退出时移除新增 Handler。
5. 执行 `pnpm check`。
6. 独立提交“功能：接入 Project 写操作 IPC”。

## 阶段三：Renderer 纯逻辑

修改：

- `src/renderer/project-view.ts`
- `src/renderer/project-view.test.ts`

步骤：

1. 定义 `ProjectViewMode` 与 `ProjectSortMode`。
2. 实现名称筛选、置顶分组和三种排序。
3. 覆盖中英文标题、置顶优先和空关键词测试。
4. 执行相关测试和 `pnpm check`。

## 阶段四：首页组件与交互

新增或修改：

- `src/renderer/Home.tsx`
- `src/renderer/components/HomeToolbar.tsx`
- `src/renderer/components/ProjectGrid.tsx`
- `src/renderer/components/ProjectList.tsx`
- `src/renderer/components/ProjectActionsMenu.tsx`
- `src/renderer/components/ProjectDialog.tsx`
- `src/renderer/components/ConfirmDialog.tsx`

步骤：

1. 移除分类标签、密度文字按钮和创建卡片。
2. 构建搜索、图标视图切换、排序下拉与新建按钮。
3. 构建舒展卡片与四列列表，共享三点菜单。
4. 接入新建、重命名、置顶、删除与错误反馈。
5. 支持 Escape、点击外部关闭、焦点和忙碌状态。
6. 处理加载、仓库为空、搜索无结果和失败状态。
7. 执行 `pnpm check`。
8. 独立提交“功能：完善 Project 首页交互”。

## 阶段五：运行时与视觉验收

步骤：

1. 执行 `pnpm package`。
2. 启动真实 Electron，确认 preload API 存在、`window.require` 不存在。
3. 使用窗口截图检查舒展模式、列表模式、工具栏顺序、菜单和弹窗。
4. 通过实际操作验证搜索、排序、新建、重命名、置顶和删除。
5. 关闭并重启应用，确认恢复初始示例数据。
6. 检查常用宽度下无横向溢出和未处理控制台错误。
7. 若有修正，重新执行 `pnpm check` 与 `pnpm package`。

## 阶段六：文档与 Git 交付

步骤：

1. 更新 README 中的 Project 功能与内存限制说明。
2. 自测后独立提交文档。
3. 确认 `AGENTS.md` 与 `tsx教程.md` 未进入暂存区。
4. 将 `origin` 切换为 SSH URL。
5. 执行 `git pull --rebase origin main`；远端为空时记录首次推送情形。
6. 执行 `git push -u origin main`。
7. 对比本地与远端 `main` 的 HEAD。
