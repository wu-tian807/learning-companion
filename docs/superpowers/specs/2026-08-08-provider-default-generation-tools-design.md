# Provider 默认 Generation Tools 设计

> 日期：2026-08-08
>
> 状态：已实现；2026-08-16 修订为仅 Provider 原生基础能力默认开启
>
> 前置设计：
>
> - `2026-08-04-mind-map-generation-task-definition-design.md`
> - `2026-08-07-agent-function-tools-and-skills-design.md`

## 1. 目标

当前 `TaskDefinition.allowedTools` 同时承担两种不同职责：

1. 重复声明 Agent 在工作区执行任务时几乎总会使用的基础能力；
2. 声明某个 TaskDefinition 独有的 Function Tool。

这会迫使 `mindmap.generate@1` 重复写 Workspace 基础工具，也让 Provider 无法根据
自身的原生能力和 Workspace 权限制定默认工具策略。

本设计将契约调整为：

`有效工具集 = Provider 原生默认能力 + TaskAgentCallRequest.toolRequirements`

`TaskDefinition.process()` 在每次 Agent 调用中决定应用 Function Tool、Skill 和 MCP；Provider
根据 Workspace 权限提供 Shell 读写与自身原生 `view_image`，并把调用声明适配成真实实现。
Workspace 权限仍然是授权上限，调用参数不能扩大它。

## 2. 职责边界

### 2.1 TaskDefinition

TaskDefinition 静态声明：

- Workspace 的 read / write 权限；
- instruction、AssetReference 协议和 `process()`。

`process()` 的每次 `agent.call()` 显式声明 system instruction、user message、额外工具、Skill
与 MCP；TaskDefinition 不保存全任务共享的 Agent 配置，也不重复声明 Workspace 基础工具。

### 2.2 Provider

每个 Provider Adapter 负责：

1. 根据 Prepared Workspace 计算本次默认工具；
2. 合并 Provider 原生默认能力和本次调用的 `toolRequirements`；
3. 对每个中立工具 ID 优先选择 Provider 原生能力；
4. 原生能力不可用时尝试应用 Function Tool；
5. required 工具不可满足时在登录、环境检查和 Thread 创建前失败；
6. optional 工具不可满足时省略；
7. 将最终有效工具集用于请求配置、事件白名单和 Session 配置指纹。

Provider 不负责 GenerationTask 的业务语义，TaskAgentCallRequest 也不携带 Codex
`dynamicTools`、shell 或其他 wire protocol DTO。

### 2.3 Workspace 权限

权限和工具是两个正交条件：

- 工具决定 Agent 是否拥有某种操作入口；
- Workspace permissions 决定入口可以作用在哪些路径，以及是否允许写入。

Codex 默认规则：

- 只要存在 readable Workspace，默认启用映射到 Codex Shell 的 `workspace.read`、
  `workspace.search`；
- readable Workspace 同时默认启用 Codex 原生只读 `view_image`；
- 只有存在 writable Workspace 时，默认启用 `workspace.write`，对应 Codex 原生
  `apply_patch` 与 Shell 写入；
- PDF、Video 等应用 Function Tool 只有被本次 `agent.call()` 显式声明后才启用；
- Codex permission profile 按 Prepared Workspace 分别授予 read / write；该边界同时约束
  Shell 命令、脚本和 `apply_patch`，而不只是约束某一个工具入口；
- `toolRequirements` 不能把只读 Workspace 提升为可写。

Codex App Server 没有独立的原生文本 read / search 开关，普通文件操作因此保留其默认
Shell；写能力由同一 permission profile 决定。PDF 在调用声明后通过 `dynamicTools` 回调
Learning Companion，图片读取默认使用 Codex 原生 `view_image`。只要有 readable Workspace，
`features.shell_tool` 就设为 `true`。

## 3. Provider-neutral 契约

`AllowedToolConfig` 改名为 `AgentToolRequirement`：

    export interface AgentToolRequirement {
      readonly id: string;
      readonly availability: 'required' | 'optional';
    }

