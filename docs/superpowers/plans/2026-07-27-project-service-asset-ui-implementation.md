# ProjectService 与 Asset UI 接入实施计划

> 依据：`docs/superpowers/specs/2026-07-27-project-service-asset-ui-design.md`
>
> 日期：2026-07-27

## 阶段一：ProjectService

1. 新增 `ProjectService`，组合 ProjectDatabase 与 AssetDatabase。
2. 实现 Project 打开、关闭和删除生命周期。
3. Project 删除 Handler 改由 Service 编排。
4. 覆盖当前 Project、其他 Project、幂等关闭和级联删除测试。
5. 独立提交 ProjectService。

## 阶段二：Asset IPC 与 Preload

1. 扩展共享 IPC 请求、响应和运行时校验。
2. 新增 Asset Handler，序列化 Asset 快照。
3. 实现文件选择器多选和批量添加部分成功结果。
4. Preload 暴露受限 Asset API 与拖拽文件路径解析能力。
5. 在 Main 初始化并注册/卸载 Handler。
6. 覆盖 IPC 校验、批量结果和文件选择测试。
7. 独立提交 Asset IPC。

## 阶段三：ProjectPage

1. 删除静态 Asset 演示数据。
2. 接入打开/关闭 Project 生命周期。
3. 左侧栏渲染真实 Asset、可用状态和当前选择。
4. 实现文件选择与拖拽批量添加。
5. 实现重命名、Relink、刷新、删除与确认交互。
6. 实现加载、失败、空列表、缺失、无权限、无效和暂不支持状态。
7. 覆盖选择规则和前端状态更新测试。
8. 独立提交 ProjectPage 接入。

## 阶段四：验证

1. 执行 `pnpm check`。
2. 执行 `pnpm smoke:native`。
3. 启动 Electron 并校对 Project 页面。
4. 执行 `pnpm package` 和 `pnpm verify:package:native`。
5. 更新设计文档状态并检查工作区。

## 约束

- 不实现具体媒体阅读器。
- 不递归导入文件夹。
- 不实现 URL 导入或跨 Project 移动。
- 不修改用户的 `AGENTS.md` 和教程草稿。
- 不执行 push，除非用户另行要求。
