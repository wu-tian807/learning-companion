# Provider 默认 Generation Tools 设计

> 日期：2026-08-08
>
> 状态：已实现
>
> 前置设计：
>
> - `2026-08-04-mind-map-generation-task-definition-design.md`
> - `2026-08-07-agent-function-tools-and-skills-design.md`

## 1. 目标

当前 `TaskDefinition.allowedTools` 同时承担两种不同职责：

1. 重复声明 Agent 在工作区执行任务时几乎总会使用的基础能力；
2. 声明某个 TaskDefinition 独有的 Function Tool。

这会迫使 `mindmap.generate@1` 重复写 `workspace.read` 和
`workspace.search`，也让 Provider 无法根据自身的原生能力和 Workspace 权限制定默认
工具策略。

本设计将契约调整为：

`有效工具集 = Provider 默认工具需求 + TaskDefinition.toolRequirements`

TaskDefinition 继续决定业务任务特有的 Tool、Skill 和 MCP；Provider 决定基础执行工具及其
真实实现。Workspace 权限仍然是授权上限，TaskDefinition 和 Provider 默认值都不能扩大它。

## 2. 职责边界

### 2.1 TaskDefinition

TaskDefinition 声明：

- `toolRequirements`：该任务对 Agent 工具的 required / optional 需求；
- `skills`：该任务显式需要的方法说明和随附资源；
- `mcpServers`：该任务显式允许连接的 MCP Server；
- Workspace 的 read / write 权限；
- system instruction、instruction、输出协议和后处理。

TaskDefinition 不再声明所有任务都会重复使用的 Workspace 基础工具。

### 2.2 Provider

每个 Provider Adapter 负责：

1. 根据 Prepared Workspace 计算本次默认工具；
2. 合并 Provider 注册的其他默认工具和 `toolRequirements`；
3. 对每个中立工具 ID 优先选择 Provider 原生能力；
4. 原生能力不可用时尝试应用 Function Tool；
5. required 工具不可满足时在登录、环境检查和 Thread 创建前失败；
6. optional 工具不可满足时省略；
7. 将最终有效工具集用于请求配置、事件白名单和 Session 配置指纹。

Provider 不负责 GenerationTask 的业务语义，TaskDefinition 也不携带 Codex
`dynamicTools`、shell 或其他 wire protocol DTO。

### 2.3 Workspace 权限

权限和工具是两个正交条件：

- 工具决定 Agent 是否拥有某种操作入口；
- Workspace permissions 决定入口可以作用在哪些路径，以及是否允许写入。

Codex 默认规则：

- 只要存在 readable Workspace，默认启用 `workspace.read`；
- 只要存在 readable Workspace，默认启用 `workspace.search`；
- 只有存在 writable Workspace 时，默认启用 `workspace.write`；
- 每个 Workspace 的实际 read / write 仍写入本次 Codex permission profile；
- `toolRequirements` 不能把只读 Workspace 提升为可写。

因此 read、search、write 都属于 Provider 基础能力，但 write 的暴露由本次 Workspace 授权
决定。

## 3. Provider-neutral 契约

`AllowedToolConfig` 改名为 `AgentToolRequirement`：

    export interface AgentToolRequirement {
      readonly id: string;
      readonly availability: 'required' | 'optional';
    }

`TaskDefinition`、`PreparedGenerationTask` 和 `GenerationAgentTurnRequest` 统一使用：

    readonly toolRequirements: readonly AgentToolRequirement[];

字段名明确表达它不是最终 allowlist。Skills 和 MCP 保持独立声明，不并入工具数组。

## 4. Codex 有效工具解析

`resolveCodexGenerationTools` 接收完整 Generation request、Function Tool Registry 和
Provider 注册的默认工具需求，按以下顺序处理：

1. 从 Workspace 权限派生 read / search / write；
2. 合并 Provider 的其他默认工具；
3. 合并 TaskDefinition 的 `toolRequirements`；
4. 同 ID 去重，required 优先于 optional；
5. 根据当前授权过滤 Workspace 原生工具；
6. 原生 Codex 工具优先，否则查询应用 Function Tool Registry；
7. required 缺失时报错，optional 缺失时省略；
8. 输出冻结、稳定排序的 Selection。

