# Provider 默认 Generation Tools 实施计划

> 依据：`docs/superpowers/specs/2026-08-08-provider-default-generation-tools-design.md`
>
> 日期：2026-08-08
>
> 状态：已完成；应用 Function Tool 默认方案已被 2026-08-16 的按调用声明方案取代

## 1. 领域契约迁移

1. 将 `AllowedToolConfig` 改名为 `AgentToolRequirement`；
2. 将 TaskDefinition、PreparedGenerationTask 和 GenerationAgentTurnRequest 的
   `allowedTools` 改名为 `toolRequirements`；
3. 更新 Definition Registry 校验、prepare / restore、executor 和测试；
4. 更新既有设计文档中的旧字段名。

## 2. Codex 默认工具策略

1. 从本次 Prepared Workspaces 派生默认 read / search / write Shell 能力和 Codex 原生 image；
2. PDF、Video 等应用 Function Tool 由 Workbench 注册实现，由每次 `agent.call()` 显式声明；
3. 合并 Provider 原生默认能力与本次调用需求，同 ID 下 required 优先；
4. Bootstrap 不向 Provider 注入媒体默认工具；
5. 原生工具优先，否则仅查询 Function Tool Registry；
6. optional 缺失省略，required 缺失提前失败；
7. Selection 保存最终有效需求、原生工具、Function Tool 和 dynamicTools。

## 3. 请求、权限与响应统一

1. Codex Thread 配置只消费最终 Selection，并在存在 readable Workspace 时开启 Shell；
2. Codex permission profile 把每个 Prepared Workspace 分别映射为 read / write，Shell、脚本和
   `apply_patch` 共同服从该边界；
3. 配置指纹记录最终有效工具；
4. 工具事件白名单改为直接消费 Selection；
5. Function Tool 回调继续使用同一 Selection，不重复解析。

## 4. Mind Map 迁移

1. `mindmap.generate@1` 根据参考资料的物化媒体类型声明 PDF；
2. 主 Workspace 保持可写；
3. 验证 Provider 自动开启 Shell、原生 image 和可写时的原生编辑，并只启用调用声明的 PDF；
4. 后续 Process 执行模型迁移见
   `2026-08-08-generation-task-process-execution-design.md`。

## 5. Workbench 内容物化

1. `MainWorkbenchProvider` 增加可选 `materializeContent()`；
2. Office Workbench 通过现有 Artifact Service 提供唯一 Office → PDF 物化实现；
3. Office 预览命令与 Generation prepare 共用该实现；
4. Generation 通过现有 Workbench Registry 选择物化能力，不硬编码 Office；
5. 任务副本记录原始媒体类型和物化媒体类型。

## 6. 验证

1. TaskDefinition Registry 与 prepare / recovery 测试；
2. Codex 默认工具合并和 required / optional 测试；
3. read-only / writable Workspace permission profile 与路径越界测试；
4. 真实两页 PDF 的分页文字提取和逐页图片渲染测试；
5. Function Tool 回调与事件白名单测试；
6. Session 指纹回归测试；
7. TypeScript、ESLint、完整 `pnpm check`；
8. 检查 Git diff，不自动提交或推送。
