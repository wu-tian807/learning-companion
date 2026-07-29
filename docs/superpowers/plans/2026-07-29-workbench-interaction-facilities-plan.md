# Workbench 可选交互设施实施计划

> 日期：2026-07-29
>
> 对应设计：
> `docs/superpowers/specs/2026-07-29-workbench-interaction-facilities-design.md`

## 实施原则

- 每个阶段单独自测、单独提交。
- 不改变各 Workbench 的媒体语义和现有编辑/阅读能力。
- 不在本轮实现截图、录屏或 AI 服务，只验证新 Facility 可以无侵入扩展。
- Renderer 不获得 Node.js、文件系统或任意 IPC 能力。
- HTML 沙箱继续不使用 `allow-same-origin`。
- 未经用户要求不 push。

## 阶段一：Facility 契约与 Definition Registry

### 新增文件

- `src/shared/workbench/facilities/facility-declaration.ts`
- `src/shared/workbench/facilities/facility-definition.ts`
- `src/shared/workbench/facilities/facility-definition-registry.ts`
- `src/shared/workbench/facilities/core-facilities.ts`
- 对应测试文件

### 修改文件

- `src/shared/workbench/manifest.ts`
- `src/main/workbench/workbench-registry.ts`
- `src/renderer/workbench/renderer-workbench-registry.ts`
- 所有 `src/workbenches/*/shared.ts` 内置 Manifest
- 相关 Registry 与 Manifest 测试

### 行为

1. 定义 `WorkbenchFacilityDeclaration`：
   - `id`
   - `version`
   - 可选 JSON `options`
2. 定义 `WorkbenchFacilityDefinition`：
   - role
   - options/event validator
   - Input cardinality
   - 依赖校验
3. 实现 `WorkbenchFacilityDefinitionRegistry`：
   - 重复注册拒绝；
   - 未知版本拒绝；
   - Manifest Declaration 语义校验；
   - Facility 查询；
   - 测试专用 Definition 注册和注销。
4. 注册首批 Core Facility：
   - `core.transport.renderer@1`
   - `core.transport.sandbox-frame@1`
   - `core.surface.overflow@1`
   - `core.surface.context-menu@1`
   - `core.input.text-selection@1`
5. Main 和 Renderer Workbench Registry 注入同类 Definition Registry。
6. 所有内置 Manifest 明确声明自身 Facilities。

### 测试

- Declaration 结构校验；
- Definition 重复 ID/Version；
- 未知 Facility；
- Options 与 Transport 依赖；
- Main/Renderer Registry 拒绝无效 Manifest；
- 测试 Facility 可注册并参与校验。

### 提交

`功能：建立 Workbench Facility 契约`

## 阶段二：开放 Interaction Input Envelope

### 修改文件

- `src/shared/workbench/interaction.ts`
- `src/shared/workbench/selection.ts`
- `src/renderer/workbench/renderer-workbench-registry.ts`
- `src/renderer/workbench/host/AssetWorkbenchHost.tsx`
- `src/renderer/workbench/runtime/workbench-runtime.ts`
- `src/renderer/workbench/runtime/workbench-runtime-store.ts`
- `src/renderer/workbench/editor/*`
- 所有内置 Workbench Renderer 与 Adapter
- 相关测试

### 行为

1. 用以下模型替换固定 Selection 字段：
   - `focus?: ContentAnchorTarget`
   - `inputs: readonly WorkbenchInteractionInput[]`
2. Text Selection 变成
   `core.input.text-selection@1` Input。
3. 提供类型化 Helper：
   - `createTextSelectionInput()`
   - `findTextSelectionInput()`
   - `textSelectionFromInteraction()`
4. `RendererWorkbenchViewProps.onSelectionChange()` 改为
   `onInteractionChange()`。
5. `AssetWorkbenchHost` 成为持续 Interaction 的唯一 Runtime 发布入口。
6. Runtime 激活时绑定当前 Workbench Manifest，并检查：
   - Input Facility 已声明；
   - Payload 通过 Definition Validator；
   - cardinality 合法；
   - Overflow/Context Menu Contribution 已声明对应 Surface。
7. Workbench 不再直接调用 `runtime.publishInteraction()`。
8. Audio/Video 当前时间只写入 `focus`，不再生成伪 Text Selection。

### 测试

- Text Selection Helper；
- 测试 Region Selection Facility 不修改 Runtime 即可发布；
- 未声明 Input 被拒绝；
- 多 Input cardinality；
- 旧 Session Interaction 被拒绝；
- 右键菜单冻结开放 Envelope；
- Plain Text、Markdown、PDF、EPUB 选区回归；
- Image、Audio、Video Focus 回归。

### 提交

`重构：统一 Workbench Interaction 输入`

## 阶段三：Main Transport Binding 与通用 Facility Event

### 新增文件

