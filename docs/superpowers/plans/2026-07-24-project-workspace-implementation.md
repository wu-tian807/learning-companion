# Project 工作区导航骨架实施计划

> 依据：`docs/superpowers/specs/2026-07-24-project-workspace-design.md`
>
> 日期：2026-07-24

## 目标

实现 `Home -> Project -> Home` 的最小页面闭环。Project 工作区使用独立页面承载已确认的 `2:6:2` 三栏布局，标题读取首页已经加载的真实 `ProjectSummary`；Asset、预览器和生成工具暂时只保留隔离的展示骨架，为后续响应式布局与真实后端数据接入提供稳定边界。

## 阶段一：独立 Project 工作区骨架

新增：

- `src/renderer/ProjectPage.tsx`

步骤：

1. 定义只依赖 `ProjectSummary` 和返回回调的 `ProjectPageProps`。
2. 使用真实 Project 图标和名称构建紧凑标题栏。
3. 使用三个语义独立的面板实现 Asset 列表、空白预览器和生成中心。
4. 以 CSS Grid 和明确的最小列宽表达桌面端 `2:6:2` 比例，为后续媒体查询和折叠策略保留入口。
5. 将演示 Asset 与工具数据限制在 Renderer 页面内部，避免形成虚假的后端契约。
6. 保持预览器主体为空，不提前实现 Markdown、PDF、AI 问答或生成逻辑。

## 阶段二：首页与工作区导航

修改：

- `src/renderer/App.tsx`
- `src/renderer/Home.tsx`
- `src/renderer/components/ProjectGrid.tsx`
- `src/renderer/components/ProjectList.tsx`
- `src/renderer/components/ProjectActionsMenu.tsx`

步骤：

1. 在 App 层维护 `home` 与携带 `ProjectSummary` 的 `project` 页面状态。
2. Home 通过 `onOpenProject` 向卡片和列表下传统一导航入口。
3. Project 卡片和列表行支持鼠标点击以及 Enter、Space 键进入。
4. ProjectPage 的返回按钮只切换回 Home，不引入路由依赖。
5. 三点菜单阻止点击事件冒泡，确保重命名、置顶和删除不会误触页面导航。
6. 保留现有 Project IPC、排序、显示模式和 CRUD 行为不变。

## 阶段三：验证

步骤：

1. 执行类型检查、Lint 和现有测试。
2. 执行 Electron 打包，确认新增页面不破坏 Forge/Vite 构建。
3. 启动 Electron，验证卡片和列表都能进入 Project 工作区。
4. 验证返回按钮能回到 Home，三点菜单操作不会进入 Project。
5. 检查窄窗口下的桌面最小宽度行为，为后续响应式断点记录清晰基础。
6. 检查工作区，只暂存本功能涉及文件。

## 实施约束

- 不引入 React Router。
- 不接入 Asset、Source、预览器或生成工具后端。
- 不新增 SQLite 表或修改 Project 数据库模型。
- 不把 Renderer 演示数据暴露为 IPC 数据结构。
- 不实现移动端布局，只建立可演进的面板与 Grid 边界。
- 不执行 push，除非用户另行要求。
