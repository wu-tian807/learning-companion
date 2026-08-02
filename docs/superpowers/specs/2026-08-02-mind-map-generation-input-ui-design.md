# Mind Map 生成输入 UI 设计

> 日期：2026-08-02
>
> 状态：第二版交互已实施

## 1. 背景

生成中心已经展示真实的 generated Asset 列表，Mind Map 文件协议、Workbench、
Anchor 和 Asset Association 基座也已经落地。第一版生成输入界面通过禁用按钮要求
用户先选择来源；第二版把它调整为可点击的选择引导入口。

完整生成流程还需要通用 Task、Codex Creator Lane、上下文 Projection、结构化输出
校验、Generated Asset 提交和任务恢复。上述能力不在本轮提前实现。本轮只完成生成
前的来源选择确认与可选用户要求收集，为后续 Task 接入提供稳定的 Renderer 输入。

## 2. 目标

- 复用左侧 imported Asset 的现有显式选择状态；
- “思维导图”工具始终可点击；
- 未选择资料时，点击工具自动展开左侧资料栏并进入选择模式；
- 选择来源后点击工具，固定当前来源快照并在弹窗中再次确认；
- 收集可选的用户补充要求；
- 构造不包含正文的 `MindMapGenerationDraft`；
- 确认生成后退出并清空 imported Asset 选择状态；
- 保持左右 AssetPanel 解耦，不增加第二套来源选择状态。

## 3. 非目标

本轮不实现：

- GenerationTask、通用 Codex Task 或任务持久化；
- Agent Lane、Session、Thread 与 Projection 目录的最终关系；
- Codex Thread / Turn 调用和流式进度；
- Asset 正文读取、格式转换或上下文投影；
- Mind Map 结构化输出、文件写入和 Asset Association 提交；
- generating、failed 或 interrupted 任务列表；
- generated Asset 创建；
- 基于媒体类型的生成兼容性判断。

## 4. 方案选择

### 4.1 弹窗持有临时 Draft

点击工具时快照左侧选择，弹窗维护补充要求，关闭后丢弃。这一方案状态最少，且后续
可把确认回调直接接到 GenerationTask 创建入口。

本设计选择该方案。

### 4.2 ProjectPage 持久维护 Draft

该方案允许关闭弹窗后恢复输入，但当前没有恢复需求，会让页面承担不必要的生成表单
状态。

### 4.3 打开弹窗时预创建 Task

该方案可以立即持久化，但会在用户尚未确认时产生业务记录，并提前锁死尚未设计完成
的通用 Task 模型。

## 5. 数据模型

Renderer 使用 Provider 无关的轻量输入：

```ts
interface MindMapGenerationDraft {
  readonly projectId: string;
  readonly sourceAssetIds: readonly string[];
  readonly additionalInstructions?: string;
}
```

规则：

- `sourceAssetIds` 来自确认弹窗打开时固定的 imported Asset 快照；
- ID 去重并保持左侧选择顺序；
- 不增加冗余的 `sourceCount`，数量始终由 `sourceAssetIds.length` 得到；
- `additionalInstructions` 只执行首尾空白清理；
- 清理后为空时保存为 `undefined`；
- 不设置字数上限、字数提示或软警告；
- Draft 不包含 Asset 正文、文件路径、Revision 或 Provider DTO。

未来 Main 接收 Draft 后，再根据 Asset ID 校验 Project、解析内容、固定 Revision 并
构造 Codex 可读 Projection。本轮不定义该 IPC。

## 6. 选择状态与组件边界

现有 Project-scoped `useAssetSelectionCoordinator` 继续作为唯一选择状态，但不再
通过 `ProjectPage` 逐层传递选择模型。新增 Project 范围的 React Context：

```text
useAssetSelectionCoordinator
  → AssetSelectionCoordinatorProvider
      ├── ProjectAssetPanel
      │   └── useAssetSelectionScope("imported")
      └── GenerationCenter
          ├── imported.selectedAssets
          ├── imported.enter()
          └── coordinator.clear()
```

Provider 只覆盖当前 Project 页面，不能成为跨 Project 或应用级全局状态。
`ProjectAssetPanel` 和 `GenerationCenter` 分别直接消费自己需要的选择投影，
`ProjectPage` 不再传递 `selection` 或 `sourceAssets`。

选择控制器对 Context 消费者提供：

- `activeScope`：当前进入选择模式的面板；
- `imported` / `generated`：各自的选择投影与 `enter`、`exit`、`toggle`、
  `toggleAll` 能力；
- `clear()`：退出任何选择模式并清空勾选。

`GenerationCenter` 不引用 `ProjectAssetPanel`，左侧面板也不知道生成中心存在。
展开左栏属于布局行为，不进入选择 Context。`ProjectPage` 只向
`GenerationCenter` 提供 `onRevealSources` 页面布局回调。

当前 `generated` 面板选择仍用于生成内容的批量操作。选择协调器继续保证同一时间
只有一个 AssetPanel 进入选择模式；本轮不改变该规则。

## 7. 交互流程

```text
点击思维导图
→ 如果未选择 imported Assets
    → imported.enter()
    → 展开左侧资料栏
    → 不打开确认弹窗
→ 用户勾选 imported Assets 后再次点击思维导图
→ 固定 selectedAssets 快照
→ 打开确认弹窗
→ 查看来源清单并填写可选补充要求
→ 点击确认生成
→ 构造 Draft
→ 清空并退出选择模式
→ 关闭弹窗
```

本轮确认后不创建 Task、不调用 IPC、不显示伪造进度、不创建假 Asset。因为当前
Draft 回调是同步边界，Draft 构造成功即清空选择。未来接入异步 GenerationTask 后，
只能在 Main 成功创建任务后清空选择；创建失败时必须保留选择和用户输入。