- `src/shared/workbench/facilities/transport-binding.ts`
- `src/shared/workbench/facilities/facility-event.ts`
- `src/main/workbench/interaction/workbench-transport-binding-registry.ts`
- `src/main/workbench/interaction/main-facility-adapter-registry.ts`
- `src/main/workbench/interaction/sandbox-frame-interaction-bridge.ts`
- 对应测试

### 修改文件

- `src/main/workbench/workbench-session.ts`
- `src/main/workbench/workbench-session-manager.ts`
- `src/main/window.ts`
- `src/main/index.ts`
- `src/shared/ipc.ts`
- `src/preload/index.ts`
- `src/types/electron.d.ts` 或当前 Window API 类型位置
- 相关测试

### 行为

1. `WorkbenchProviderOpenResult` 可返回 Main-only
   `WorkbenchTransportBinding[]`。
2. Session Manager：
   - Provider 打开成功后注册 Binding；
   - Session 关闭、替代或失败时注销；
   - Binding 注册失败时完整回滚 Provider 与 Content Handle。
3. Transport Binding Registry：
   - 校验 Transport 与 Facility 已在 Manifest 声明；
   - 以 Session 为作用域；
   - 返回幂等 Dispose；
   - 拒绝重复、过期和未授权绑定。
4. `SandboxFrameInteractionBridge`：
   - 附着 BrowserWindow WebContents；
   - 按根 Frame 父链解析 Session；
   - 调用已注册 Main Facility Adapter；
   - 发送通用 `WorkbenchFacilityEvent`；
   - 去重、限制长度、清理 Session/Window 缓存。
5. Preload 只暴露
   `onWorkbenchFacilityEvent(listener)`。
6. 暂时保留 HTML 旧通道，直到阶段四迁移完成。

### 测试

- Binding 生命周期、重复注册和回滚；
- Frame 归属与相似 URL 拒绝；
- 跨 Session 事件拒绝；
- Event Envelope/Payload 校验；
- Frame 销毁与采集异常；
- Preload 监听清理。

### 提交

`功能：建立 Workbench 沙箱交互通道`

## 阶段四：HTML 迁移并删除专用 IPC

### 修改文件

- `src/workbenches/html/main.ts`
- `src/workbenches/html/shared.ts`
- `src/workbenches/html/renderer.tsx`
- `src/workbenches/html/renderer-actions.ts`
- `src/main/window.ts`
- `src/shared/ipc.ts`
- `src/preload/index.ts`
- 相关测试

### 删除文件

- `src/main/html-context-menu.ts`
- `src/main/html-context-menu.test.ts`

### 行为

1. HTML Provider 返回 Sandbox Frame Transport Binding。
2. HTML Renderer 订阅通用 Facility Event 并过滤 Session。
3. Text Selection Event：
   - 映射为 `html.quote` Anchor；
   - 立即发布 Interaction；
   - 不依赖右键菜单。
4. Context Menu Event：
   - 映射文字、链接和媒体上下文；
   - 打开统一 Context Menu Host；
   - 保留现有 HTML Actions。
5. 删除 `htmlContextMenu` IPC 和旧 Main Window 监听路径。

### 测试

- 滑选完成但不右键时 Interaction 已更新；
- 空 Selection 清理；
- 右键菜单上下文和 Action 回归；
- 嵌套 Frame 与 Session 过滤；
- HTML 沙箱属性不变化。

### 提交

`重构：迁移 HTML Workbench 交互设施`

## 阶段五：EPUB 右键菜单与全量验收

### 新增文件

- `src/workbenches/epub/renderer-actions.ts`
- 对应测试

### 修改文件

- `src/workbenches/epub/renderer.tsx`
- `src/workbenches/epub/shared.ts`
- 内置 Workbench Facility 契约测试

### 行为

1. EPUB 声明 Renderer Transport、Context Menu 和 Text Selection。
2. 使用 epub.js 已有 CFI Selection 作为 Interaction Input。
3. 增加基础右键 Actions：
   - 复制选区；
   - 重新加载；
   - 在文件夹中显示；
   - AI Action 分组占位。
4. 没有文字选区时，选区 Action 禁用。
5. 补齐所有内置 Workbench 的 Facility 矩阵测试。

### 测试

- EPUB Context Menu 打开与关闭；
- CFI Anchor 保留；
- Selection Action Enablement；
- 所有内置 Workbench Manifest/Contribution 一致；
- `pnpm check`；
- `pnpm package`；
- Electron 人工冒烟：Plain Text、Markdown、PDF、HTML、EPUB、Image、
  Audio、Video。

### 提交

`功能：完善 EPUB 交互设施`

## 完成标准

- 新增测试 Facility 不需要修改 Manifest、Runtime 或 Preload 类型。
- HTML 选区在右键前已进入 Runtime。
- 所有 Workbench 的 Surface/Input/Transport 都能从 Manifest 直接判断。
- Session 切换不会残留菜单、Input、Binding 或 Frame 监听。
- 现有编辑、阅读、保存、恢复、媒体播放和文件操作功能无回退。
- 所有自动检查和打包通过。
