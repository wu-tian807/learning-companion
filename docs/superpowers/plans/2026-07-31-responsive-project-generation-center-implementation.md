# Project 响应式布局与生成内容栏实施计划

> 依据：`docs/superpowers/specs/2026-07-31-responsive-project-generation-center-design.md`
>
> 日期：2026-07-31

## 实施原则

- `AssetCreationKind` 首版只包含 `imported | generated`。
- SQLite 字段是 Asset 创建类型的事实源，目录只保持语义一致。
- 不伪造生成 Asset；右侧列表只展示真实数据。
- 左右列表复用 Asset 列表项和操作菜单，不复制业务行为。
- 响应式状态只存在 Renderer 内存，不进入 Settings。
- 每个阶段完成相应测试后独立提交。
- 不暂存用户的 `AGENTS.md` 与 `tsx教程.md`。

## 阶段一：Asset 创建类型与数据库迁移

### 修改或新增

- `src/shared/assets.ts`
- `src/main/assets/asset.ts`
- `src/main/assets/asset-database.ts`
- `src/main/assets/asset-service.ts`
- `src/main/database/schema/assets.ts`
- `src/main/database/migrations/0008-add-asset-creation-kind.ts`
- `src/main/database/initialize-database.ts`
- 对应 Asset、数据库初始化与共享契约测试

### 步骤

1. 定义 `AssetCreationKind = 'imported' | 'generated'` 及运行时守卫。
2. 为 `Asset`、克隆、创建输入和数据库 Row 映射增加 `creationKind`。
3. 新增版本 8 迁移，为历史数据写入 `imported` 并约束合法值。
4. 本地文件导入路径显式传入 `creationKind: 'imported'`。
5. 保留通用 AssetDatabase 创建入口，使后续生成服务可以传入 `generated`。
6. 测试迁移、非法值、读写往返、克隆和本地导入默认分类。
7. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
数据库：增加 Asset 创建类型
```

## 阶段二：共享 Asset 列表与相对时间

### 新增

- `src/renderer/project/AssetList.tsx`
- `src/renderer/project/AssetListItem.tsx`
- `src/renderer/project/relative-time.ts`
- 对应组件与纯函数测试

### 修改

- `src/renderer/project/ProjectAssetPanel.tsx`
- `src/renderer/project/AssetActionsMenu.tsx`
- `src/renderer/project/project-asset-view.ts`
- 现有 ProjectAssetPanel 测试

### 步骤

1. 从 ProjectAssetPanel 抽取单个 Asset 行为到 `AssetListItem`。
2. 抽取集合渲染、空状态和可选选择模式到 `AssetList`。
3. 保持 Availability 红色状态、来源徽标、键盘激活和选中态。
4. 两侧继续共用现有 `AssetActionsMenu`。
5. 实现确定性的 `formatRelativeTime(value, now)`：
   - `just now`
   - `N min(s) ago`
   - `N hr(s) ago`
   - `N day(s) ago`
6. 长时间跨度仍显示天数，不回退到绝对日期。
7. ProjectAssetPanel 只保留导入、批量选择、刷新和加载状态外壳。
8. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
重构：复用 Asset 列表与相对时间
```

## 阶段三：真实生成内容列表

### 修改

- `src/renderer/generation/GenerationCenter.tsx`
- `src/renderer/generation/GenerationCenter.test.tsx`
- `src/renderer/project/ProjectPage.tsx`
- 必要的 ProjectPage 纯逻辑或组件测试

### 步骤