取消或关闭弹窗时不清空选择，方便用户返回左侧继续调整。

如果弹窗打开后外部选择发生变化，已经打开的弹窗仍展示固定快照。后续真实提交时
由 Main 根据 ID 重新验证 Asset；Renderer 快照不成为事实来源。

## 8. 工具状态

“思维导图”工具始终保持可点击：

```text
selectedAssets.length === 0
  → 悬浮提示“至少选择一个 Asset”
  → 点击进入 imported 选择模式并展开左栏

selectedAssets.length > 0
  → 悬浮提示工具说明
  → 点击打开确认弹窗
```

- 不使用 `disabled` 表达“尚未选择来源”；
- 本轮不按 Availability 或媒体类型提前过滤；
- 其他通用生成工具继续保持禁用占位状态。

窄屏下左右覆盖栏保持互斥。为了让引导动作具备幂等语义，Project 布局控制器增加
`openLeft()`，而不是复用可能把已打开侧栏关闭的 `toggleLeft()`。小屏执行
`openLeft()` 时自动关闭右侧生成中心；宽屏和中屏只确保左栏处于展开状态。

## 9. 确认弹窗

新增 `MindMapGenerationDialog`，内容保持精简：

1. 标题“生成思维导图”；
2. 说明“确认用于生成的学习资料，并可补充你的要求”；
3. 已选资料数量；
4. 可滚动的只读资料列表，展示名称和媒体类型；
5. “补充要求（可选）”多行文本框；
6. “取消”和“确认生成”操作。

弹窗不提供复选框、单项移除或第二套全选能力。用户通过取消或关闭弹窗返回左侧修改
选择。输入框不显示字数，也不限制长度。

弹窗遵循现有模态交互：

- 提供明确的 Dialog 标题和描述；
- 支持 `Esc` 关闭；
- 打开后焦点进入弹窗；
- 关闭后焦点返回“思维导图”工具；
- 忙碌状态尚未存在，因此本轮没有取消中任务或重复提交状态。

## 10. 文件与职责

计划涉及：

```text
src/renderer/generation/
├── GenerationCenter.tsx
├── GenerationCenter.test.tsx
├── MindMapGenerationDialog.tsx
├── MindMapGenerationDialog.test.tsx
└── mind-map-generation-draft.ts

src/renderer/project/
├── asset-selection-context.ts
├── AssetSelectionCoordinatorProvider.tsx
├── ProjectAssetPanel.tsx
├── ProjectPage.tsx
├── use-project-assets.ts
├── use-project-layout.ts
└── use-project-layout.test.ts
```

- `asset-selection-context`：提供 Project-scoped 选择控制器及按 scope 读取 Hook；
- `ProjectPage`：安装 Provider，并只传递 `projectId` 与展开左栏回调；
- `ProjectAssetPanel`：直接读取 imported 选择模型；
- `use-project-layout`：提供幂等的 `openLeft()`；
- `GenerationCenter`：根据来源选择决定引导或打开弹窗，并持有本次来源快照；
- `MindMapGenerationDialog`：维护补充要求并提交 Draft；
- `mind-map-generation-draft.ts`：定义 Draft 及 ID 去重、输入规范化纯函数。

不修改 Main、Preload、共享 IPC、AssetService、Mind Map Workbench 或数据库。

## 11. 错误与边界

- 空来源不能打开确认弹窗；
- 未选择来源时重复点击工具不会退出左侧选择模式；
- 小屏从右侧生成中心切换到左侧资料栏时，不能同时保留两个覆盖栏；
- 重复 Asset ID 在 Draft 构造时去重；
- 空白补充要求转为 `undefined`；
- 弹窗关闭后清理本次输入和来源快照；
- 只有确认生成才清空选择，取消和遮罩关闭均保留选择；
- 弹窗打开期间来源 Snapshot 只用于展示，未来 Main 仍必须重新校验 ID；
- 当前阶段没有异步失败、额度、登录或生成错误。

## 12. 测试

纯函数测试：

- 保持来源顺序并去重；
- 规范化补充要求；
- 空白要求变为 `undefined`。

GenerationCenter 测试：

- 没有 imported 选择时工具仍然启用，并显示引导 Tooltip；
- 有选择时工具显示正常说明；
- 其他通用工具仍禁用；
- Dialog 打开状态显示固定来源数量。

选择 Context 与布局测试：

- imported / generated 消费者读取同一个协调器；
- `clear()` 退出选择模式并清空勾选；
- `openLeft()` 幂等打开左栏；
- 小屏 `openLeft()` 同时关闭右侧覆盖栏。

Dialog 测试：

- 静态渲染只读来源列表和媒体类型；
- 多行输入不存在 `maxLength`；
- Draft 纯函数产生正确请求数据。

当前 Vitest 使用 Node 环境，不为本轮额外引入浏览器测试依赖。打开、取消、确认、
焦点恢复和选择保持通过 Electron `pnpm dev` 手动验收。

完整验证执行 `pnpm check`。

## 13. 验收标准

- 左侧未选资料时，“思维导图”仍可点击；
- 未选择时点击工具会展开左栏并进入 imported 选择模式；
- 未选择时悬浮工具显示“至少选择一个 Asset”；
- 弹窗准确展示打开瞬间的来源数量与清单；
- 补充要求可以为空或输入任意长度文本；
- 确认后不出现假任务或假 Asset；
- 确认生成后退出并清空选择；
- 取消弹窗后选择保持不变；
- 现有 generated Asset 列表和两侧批量选择行为不回归；
- `pnpm check` 通过。
