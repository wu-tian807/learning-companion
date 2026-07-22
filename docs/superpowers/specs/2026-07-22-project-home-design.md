# Learning Companion Project 首页设计

> 状态：已确认
>
> 日期：2026-07-22

## 1. 目标

将当前双栏空壳首页替换为大屏 Project 首页，并建立第一版后端 Project 领域结构。首页所有 Project 卡片必须通过 Preload 与 IPC 从 Electron Main 获取，Renderer 不保存硬编码 Project 列表。

本次完成的是可扩展的数据边界和只读列表闭环，不实现 Project 创建、编辑、删除或持久化。

## 2. 已确认的视觉方向

- 采用深色、简洁的大屏卡片网格。
- 默认使用“舒展”密度，不使用紧凑密度作为默认值。
- 顶部保留“全部 / 我的 Projects / 精选”导航外观。
- 右侧保留搜索、密度、最近创建和新建 Project 控件。
- “最近创建”的向下箭头作为独立图标放在文字右侧，并保持明确间距。
- 首张卡片是“创建新 Project”入口外观。
- Project 卡片展示图标、名称、创建时间和来源数量。
- 卡片背景色由 Renderer 根据 Project ID 从固定色板中稳定派生，不增加后端字段。

搜索、密度、排序、新建入口和卡片菜单在本次只提供视觉状态，不执行数据变更。密度控件以“舒展”为选中态。

## 3. 方案结论

采用 Electron Main 内存仓库方案：

```text
App.tsx
  -> Home.tsx
  -> window.learningCompanion.listProjects()
  -> Preload 白名单 API
  -> project:list IPC
  -> InMemoryProjectRepository
  -> Project[]
```

不采用前端静态数组，因为它会破坏后端数据所有权；不在本次接入 JSON 或 SQLite，因为当前尚未定义创建、迁移和持久化规则。

## 4. Project 领域结构

Electron Main 中建立 `Project` 类：

```ts
class Project {
  readonly id: string;
  name: string;
  icon: string;
  readonly createdTime: Date;
  sources: string[];
}
```

字段说明：

- `id`：稳定身份，用作仓库查找、IPC 数据标识、React Key 和未来路由参数。
- `name`：用户可见 Project 名称。
- `icon`：第一版保存 Emoji 字符串，避免引入图标存储和文件协议。
- `createdTime`：Main 内部使用 `Date`。
- `sources`：第一版保存来源 ID 字符串，卡片只读取数组长度。

`Project` 提供 `toSummary()`，将内部对象转换成只读、可结构化克隆的 `ProjectSummary`。IPC 中的 `createdTime` 使用 ISO 8601 字符串，Renderer 不接收 `Date` 对象。

## 5. 内存仓库

建立 `ProjectRepository` 接口和 `InMemoryProjectRepository` 实现：

```ts
interface ProjectRepository {
  list(): readonly Project[];
}
```

仓库由 Electron Main 创建，并注入 Project IPC Handler。第一版在 Main 中放置若干示例 Project，以验证完整列表数据流。`list()` 按 `createdTime` 从新到旧返回副本，调用方不能直接修改仓库内部数组。

应用重启后示例数据恢复初始值。本次不写入本机文件，也不伪装成已持久化数据。

## 6. 共享 IPC 契约

在共享层新增：

- `IPC_CHANNELS.listProjects = "project:list"`
- `ProjectSummary`
- `LearningCompanionApi.listProjects()`
- `isProjectSummary()`
- `isProjectSummaryList()`

`ProjectSummary` 结构：

```ts
interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  createdTime: string;
  sources: string[];
}
```

Preload 只暴露 `listProjects()`，不暴露通用 IPC Channel。Renderer 收到数据后执行运行时校验；无效响应按加载失败处理。

## 7. Electron Main 生命周期

- 应用就绪时创建内存仓库。
- 注册健康检查和 Project 列表 Handler。
- Project Handler 只读取仓库并返回 Summary 数组。
- 应用退出时移除两个 Handler。
- 后续接入 SQLite 时替换仓库实现，不修改 Renderer API。

## 8. Renderer 结构

### App.tsx

`App.tsx` 只作为应用入口，渲染 `<Home />`。当前不引入路由器。

### Home.tsx

`Home.tsx` 负责：

- 首次挂载时调用 `listProjects()`。
- 维护加载、成功和失败状态。
- 渲染已确认的顶部工具栏和舒展卡片网格。
- 格式化创建时间和来源数量。
- 根据稳定 ID 为卡片选择背景色。
- 在同一文件内维护当前简单的 Project Card 展示组件。

Project 名称、图标、创建时间和来源数量只能来自 IPC 响应。页面允许保留导航标签和控件文案等静态界面文本。

## 9. 页面状态与错误处理

- `loading`：在卡片区域展示有限数量的骨架卡片。
- `ready`：展示创建入口卡片和后端返回的 Project 卡片。
- `empty`：只展示创建入口和空列表说明。
- `failed`：展示简短错误说明与“重新加载”按钮，不显示堆栈和本机路径。

重新加载只重复读取内存仓库，不改变数据。

## 10. 测试与验证

自动测试覆盖：

- `Project` 正确保存字段并生成可序列化 Summary。
- 内存仓库返回副本并按创建时间倒序排列。
- Project Summary 与列表运行时校验接受合法数据、拒绝非法数据。
- 时间与来源数量格式化函数得到稳定输出。

完整验证命令：

```bash
pnpm check
pnpm package
```

运行时冒烟验证：

1. `pnpm dev` 能打开 Electron 窗口。
2. Home 标题、工具栏和舒展网格正确显示。
3. Project 卡片数量和文本与 Main 内存仓库一致。
4. `window.learningCompanion.listProjects` 存在。
5. `window.require` 仍为 `undefined`。
6. 页面没有横向溢出或控制台错误。

## 11. 非目标

本次不实现：

- Project 创建、重命名、删除和菜单操作。
- 搜索、筛选、排序和密度切换行为。
- SQLite 或 JSON 持久化。
- Source 领域类和来源详情。
- 点击卡片进入 Project 工作区。
- 路由、分页和虚拟列表。

## 12. Git 交付

- 设计规格和功能代码分别使用中文提交。
- 不纳入工作区原有的无关未跟踪文件。
- 实现完成并通过全部验证后，在 push 前执行 `pull --rebase`。
- 将本地 `main` 提交自动推送到 `https://github.com/wu-tian807/learning-companion.git`。
