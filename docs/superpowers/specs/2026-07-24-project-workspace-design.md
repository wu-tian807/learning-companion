# Project 工作区前端骨架设计

> 2026-08-30 更新：本文中的“当前 Asset 工具”已由
> [Workbench 生成中心 Surface 移除设计](./2026-08-30-workbench-generation-center-surface-removal-design.md)
> 取代；媒体专用操作留在 Workbench 内。

## 目标

为单个 Project 建立独立于 `Home.tsx` 的工作区页面，并把已经确认的可视化方案迁入真实 React 应用。

首版只完成页面骨架和 Home/Project 页面导航：

- 左侧是 Project 内全部 Asset 的预选栏。
- 中间是占据主要空间的 Asset 阅读器容器。
- 右侧是生成中心。
- 页面默认比例为 `2 : 6 : 2`。
- Project 标题和图标使用现有真实 Project 数据。
- Asset、阅读器、生成工具暂不接 Main、IPC 或 SQLite。

## 选定方案

设计阶段比较了三种右栏结构：

- 阅读工作台：强调当前选区和最近活动。
- 生成工具箱：强调从现有内容生成新 Asset。
- 任务流程：强调分步骤配置和生成。

最终选择生成工具箱，并将它定义为“生成中心”。理由是产品核心并非持续聊天，而是围绕学习资料生成和沉淀新的学习资产；生成中心比 Chat 或活动流更符合该定位。

## 页面层级

```text
App
├── Home
│   └── Project 卡片 / Project 列表行
└── ProjectPage
    ├── Project 标题栏
    └── 2 : 6 : 2 工作区
        ├── Asset 预选栏
        ├── Asset 阅读器容器
        └── 生成中心
```

`ProjectPage.tsx` 是独立页面，不把 Project 工作区逻辑继续堆入 `Home.tsx`。

## 导航

首版不引入 React Router。`App.tsx` 维护当前打开的 Project：

```ts
type AppPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly project: ProjectSummary };
```

导航流程：

1. Home 加载真实 Project 列表。
2. 点击舒展卡片或列表行，将对应 `ProjectSummary` 交给 `App`。
3. `App` 渲染 `ProjectPage`。
4. Project 标题栏返回按钮回到 Home。
5. 回到 Home 后由现有 Home 生命周期重新加载 Project 和 Settings。

这是本地 UI 状态，不写入 Settings。应用重启后从 Home 开始。等需要深链接、窗口恢复或多页面历史时，再引入正式路由。

三点菜单必须阻止事件冒泡；点击编辑、置顶或删除不能同时进入 Project。

## 页面布局

页面使用全屏深色工作区，不再保留设计预览中的 A/B/C 比较栏。

### Project 标题栏

标题栏保持紧凑，只包含：

- 返回 Home。
- Project 图标。
- Project 名称。
- Asset 数量和最近学习时间的展示占位。
- 右侧设置按钮。

顶栏不重复提供搜索或“添加资料”。添加资料只出现在左栏，避免重复入口。

设置按钮首版仅作为视觉占位，不打开设置界面。

### 三栏

桌面默认比例：

```text
Asset 预选栏 : 阅读器 : 生成中心 = 2 : 6 : 2
```

实现使用带最小宽度的 CSS Grid：

```css
minmax(220px, 2fr)
minmax(560px, 6fr)
minmax(220px, 2fr)
```

三栏间距为 12px，页面边缘留白约 15px。页面本身不滚动，每个面板未来独立管理内部滚动。

首版面向桌面宽度，不实现移动端布局。窗口不足最低宽度时允许工作区保持最小尺寸，由后续响应式设计单独处理。

## Asset 预选栏

左栏包含：

- `Assets` 标题和数量。
- “添加资料”入口。
- Project 内搜索外观。
- “全部内容”标签。
- “最近使用”排序状态。
- Asset 列表。

可见文案使用“添加资料”，数据和代码内部继续使用 `Asset`。

Asset 列表按最后使用时间从近到远排列。每项展示：

- 类型图标。
- 标题。
- 类型。
- 最后使用时间。

本阶段 Asset 数据使用 `ProjectPage.tsx` 内隔离的展示数据，不读取或修改用户正在设计的 `src/main/assets/` 和 `src/main/sources/`。添加、搜索、排序和选择都只搭建外观，不建立持久化行为。

## 阅读器容器

中栏是媒体预览器的宿主，不在本阶段实现 Markdown、PDF 或其他媒体渲染。

标题栏只包含：

- 当前 Asset 名称。
- 当前媒体类型标记，例如 `Markdown`。
- `…` 扩展入口。

不保留“编辑”按钮。

`…` 是未来预览器专属操作的统一挂载点。Markdown、PDF、EPUB 等预览器可以提供不同菜单项，但当前不定义菜单协议或菜单内容。

阅读器正文保持完全空白，不加入：

