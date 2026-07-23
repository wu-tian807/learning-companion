# Project 首页控件体验修订设计

> 状态：已确认
>
> 日期：2026-07-23
>
> 依据：`2026-07-23-project-home-interactions-design.md`

## 1. 目标

修正 Project 首页三个体验问题：新建 Project 时不应要求用户选择图标；排序控件不应调用与应用风格不一致的 macOS 原生弹层；所有按钮需要更明确的悬浮反馈。

本修订只调整创建契约和界面控件体验，不引入模型服务、SQLite 或新的 UI 依赖。

## 2. 自动图标边界

- 新建弹窗仅保留 Project 名称输入。
- Renderer 的 `CreateProjectRequest` 仅包含 `name`。
- Main 的 `CreateProjectInput` 仅包含 `name`。
- 当前内存 Repository 创建 Project 时统一分配占位图标 `📘`。
- 占位图标由 Main 决定，Renderer 不发送隐藏的默认图标。
- 后续模型接入时，在 Main 创建流程中用模型选择结果取代 `📘`，不重新向用户暴露图标输入。
- `Project` 领域对象与 `ProjectSummary` 继续保留 `icon`，因为既有 Project 仍需要展示图标。
- `PROJECT_ICON_MAX_CODE_POINTS` 继续用于领域数据校验，不再用于创建请求校验。

## 3. 自绘排序菜单

移除 `HomeToolbar` 中的原生 `select`，改为 React 控制的浮层菜单：

- 排序按钮使用 `aria-haspopup="listbox"` 和 `aria-expanded`。
- 浮层锚定在排序按钮下方右侧。
- 视觉使用与 Project 三点菜单一致的深色背景、边框、圆角和阴影。
- 菜单包含“最近创建”“最早创建”“标题”三项。
- 当前选中项显示勾选图标和选中背景。
- 点击选项后立即切换排序并关闭菜单。
- 点击菜单外部或按 `Escape` 关闭。
- 排序按钮右侧箭头在展开时旋转 180 度。
- 不引入 Radix、Headless UI 或其他依赖。

排序数据逻辑保持不变：置顶 Project 始终优先，组内遵循当前排序。

## 4. 统一悬浮反馈

按钮反馈按角色区分，但使用一致的动画节奏。

### 4.1 工具栏与次级按钮

悬浮时：

- 边框透明度明显提高。
- 背景从近透明提升为可见的白色叠层。
- 图标或文字颜色提亮。
- 控件向上移动 1px。
- 增加柔和阴影。

覆盖搜索、视图切换、排序、三点、弹窗取消、重试、清空搜索和空状态按钮。

### 4.2 主按钮

“新建 Project”、创建和保存按钮悬浮时使用更亮背景、向上移动 1px，并增加更明显的阴影。按下时恢复到原位置，形成可感知的按压反馈。

### 4.3 菜单项与危险操作

- 普通菜单项悬浮时整行使用清晰的浅色叠层。
- 删除菜单项悬浮时使用可见的红色背景和更亮的红色文字。
- 不使用位移，避免菜单文字在指针下抖动。

### 4.4 动效与无障碍

- 动画时长保持在 120–180ms。
- 键盘 `focus-visible` 轮廓不能被 hover 样式覆盖。
- 禁用按钮不响应位移、阴影和亮度变化。
- `prefers-reduced-motion: reduce` 时取消位移与过渡动画。

## 5. 组件与数据流

修改范围：

- `src/shared/ipc.ts`：创建请求移除 `icon`。
- `src/main/projects/project-repository.ts`：创建输入移除 `icon`。
- `src/main/projects/in-memory-project-repository.ts`：Main 分配 `📘`。
- `src/renderer/components/ProjectDialog.tsx`：移除图标状态、输入与校验。
- `src/renderer/components/HomeToolbar.tsx`：加入自绘排序菜单。
- 现有 Renderer 组件：统一增强按钮悬浮与按下反馈。
- `src/renderer/index.css`：提供 reduced-motion 兜底；不建立复杂设计系统。

成功创建数据流：

```text
用户输入名称
  -> Renderer 发送 { name }
  -> Main 校验创建请求
  -> InMemoryProjectRepository 分配 id、createdTime、sources: []、icon: "📘"
  -> 返回完整 ProjectSummary
  -> Renderer 展示新卡片或列表行
```

## 6. 错误处理

- 名称为空或超过 80 字符时仍在表单内提示。
- 创建响应与写操作失败规则保持不变。
- 排序菜单是纯本地状态，不产生后端错误。
- 自绘菜单卸载时必须清理文档事件监听器。

## 7. 测试与验收

自动测试覆盖：

- 创建请求只接受名称，不再要求或接受图标作为必要字段。
- Repository 创建的新 Project 自动得到 `📘`。
- 既有 Project 图标与 Summary 校验不受影响。

验证命令：

```bash
pnpm check
pnpm package
```

Electron 视觉与交互验收：

1. 新建弹窗只显示名称。
2. 新建成功的 Project 自动显示 `📘`。
3. 点击排序按钮显示应用内深色菜单，不出现系统原生弹层。
4. 当前排序项具有明确选中标记。
5. 点击外部和 `Escape` 可关闭排序菜单。
6. 工具栏、三点菜单、弹窗和空状态按钮的 hover/active 反馈清晰一致。
7. 页面无横向溢出，Renderer 仍无 Node.js 权限。

## 8. 非目标

- 调用模型生成或选择 Emoji。
- 允许用户编辑 Project 图标。
- 持久化图标、排序或视图偏好。
- 引入通用组件库或完整设计令牌系统。
- 修改 Project 卡片的数据内容和列表列结构。
