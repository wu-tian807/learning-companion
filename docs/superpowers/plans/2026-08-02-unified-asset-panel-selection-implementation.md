# 左右 Asset 面板选择能力统一实施计划

> 依据：`docs/superpowers/specs/2026-08-02-unified-asset-panel-selection-design.md`
>
> 日期：2026-08-02

## 1. 共享选择协调器

涉及文件：

- `src/renderer/project/use-asset-selection.ts`
- `src/renderer/project/use-asset-selection.test.ts`

步骤：

1. 将仅针对单集合的选择 Hook 收敛为 Scope-aware 协调器；
2. 定义 `imported | generated` 稳定 Scope；
3. 实现单活动 Scope、原子切换、过期 Scope 调用忽略和集合变更过滤；
4. 覆盖 enter、exit、toggle、toggleAll、replace、clear 及跨 Scope 行为测试。

## 2. AssetPanel 统一选择 UI

涉及文件：

- `src/renderer/project/AssetPanel.tsx`
- `src/renderer/project/AssetPanel.test.tsx`
- `src/renderer/project/AssetList.tsx`
- `src/renderer/project/AssetListItem.tsx`

步骤：

1. 定义共享 `AssetPanelSelectionModel`；
2. 由 `AssetPanel` 统一渲染选择/完成、已选数量、全选和批量移除；
3. 选择控制条放入列表区域，不替换普通业务工具；
4. 保留 `AssetList` 在选择模式切换行复选状态、隐藏三点菜单的现有行为；
5. 增加共享面板普通态与选择态契约测试。

## 3. 左右适配组件接入相同契约

涉及文件：

- `src/renderer/project/ProjectAssetPanel.tsx`
- `src/renderer/project/ProjectAssetPanel.test.tsx`
- `src/renderer/generation/GenerationCenter.tsx`
- `src/renderer/generation/GenerationCenter.test.tsx`

步骤：

1. 从 `ProjectAssetPanel` 删除专用选择 UI；
2. 左栏只保留导入、刷新与普通文案；
3. 右栏保留生成工具区；
4. 两侧都向 `AssetPanel` 传入同一种选择模型；
5. 用左右对称测试验证选择入口、控制条、行菜单隐藏和普通业务工具保留。

## 4. Project 删除编排去除左栏耦合

涉及文件：

- `src/renderer/project/use-project-assets.ts`
- `src/renderer/project/ProjectPage.tsx`
- 对应测试文件

步骤：

1. 分别投影 imported/generated Assets 到同一协调器；
2. 为两个面板生成 Scope-bound 选择模型；
3. 删除请求记录发起 Scope 与 Asset Snapshot；
4. 全成功退出发起 Scope；
5. 部分或全部失败只恢复发起 Scope 的失败项；
6. busy 和删除确认期间禁止选择 Scope 切换；
7. Project 切换时清空协调器；
8. 保持当前 Workbench 关闭与后继 Asset 选择逻辑不变。

## 5. 文档与验证

涉及文件：

- `TECH_STACK.md`
- 必要的现有设计文档状态说明

步骤：

1. 将“左栏批量选择”改为“所有 AssetPanel 共享选择能力”；
2. 记录单活动 Scope 和普通工具始终保留；
3. 执行针对性 Vitest；
4. 执行 `pnpm check`；
5. 检查生产源码依赖边界与 Git diff；
6. 功能代码和文档按独立粒度提交，不自动 push。
