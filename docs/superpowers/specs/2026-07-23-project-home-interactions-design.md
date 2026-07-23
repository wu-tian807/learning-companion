# Learning Companion Project 首页交互设计

> 状态：已确认
>
> 日期：2026-07-23
>
> 取代范围：本规格取代 `2026-07-22-project-home-design.md` 中关于顶部工具栏、创建卡片和只读列表的界面结论；既有 Electron 安全边界继续有效。

## 1. 目标

把当前用于视觉预览的 Project 首页调整为可实际操作的界面：仅保留舒展卡片与列表两种视图，按用户提供的 NotebookLM 参考图重新编排顶部工具栏，并让新建、重命名、置顶和删除真实修改 Electron Main 中的内存仓库。

本轮验证的是 UI、类型安全 IPC 和 Repository 行为。Project 数据仍是调试用示例数据，应用重启后恢复初始状态。

## 2. 已确认边界

- 采用 Renderer 界面状态 + Main 内存仓库写操作方案。
- 不安装 SQLite 依赖，不创建数据库文件，不实现 SQLite Repository，也不伪装持久化成功。
- Main 中的 Repository 接口是未来 SQLite 实现的替换边界。
- 搜索、排序和视图模式是 Renderer 本地状态。
- 新建、重命名、置顶和删除通过 Preload 白名单 API 与类型安全 IPC 修改 Main 内存仓库。
- 应用重启后，所有操作结果消失并恢复内置示例 Project。

## 3. 页面布局

### 3.1 标题与工具栏

移除上一版的“全部 / 我的 Projects / 精选”标签、舒展/紧凑文字按钮和网格中的创建卡片。

页面标题区左侧显示：

- 标题“我的 Projects”。
- 一行简短说明。

右侧工具栏按参考图从左到右排列：

1. 搜索按钮。
2. 舒展卡片 / 列表分段切换按钮。
3. 排序下拉按钮。
4. “新建 Project”主按钮。

窗口变窄时允许工具栏换行，但页面不得产生横向滚动。所有按钮保留可见焦点、`aria-label` 和选中状态。

### 3.2 舒展模式

- 默认使用舒展卡片网格。
- 卡片展示 Emoji、名称、创建日期、来源数量和三点菜单。
- 不再显示“创建新 Project”卡片；新建只从顶部主按钮进入。
- 置顶 Project 提供轻量置顶标识，但不改变原有卡片视觉层级。
- 卡片背景色继续根据稳定 ID 从固定色板派生。

### 3.3 列表模式

列表参考用户提供的 NotebookLM 排版，使用四列：

| 列 | 内容 |
| --- | --- |
| 标题 | Emoji 与 Project 名称 |
| 来源 | 来源数量 |
| 创建时间 | 格式化日期 |
| 操作 | 三点菜单 |

不显示 `Role`，因为当前 Project 领域没有协作者与权限模型。列表行和卡片使用同一份已筛选、已排序数据。

## 4. 顶部控件行为

### 4.1 搜索

- 点击圆形搜索按钮后，在原位置展开搜索输入框。
- 输入时按 Project 名称进行不区分大小写的即时筛选。
- 清空按钮清除关键词；失焦时若关键词为空则收回为图标。
- 搜索只影响当前显示，不修改仓库数据。

### 4.2 视图切换

- 提供舒展卡片和列表两个图标按钮。
- 当前选中项使用紫灰色选中背景与明确的 `aria-pressed` 状态。
- 默认是舒展卡片模式。
- 视图偏好本轮不持久化，应用重启后恢复默认。

### 4.3 排序

排序下拉包含：

- 最近创建。
- 最早创建。
- 标题。

置顶 Project 在所有排序方式下都位于非置顶 Project 之前；置顶组和非置顶组内部各自遵循当前排序。标题排序使用中文界面的 `Intl.Collator('zh-CN')`。

### 4.4 新建

- 点击主按钮打开自定义模态框。
- 表单包含名称和 Emoji 图标。
- 名称去除首尾空格后必须非空，最长 80 个字符。
- Emoji 为空时使用默认值 `📘`，图标文本最长 8 个 Unicode code point。
- Main 负责生成 `crypto.randomUUID()`、当前创建时间和空的 `sources` 数组。
- 创建成功后关闭弹窗并立即出现在当前结果中。

## 5. Project 三点菜单

三点菜单在卡片和列表行中行为一致，包含：

- 重命名。
- 置顶；已置顶时显示“取消置顶”。
- 删除。

交互规则：