- Markdown 示例内容。
- PDF 占位页面。
- 选区问答工具条。
- AI 回答气泡。
- 知识点插入演示。
- 空状态插画或说明。

这样可确保后续每种媒体的阅读、选区和 AI 固化能力能够独立设计，不被当前演示结构绑死。

## 生成中心

右栏固定称为“生成中心”，分为两块。

### 生成新的 Asset

这是全局工具区域，不依赖当前阅读器的具体实现。首版展示以下禁用入口作为结构占位：

- 思维导图。
- 学习提纲。
- 知识卡片。
- 测验。
- 摘要。
- 演示文稿。

这些按钮当前不调用 AI，也不创建 Asset。

### 当前 Asset 工具

这是媒体类型相关的生成能力区域，与中栏 `…` 的预览器操作不同：

- 中栏 `…` 管理阅读器本身的操作。
- 当前 Asset 工具管理基于该 Asset 生成或修改学习内容的能力。

首版保留 Markdown 示例入口作为视觉占位：

- 插入知识补充。
- 生成章节摘要。
- 优化当前段落。

入口不执行操作。未来由 Asset 类型和对应能力声明动态决定展示内容。

生成中心不包含“生成范围”或“最近生成”。跨 Asset 选择与生成历史不是本轮需求。

## 组件边界

新增：

```text
src/renderer/ProjectPage.tsx
```

修改：

```text
src/renderer/App.tsx
src/renderer/Home.tsx
src/renderer/components/ProjectGrid.tsx
src/renderer/components/ProjectList.tsx
src/renderer/components/ProjectActionsMenu.tsx
```

首版保持单个 `ProjectPage.tsx`，不提前拆分 AssetList、ReaderHost 或 GenerationCenter。等其中任一部分获得真实状态、IPC 或媒体能力后，再按职责拆分。

`ProjectPage` 接口：

```ts
interface ProjectPageProps {
  readonly project: ProjectSummary;
  readonly onBack: () => void;
}
```

Home 接收：

```ts
interface HomeProps {
  readonly onOpenProject: (project: ProjectSummary) => void;
}
```

ProjectGrid 和 ProjectList 将同一回调传递给各卡片和行。

## 交互与可访问性

- Project 卡片和列表行支持鼠标点击进入。
- Project 卡片和列表行支持 Enter、Space 键进入。
- 点击三点菜单及菜单项不会触发页面导航。
- 返回按钮提供明确的 `aria-label`。
- 阅读器 `…` 提供“预览器操作”标签，但当前不打开菜单。
- 尚未接线的工具使用 `aria-disabled` 和视觉占位样式，不产生误导性成功反馈。
- 所有悬浮和按压状态复用当前 UI token。

## 数据边界

本轮唯一真实数据是从 Home 传入的 `ProjectSummary`。

以下内容均为 Renderer 展示数据：

- Asset 列表。
- 最近使用时间。
- 当前 Asset。
- 全局生成工具。
- Markdown 专属工具。

本轮不增加：

- Asset IPC。
- Asset SQLite 表。
- Source 读取。
- 文件选择器。
- 阅读进度持久化。
- 生成任务。
- LLM 调用。
- Settings 新字段。

## 错误与空状态

Home 已经保证只有成功加载的 Project 才能被打开，因此 ProjectPage 首版不单独重新查询 Project。

如果传入的 Project 数据存在，页面始终可以渲染。Asset 展示数据未来移除后，左栏空状态将在 Asset 后端设计中单独定义；本轮不提前设计。

## 测试与验证

### 静态与逻辑检查

- `pnpm typecheck`。
- `pnpm lint`。
- `pnpm test`。
- 新增纯导航状态或事件传播测试时，不引入重量级路由库。

### 视觉验证

- 舒展卡片和列表行都能进入 ProjectPage。
- 返回按钮能回到 Home。
- 三点菜单不会误触进入。
- Project 图标和名称来自点击的 Project。
- 页面比例接近 `2 : 6 : 2`。
- 中间阅读器正文为空。
- 阅读器标题栏只保留媒体标记与 `…`。
- 右栏同时显示全局工具和当前 Asset 工具。
- 常用桌面窗口宽度下没有非预期横向溢出。

### 构建验证

- `pnpm check` 通过。
- `pnpm package` 通过。
- Electron 实际启动后完成 Home → ProjectPage → Home 导航。

## 验收标准

- 新页面位于独立的 `ProjectPage.tsx`。
- Home 和 ProjectPage 可以双向切换。
- 页面使用已确认的全屏 `2 : 6 : 2` 三栏布局。
- 左栏使用“添加资料”文案并展示最近使用排序。
- 中栏内容完全空白。
- 中栏标题栏只有媒体类型和 `…` 扩展入口。
- 右栏是两部分组成的生成中心。
- 没有接入 Asset、Source、预览器或 AI 后端。
- 用户现有的 Asset/Source 草稿未被修改。