Selection 是本次执行的唯一事实：

    interface CodexGenerationToolSelection {
      readonly effectiveRequirements: readonly AgentToolRequirement[];
      readonly nativeToolIds: readonly string[];
      readonly functionTools: readonly AgentFunctionToolDefinition[];
      readonly dynamicTools: readonly CodexDynamicTool[];
    }

后续请求构造和响应事件校验不得重新读取 `request.toolRequirements` 推断有效能力。

## 5. Session 配置一致性

配置指纹记录：

- 最终有效工具 ID 与 required / optional；
- 实际选择的原生工具 ID；
- Function Tool 的 ID、版本、描述、Schema 和 deferLoading；
- Workspace 最终读写权限；
- Skill 与 MCP 的解析结果。

因此默认工具、工具版本或 Workspace 写权限变化后，不会静默恢复到配置不一致的旧 Thread。

## 6. PDF、Video 与后续内置能力

PDF、Video 等媒体处理能力同样属于 Provider 默认工具集，而不是每个 TaskDefinition 重复声明。
但本轮不在没有真实 handler、输入 Schema 和错误语义时虚构工具 ID。

扩展方式固定为：

1. Feature 模块注册一个 Provider-neutral Function Tool Definition；
2. Bootstrap 将它加入对应 Provider 的默认工具需求；
3. Provider 若已有等价原生能力，优先映射到原生工具；
4. 否则映射到注册的 Function Tool；
5. 重型媒体工具使用 `deferLoading`，避免每次 Turn 都加载完整 Schema；
6. handler 通过执行上下文中的 Prepared Workspaces 读取材料，并遵守 Workspace / 领域
   Service 不变量。

具体 PDF、Video 工具只在确定真实转换器、输入协议和输出格式后独立实现。这个延后不影响
Mind Map：参考资料副本和模型友好的表示仍由 GenerationTask prepare 阶段放入主 Workspace，
Codex 使用默认 read / search 即可消费。

## 7. Mind Map 结果

`mindmap.generate@1` 改为：

    toolRequirements: []
    skills: []
    mcpServers: []

它继续使用 task-scoped、read-only 的 `generation-mindmap` Workspace。Provider 自动提供
read / search，不提供 write；候选树由结构化输出返回，再由应用 post-process 校验并提交，
Agent 不直接改写正式 Asset。

## 8. 数据流

    TaskDefinition
      -> prepare: instruction + asset copies + workspaces
      -> GenerationAgentTurnRequest.toolRequirements
      -> selected Provider
      -> Provider default tool policy
      -> effective tool selection
      -> permission profile + dynamic tools + fingerprint
      -> Provider-owned agent loop
      -> validated output
      -> post-process
      -> generated Mind Map Asset

## 9. 验收标准

1. `mindmap.generate@1` 不再声明 read / search；
2. read-only Workspace 自动获得 read / search，不获得 write；
3. writable Workspace 自动获得 read / search / write；
4. TaskDefinition 的额外 Function Tool 仍能声明、解析和回调；
5. required 缺失额外工具在账号检查和 Thread 创建前失败；
6. optional 缺失额外工具被省略；
7. 动态工具与原生工具事件只按最终 Selection 放行；
8. 默认工具和 Function Tool 版本进入 Session 指纹；
9. TaskDefinition Registry 校验 `toolRequirements` 的 ID、availability 和重复项；
10. 针对性测试、TypeScript、ESLint 和完整 `pnpm check` 通过。

## 10. 明确不做

- 不自己实现 Codex Agent Loop；
- 不让 TaskDefinition 重复声明 Provider 基础工具；
- 不让工具声明绕过 Workspace 权限；
- 不在本轮虚构 PDF / Video 处理器；
- 不把 Codex 原生 DTO 泄漏到 Generation 领域契约；
- 不新增平行的 Tool Service、Capability Manager 或数据库表。

## 11. 实施结果

- Provider 默认 read / search / write 已按 Prepared Workspace 权限派生；
- Provider 可额外注入默认 Function Tool 需求，供后续 PDF / Video 能力使用；
- `toolRequirements` 已贯通 Definition、prepare、repair Turn 和 Provider request；
- 请求配置、事件白名单和 Session 指纹统一消费同一份有效 Selection；
- `mindmap.generate@1` 已移除重复的 Workspace 工具声明；
- 完整 `pnpm check` 通过：198 个测试文件，839 项通过，1 项跳过。
