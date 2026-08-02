# Workbench Renderer 生命周期稳定性设计

> 日期：2026-08-02
>
> 状态：已确认，等待实施

## 1. 背景

Project 左右 Asset 面板共享选择协调器。用户进入或退出选择模式时，选择状态会让
`ProjectPage` 正常重新渲染。中间 Workbench 应当允许这种普通 React 重渲染，且不
关闭 Main Workbench Session、不销毁重型 Renderer Adapter，也不丢失阅读位置。

当前 Office Workbench 在渲染时现场创建传给 PDF 文档视图的 `bootstrap` 和
`payload`。即使内容未变化，每次父组件重渲染也会产生新的对象引用。PDF 文档视图
又把整个 `payload` 对象作为 Adapter 创建 Effect 的依赖，因此会执行清理并重新创建
PDF Adapter。用户看到的现象类似 Workbench Session 重开，但实际主要发生在
Renderer Adapter 层。

## 2. 目标

- 选择模式、侧栏开关和其他无关页面状态变化不会重建当前 Workbench Renderer；
- Office 派生的 PDF 预览只在真实资源身份变化时重建；
- Main Workbench Session 继续只由现有 Host 生命周期管理；
- 保持当前调用链，不增加 Store、Manager、Projection 或新的生命周期抽象；
- 用回归测试明确普通重渲染与资源重建之间的边界。

## 3. 非目标

- 不迁移选择状态的位置；
- 不重构所有 Workbench Renderer；
- 不改变 Workbench Bootstrap、IPC 或 Main Provider 契约；
- 不引入 `React.memo` 作为正确性机制；
- 不改变 PDF 阅读状态的持久化语义。

## 4. 保持不变的调用链

```text
ProjectPage
→ AssetWorkbenchHost
→ OfficeWorkbenchView
→ PdfDocumentWorkbenchView
→ PdfViewerAdapter
```

`AssetWorkbenchHost` 继续使用现有 `projectId + assetKey` 管理 Main Session。
选择状态不会改变这两个值，因此普通父组件重渲染不得调用 `closeWorkbench` 或再次
调用 `openWorkbench`。

## 5. Renderer 重建边界

### 5.1 Office 到 PDF 的稳定桥接

`OfficeWorkbenchView` 使用 `useMemo` 创建派生的 PDF Bootstrap。只有当前 Session
或已准备好的 Office 预览内容发生真实变化时，才创建新的派生对象。

派生内容包括：

- 原 Bootstrap 的 Session 身份；
- Artifact 的 `contentUrl`；
- 本次 Session 的初始 PDF `viewState`。

普通操作回调或父组件 UI 状态变化不得改变该对象引用。

### 5.2 PDF Adapter 的语义依赖

PDF Adapter 的创建与销毁由稳定的资源身份驱动：

```text
bootstrap.sessionId + payload.contentUrl
```

初始 `viewState` 只在创建本次 Adapter 时读取。翻页、缩放、侧栏、搜索和后续状态
持久化不构成资源身份变化，不能导致 Adapter 重建。

当前 PDF Workbench 的 `payload` 来自不可变的 Session Bootstrap，本身已经是稳定
资源描述。Office 桥接修复后也满足同一约束，因此本次不改写 PDF Adapter Effect；
避免为了拆分依赖再引入额外 Ref 或同步逻辑。

如果未来允许同一 Session 原地切换 `contentUrl`，应先修改 Bootstrap 契约或显式
重开 Session，不能通过每次 React 渲染都创建新 `payload` 的方式隐式驱动 Adapter。

### 5.3 现有其他 Workbench

本次审计发现 Audio、Video、Image、HTML、EPUB、Markdown 等 Workbench 也会从
Bootstrap 读取各自的 `payload`，但当前没有像 Office 一样在父级每次渲染时重新
创建 Bootstrap 对象。本次不对它们进行预防性重构。

以后若一个 Workbench 复用另一个 Workbench 的 Renderer，桥接层必须保持派生
Bootstrap 的引用稳定，重型 Adapter 的 Effect 必须依赖资源的语义身份。

## 6. 测试

### 6.1 Host Session 回归

打开一个 Asset Workbench 后，以新的普通操作回调重新渲染 Host，验证：

- `openWorkbench` 仍只调用一次；
- `closeWorkbench` 未调用；
- Session ID 不变。

这覆盖 ProjectPage 因选择、侧栏或弹窗状态发生普通重渲染的情况。

### 6.2 Office 桥接回归

渲染已完成预处理的 Office Workbench，再用无关 Props 重新渲染，验证传给 PDF
文档视图的派生 Bootstrap 引用保持不变，且内容仍对应同一个 Session 和
`contentUrl`。

当 `contentUrl` 或 Session 身份真实变化时，允许产生新的派生 Bootstrap。

## 7. 实施范围

生产代码只修改：

- `src/workbenches/office/renderer.tsx`。

测试修改限定在 Office 和 Workbench Host 测试中。不新增领域对象、状态容器或
跨模块生命周期服务，也不改动 PDF Renderer 生产实现。

## 8. 验收标准

- 打开 PPT/PPTX/DOC/DOCX 预览后，进入和退出左右面板选择模式，页面不闪回加载态；
- PDF 页码、缩放和滚动位置保持不变；
- Main Session 不重复打开或关闭；
- 切换到另一 Asset 或资源 URL 确实变化时，工作台仍能正常重建；
- `pnpm check` 通过。