`TaskAgentCallRequest` 和 `GenerationAgentTurnRequest` 统一使用：

    readonly toolRequirements: readonly AgentToolRequirement[];

字段名明确表达它不是最终 allowlist。Skills 和 MCP 保持独立声明，不并入工具数组。

## 4. Codex 有效工具解析

`resolveCodexGenerationTools` 接收完整 Generation request 和 Function Tool Registry，按以下
顺序处理：

1. 从 Workspace 权限派生 read / search / write Shell 能力和原生 image；
2. 合并本次 Agent 调用的 `toolRequirements`；
3. 同 ID 去重，required 优先于 optional；
4. 根据当前授权过滤 Workspace 工具；
5. 原生 Codex 工具优先，否则查询应用 Function Tool Registry；
6. required 缺失时报错，optional 缺失时省略；
7. 输出冻结、稳定排序的 Selection。

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

因此有效工具、工具版本或 Workspace 写权限变化后，不会静默恢复到配置不一致的旧 Thread。

## 6. PDF、Video 与后续内置能力

PDF、Video 等应用 Function Tool 不属于 Provider 默认工具集。Workbench 注册实现，具体
`TaskDefinition.process()` 在需要它的那次 `agent.call()` 中声明；Codex 原生 `view_image`
属于 Provider 默认基础能力。

当前已经实现：

- `workspace_read_pdf(operation=extract_text)`：使用 PDF.js 提取包含首尾页的内嵌文字，
  它不是 OCR；每次最多 20 页，并限制返回字符数；
- `workspace_read_pdf(operation=render_pages)`：使用 PDF.js 与应用内 Canvas 将包含首尾页的
  页段逐页渲染为 PNG，并作为多张 `inputImage` 直接返回模型；每次最多 6 页，单页调用即
  PDF 页预览；
- `workspace.view_image`：映射到 Codex 原生 `view_image`；
- PDF handler 只接受已授权 Workspace 内的相对路径，不启动 Shell 或子进程。

扩展方式固定为：

1. Feature 模块拥有并导出一个 Provider-neutral Function Tool Definition；
2. Workbench Main Contribution 在 Bootstrap 阶段只注册 Definition；
3. `TaskDefinition.process()` 根据本次资料和任务声明工具需求；Provider 本身不感知 PDF、
   Video 等具体实现；
4. Provider 若已有等价原生能力，优先映射到原生工具；
5. 否则映射到注册的 Function Tool；
6. 重型媒体工具使用 `deferLoading`，避免每次 Turn 都加载完整 Schema；
7. handler 通过执行上下文中的 Prepared Workspaces 读取材料，并遵守 Workspace / 领域
   Service 不变量。

依赖外部工具包的能力只在依赖可用时注册；缺失依赖时 optional 调用需求可以被省略，required
调用需求则在 Agent 启动前明确失败。若要支持运行期间安装或卸载依赖，能力目录还需增加
刷新和注销生命周期，而不是把探测逻辑写入 Provider。

Video 等后续工具仍需在确定真实转换器、输入协议和输出格式后独立实现。Mind Map 的参考
资料副本和模型友好表示仍由 GenerationTask prepare 阶段放入主 Workspace；Shell 和原生
image 默认可用，PDF 工具由 Mind Map 的 `process()` 根据物化后的资料类型声明。

PDF 提示要求 Agent 先用 `extract_text` 定位相关章节和页码，再对真正相关的页调用
`render_pages` 检查公式、图表、版式与完整局部上下文；不能只根据内嵌文字形成最终判断。
内嵌文字稀疏、为空或乱码时也必须转为页面图像核验。`render_pages` 默认 `scale=1.5`；
只有小字或公式不清楚时才提高到 `2`，降低 scale 只用于更重视速度和图片体积的场景。

