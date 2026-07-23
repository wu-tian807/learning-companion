# Project 首页控件体验修订实施计划

> 依据：`docs/superpowers/specs/2026-07-23-project-home-polish-design.md`
>
> 日期：2026-07-23

## 阶段一：创建契约与 Main 默认图标

1. 修改共享 `CreateProjectRequest`，仅保留 `name`，同步运行时守卫和测试。
2. 修改 `CreateProjectInput`，由内存 Repository 创建时赋值 `📘`。
3. 修改新建弹窗和 Home 提交逻辑，删除所有用户图标输入与校验。
4. 更新 Repository 测试，确认创建请求无需图标且 Summary 自动包含 `📘`。
5. 执行 `pnpm check`，提交“功能：改由 Main 分配 Project 图标”。

## 阶段二：自绘排序菜单与按钮反馈

1. 将 `HomeToolbar` 的原生 `select` 替换为 React 浮层菜单。
2. 实现当前项勾选、箭头旋转、外部点击和 Escape 关闭。
3. 增强工具栏、三点菜单、弹窗、空状态和错误操作按钮的 hover/active 样式。
4. 在全局 CSS 中加入统一过渡和 reduced-motion 兜底。
5. 执行 `pnpm check`，提交“样式：增强首页控件交互反馈”。

## 阶段三：验证与交付

1. 执行 `pnpm package`。
2. 启动 Electron，截图检查排序菜单、新建弹窗和关键 hover 状态。
3. 实际创建 Project，确认请求不含图标且结果自动显示 `📘`。
4. 验证三个排序项、外部点击、Escape、无横向溢出和 `window.require` 为 `undefined`。
5. 修正后重新执行 `pnpm check` 与 `pnpm package`。
6. 更新 README 中的自动图标说明并单独提交。
7. 执行 `git pull --rebase origin main`，随后通过 SSH 推送并核对远端 HEAD。
