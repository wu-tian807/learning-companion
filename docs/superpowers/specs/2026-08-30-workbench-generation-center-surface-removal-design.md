# Workbench 生成中心 Surface 移除设计

> 状态：已确认
>
> 日期：2026-08-30

## 决策

Project 右侧生成中心只承载 Project 级通用生成工具、GenerationTask 状态和生成
Asset 列表，不再展示“当前 Asset 工具”，也不再消费 Workbench Action。

媒体专用操作留在对应 Workbench 内，通过标题栏、溢出菜单、右键菜单或 Workbench
自己的内容布局提供。新增 Workbench 不需要为了进入 Project 生成中心而额外注册入口。

## 代码边界

- 删除 Workbench `generation-center` surface、对应 Facility 和 invocation origin；
- 删除只服务于该 surface 的 `generation-tool` Presentation；
- Audio、MindMap、HTML 不再声明生成中心 Facility 或注册重复入口；
- Workbench 内现有 Action 改用普通 `action` Presentation，行为不变；
- GenerationCenter 不再接收当前 Asset 或订阅 Workbench Runtime。

全局生成工具仍可继续使用 Generation Center Agent Provider Selector。该 Selector 与本次
删除的 Workbench UI surface 是不同概念，不在本次范围内。

## 兼容性与验证

Workbench surface 和 invocation origin 都是 Renderer 运行期契约，没有数据库字段或持久化
数据，因此不需要迁移。测试应覆盖：

- 生成中心不再渲染“当前 Asset 工具”及其空状态；
- 通用生成工具、任务状态和生成 Asset 列表继续渲染；
- 内置 Workbench Manifest 不再声明已移除 Facility；
- 旧 `generation-center` Facility 和 invocation origin 被拒绝；
- Workbench 内部右键和工具栏 Action 继续存在。