1. ProjectPage 按 `creationKind` 生成 `importedAssets` 和 `generatedAssets`。
2. 左侧 ProjectAssetPanel 只消费导入 Asset。
3. GenerationCenter 接收真实生成 Asset、选中 ID 和现有 Asset 操作回调。
4. 删除“当前资料上下文”卡片及只为其服务的渲染逻辑。
5. 保留通用生成工具与 Workbench `generation-center` Contributions。
6. 在下方渲染共享 AssetList，按 `lastUsedTime` 降序。
7. 点击生成 Asset 后使用同一个 `selectedAssetId` 打开中间 Workbench。
8. 右侧 `...` 使用与左侧相同的重命名、显示、重新定位和删除流程。
9. 无生成 Asset 时显示真实空状态。
10. 顶栏分别显示导入资料数与生成内容数。
11. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
功能：接入生成 Asset 列表
```

## 阶段四：响应式 Project 页面与固定图标操作

### 新增

- `src/renderer/project/use-project-layout.ts`
- `src/renderer/project/ProjectHeaderActions.tsx`
- 对应 Hook 和组件测试

### 修改

- `src/renderer/project/ProjectPage.tsx`
- `src/renderer/index.css`（只增加确有必要的通用 Tooltip 或抽屉样式）
- 相关 Renderer 测试

### 步骤

1. 移除 `min-w-[1080px]` 和固定 `2:6:2` 网格。
2. 集中定义宽、中、小三种窗口模式与断点。
3. 实现默认状态：
   - 宽屏左右展开；
   - 中屏左开右关；
   - 小屏左右关闭。
4. 模式内允许手动开关；跨模式时应用该模式默认值。
5. 宽屏侧栏使用有最大宽度的内联网格，中小屏使用覆盖抽屉。
6. 小屏左右抽屉互斥。
7. 实现遮罩、`Esc` 关闭与焦点恢复。
8. 顶栏固定提供学习资料、生成中心、打开工作区和设置四个图标。
9. 图标按钮具有动态 `aria-label`、`aria-expanded`、Tooltip 和焦点样式。
10. 极窄窗口操作区换行，不隐藏任何按钮。
11. 接入现有 `openProjectWorkspace` Preload API，并使用统一错误弹窗反馈失败。
12. 让 Workbench 容器使用剩余空间和 `min-width: 0`，不修改各 Workbench 内部缩放状态。
13. 模拟 `matchMedia` 覆盖三种默认状态、手动覆盖、模式切换和互斥规则。
14. 执行相关 Vitest、`pnpm typecheck` 和 `git diff --check`。

### 提交

```text
功能：实现 Project 响应式侧栏
```

## 阶段五：完整回归与视觉验收

### 步骤

1. 执行 `pnpm check`。
2. 执行生产构建。
3. 启动 Electron，使用真实 Project 数据验证：
   - 宽屏三栏；
   - 中屏右侧抽屉；
   - 极窄窗口双抽屉；
   - 四个顶栏按钮始终可见；
   - 无横向滚动；
   - PDF/Office、Markdown、纯文本等 Workbench 能随容器继续工作。
4. 验证左右列表名称、错误状态、相对时间和菜单一致。
5. 验证数据库升级后历史 Asset 全部位于左侧。
6. 验证右侧空状态，不加入测试假数据。
7. 修复验收问题后重新运行相关测试、`pnpm check` 和生产构建。
8. 更新 `TECH_STACK.md` 中 Project 页面、Asset 创建类型和生成中心现状。

### 提交

```text
文档：更新 Project 与生成中心架构
```

## 最终交付约束

- 不实现真实生成服务和生成 IPC。
- 不实现 `assetLink` 或 Asset Relation 写入。
- 不新增布局 Settings 字段。
- 不新增拖拽分隔条。
- 不加入 `authored`。
- 不执行 push，除非用户另行要求。

## 2026-08-01 共享面板纠偏

后续验收发现只复用 `AssetList` 仍会让两侧分别维护标题、计数、加载状态和排序，
并实际造成左侧未跟随 `updatedTime` 重排。纠偏后的边界为：

1. 新增 `AssetPanel`，统一拥有完整文件面板及排序行为；
2. `ProjectAssetPanel` 只注入导入、刷新和批量选择控件；
3. `GenerationCenter` 只注入生成工具区；
4. `AssetList` 统一实现重排位移和新增淡入动画，并尊重减少动态效果设置；
5. 左右侧都通过同一个 `AssetLoadState -> AssetPanel` 路径渲染，禁止分别排序。