- 点击页面其他位置或按 `Escape` 关闭菜单。
- 重命名复用 Project 表单模态框，只编辑名称，不修改图标。
- 删除必须经过自定义确认弹窗，弹窗明确显示目标 Project 名称。
- 删除成功后 Project 从两种视图和当前搜索结果中移除。
- 同一时间只允许一个写操作执行；执行中的提交按钮显示忙碌状态并禁止重复提交。

## 6. 领域模型与 Repository

`Project` 增加 `pinned` 字段：

```ts
interface ProjectInput {
  id: string;
  name: string;
  icon: string;
  createdTime: Date;
  sources: string[];
  pinned?: boolean;
}
```

`ProjectSummary` 增加必填的 `pinned: boolean`。未显式传入时领域对象默认使用 `false`。

Repository 接口扩展为：

```ts
interface CreateProjectInput {
  name: string;
  icon: string;
}

interface ProjectRepository {
  list(): readonly Project[];
  create(input: CreateProjectInput): Project;
  rename(id: string, name: string): Project;
  setPinned(id: string, pinned: boolean): Project;
  delete(id: string): void;
}
```

内存实现继续通过克隆保护内部状态。找不到 ID 时抛出不包含本机信息的领域错误；名称与图标验证复用领域规则。

## 7. IPC 与数据流

共享契约新增四个 Channel 与对应白名单 API：

```text
project:create
project:rename
project:set-pinned
project:delete
```

请求必须使用明确对象结构，不接受任意 Channel。Main Handler 在调用 Repository 前再次校验未知输入；Renderer 也校验返回的 `ProjectSummary`。

成功数据流：

```text
用户操作
  -> Home 进入提交状态
  -> window.learningCompanion.<mutation>()
  -> Preload 白名单方法
  -> Electron Main IPC Handler
  -> InMemoryProjectRepository
  -> 返回 ProjectSummary 或 void
  -> Renderer 更新当前列表
```

Renderer 使用写操作返回的 Summary 更新对应项目；删除成功后按 ID 移除。重新加载仍可从 `listProjects()` 恢复 Main 当前内存状态。

## 8. Renderer 组件边界

- `Home.tsx`：读取 Project、维护页面级状态和调度写操作。
- `components/HomeToolbar.tsx`：搜索、视图、排序、新建入口。
- `components/ProjectGrid.tsx`：舒展卡片网格。
- `components/ProjectList.tsx`：NotebookLM 风格列表。
- `components/ProjectActionsMenu.tsx`：共享三点菜单。
- `components/ProjectDialog.tsx`：新建与重命名表单。
- `components/ConfirmDialog.tsx`：删除确认。
- `project-view.ts`：纯函数筛选、置顶分组、排序与格式化。

组件只接收必要属性和回调，不直接访问 IPC；所有 Electron 调用集中在 Home 页面，便于后续替换状态管理或路由。

## 9. 状态与错误处理

- 首次读取继续使用 `loading / ready / failed` 状态。
- 空结果需要区分“仓库没有 Project”和“搜索没有匹配项”。
- 写操作失败时保留原数据，模态框保持打开或菜单关闭，并在页面顶部显示简短错误提示。
- 错误信息不显示堆栈、本机路径或原始 Electron 异常。
- 成功操作不使用永久提示；界面变化本身作为反馈。

## 10. 测试与验收

自动测试覆盖：

- Project 的 `pinned` 默认值、克隆与 Summary。
- 内存 Repository 的创建、重命名、置顶、删除和找不到项目。
- IPC 请求与响应运行时校验。
- 搜索、三种排序和置顶优先规则。
- 日期、来源数量与卡片颜色纯函数。

验证命令：

```bash
pnpm check
pnpm package
```

Electron 冒烟验收：

1. 默认显示舒展网格，切换到列表后四列对齐。
2. 搜索即时缩小结果，清空后恢复。
3. 三种排序正确，置顶始终优先。
4. 新建、重命名、置顶和删除立即反映到两种视图。
5. 重启应用后恢复初始示例数据。
6. `window.require` 仍为 `undefined`，Renderer 不能直接访问 Node.js。
7. 常用窗口宽度无横向溢出，无未处理控制台错误。

## 11. 非目标

- SQLite、JSON 或其他持久化。
- Project 工作区和卡片点击导航。
- Source 的增删改与详情。
- 协作者、权限和 `Role` 列。
- 跨进程事件推送、多窗口同步和撤销删除。
- 将搜索、排序或视图偏好保存到磁盘。

## 12. Git 交付

- 规格、后端契约、前端界面和文档分别使用中文提交。
- 每次提交前执行对应自测。
- 不纳入工作区原有的 `AGENTS.md` 与 `tsx教程.md`。
- 最终 push 前执行 `pull --rebase`，通过 SSH 将 `main` 推送到 `wu-tian807/learning-companion`。