PDF OCR 暂缓。没有文字层或文字乱码时，`render_pages` 返回页面图像供模型直接阅读；当前
不为 OCR 扩展工具协议、外部组件安装流程或缓存模型。

Generation prepare 不自行判断 Office 转换策略。它通过现有 `WorkbenchRegistry` 选择负责
该 Asset 的 Workbench，并优先复制 Workbench `materializeContent()` 返回的内容。Office
Workbench 返回与预览界面相同的缓存 PDF；准备结果同时保留原始 `mediaType` 和
`materializedMediaType`。没有物化能力的 Workbench 仍复制原始 Asset 内容。

## 7. Mind Map 结果

`mindmap.generate@1` 的 process 在每次调用中显式使用：

    toolRequirements: []
    skills: []
    mcpServers: []

它使用默认按 `taskId` 隔离、可写的 `generation-mindmap` Workspace。Provider 自动提供 Shell
read / search、原生 image 和可写时的 write；`process()` 根据参考资料声明 PDF 工具。Agent 将
候选树写入任务 Workspace，TaskDefinition 的 `process()`
负责校验、在同一 Session 请求修复，并将通过校验的候选提交为正式 Asset。Agent 不直接
改写正式 Asset。

## 8. 数据流

    TaskDefinition.process
      -> prepare: instruction + asset copies + workspaces
      -> TaskAgentCallRequest: prompt + tools + skills + mcp
      -> GenerationAgentTurnRequest
      -> selected Provider
      -> Provider native defaults + per-call tool mapping
      -> effective tool selection
      -> permission profile + dynamic tools + fingerprint
      -> Provider-owned agent loop writes workspace artifact
      -> TaskDefinition.process validation / repair turns
      -> validated workspace artifact
      -> generated Mind Map Asset

## 9. 验收标准

1. `mindmap.generate@1` 不再声明 read / search；
2. read-only Workspace 自动获得 Shell read / search 与原生 image，不获得 PDF 或有效写权限；
3. writable Workspace 额外获得由 permission profile 限定路径的原生 write；
4. 单次 Agent 调用的额外 Function Tool 仍能声明、解析和回调；
5. required 缺失额外工具在账号检查和 Thread 创建前失败；
6. optional 缺失额外工具被省略；
7. 动态工具与原生工具事件只按最终 Selection 放行；
8. 最终有效工具和 Function Tool 版本进入 Session 指纹；
9. TaskAgentSession 校验每次调用 `toolRequirements` 的 ID、availability 和重复项；
10. Shell 默认开启，但不能越过 Codex permission profile 的路径读写边界；
11. 路径越界、read / write profile、真实 PDF 文字提取和逐页图片渲染测试通过；
12. 针对性测试、TypeScript、ESLint 和完整 `pnpm check` 通过。

## 10. 明确不做

- 不自己实现 Codex Agent Loop；
- 不让 Agent 调用重复声明 Provider 基础工具；
- 不让工具声明绕过 Workspace 权限；
- 不让模型通过 Shell 自行寻找 PDF 解析依赖或生成临时解析脚本；
- 不在本轮虚构 Video 处理器；
- 不把 Codex 原生 DTO 泄漏到 Generation 领域契约；
- 不新增平行的 Tool Service、Capability Manager 或数据库表。

## 11. 实施结果

- Provider 按 Prepared Workspace 权限派生默认 read / search / write Shell 能力与原生 image；
- PDF Feature 通过 Workbench Main Contribution 注册实现，只有调用声明后才走应用 Dynamic
  Tool；图片默认映射原生 `view_image`；
- Provider 不接受 Bootstrap 注入的媒体默认工具需求；
- `toolRequirements` 已从每次 `agent.call()` 贯通 Agent Session、Executor 和 Provider request；
- 请求配置、事件白名单和 Session 指纹统一消费同一份有效 Selection；
- `mindmap.generate@1` 已移除重复的 Workspace 工具声明；
- 完整 `pnpm check` 通过：207 个测试文件，868 项通过，1 项跳过。
