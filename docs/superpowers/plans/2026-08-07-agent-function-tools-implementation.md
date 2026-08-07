# Agent Function Tool 与 Codex 动态工具实施计划

> 依据：`docs/superpowers/specs/2026-08-07-agent-function-tools-and-skills-design.md`
>
> 日期：2026-08-07
>
> 状态：Function Tool 实施范围已完成并通过全量检查
>
> 范围：只实现应用 Function Tool Registry 和 Codex 动态工具回调派发。Skill 按设计保留为
> 下一独立切片，MCP 不进入本轮。

## 1. Provider-neutral Function Tool 契约

涉及文件：

- `src/main/agents/function-tools/agent-function-tool.ts`
- `src/main/agents/function-tools/agent-function-tool-registry.ts`
- `src/main/agents/function-tools/agent-function-tool-registry.test.ts`

步骤：

1. 定义 `AgentFunctionToolDefinition`、`AgentFunctionToolExecutionContext` 和只读 Registry API；
2. 固定工具 ID、正整数版本、非空描述和 JSON object Schema 校验；
3. 实现 register、get、require、list；
4. 重复 ID 使用 `REGISTRATION_CONFLICT`，非法定义使用
   `INVALID_EXTENSION_DEFINITION`；
5. Registry 返回冻结、按 ID 稳定排序的 Definition 快照；
6. 测试合法注册、非法 ID、非法版本、非法 Schema、重复注册、稳定排序和 handler 上下文传递；
7. 不增加 Schema 校验依赖，不引入持久化或 Provider 类型。

完成标准：领域 Registry 可以独立运行和测试，不依赖 Codex Runtime。

## 2. Codex 工具选择与协议映射

涉及文件：

- `src/main/agents/providers/codex-function-tools.ts`
- `src/main/agents/providers/codex-function-tools.test.ts`
- `src/main/agents/providers/codex-generation-request.ts`
- `src/main/agents/providers/codex-generation-request.test.ts`

步骤：

1. 在 Codex Adapter 内固定原生工具 ID 集合和 `learning_companion` namespace；
2. 一次解析 Provider 默认工具与 `toolRequirements`，得到启用的原生工具与 Function Tool
   Definition；
3. required 未支持时在检查 Codex 环境、创建或恢复 Thread 前失败；
4. optional 未支持时省略；
5. 将 Function Tool Definition 转换成 `CodexDynamicToolNamespace`；
6. 没有应用工具时不发送空 namespace；
7. 将工具 ID、版本、描述、Schema 和 deferLoading 加入配置指纹描述符；
8. 保持 Workspace 原生工具和路径权限现有映射不变；
9. 测试 namespace 结构、required / optional 行为、动态工具发送及指纹变化；
10. 验证仅调整 Registry 中未被当前 Definition 选择的工具不会改变该 Session 指纹。

完成标准：Provider 可以为一次 Generation Request 生成确定的 Codex Thread 配置和已选工具集合。

## 3. Codex Function Tool 回调派发

涉及文件：

- `src/main/agents/providers/codex-function-tools.ts`
- `src/main/agents/providers/codex-function-tools.test.ts`
- `src/main/agents/providers/codex-agent-provider.ts`
- `src/main/agents/providers/codex-agent-provider.test.ts`

步骤：

1. 为 `item/tool/call` 增加严格参数解析；
2. 校验 request thread、active turn、namespace、callId 和工具 allowlist；
3. 使用 Request 中的 taskId、projectId、workspaces 和 signal 构造执行上下文；
4. 执行 Registry handler，并把 string / JSON 结果编码为 Codex `inputText`；
5. handler 普通错误返回清理后的 `success: false`；
6. Abort 保持原有 Turn 中断语义；
7. 未声明工具、错误 namespace 和上下文不匹配响应 JSON-RPC error，并抛出
   `CODEX_PROTOCOL_ERROR`；
8. 其他 server request 继续按非交互 Generation 策略拒绝；
9. 用模拟 Runtime 验证“模型调用工具 → handler 执行一次 → 返回结果 → Turn 完成”；
10. 测试失败 handler、取消、畸形参数、未声明调用、错误 thread / turn 和重复请求边界。

完成标准：Function Tool 回调不再触发当前的统一 `FEATURE_NOT_SUPPORTED`，且不会扩大其他交互请求权限。模型推理与工具选择循环仍完全由 Codex app-server 负责。

## 4. 流式事件映射

涉及文件：

- `src/main/agents/providers/codex-generation-response.ts`
- `src/main/agents/providers/codex-generation-response.test.ts`
- 必要的 `GenerationAgentEvent` 测试

步骤：

1. 允许已解析的动态 Function Tool item 通过现有工具事件 allowlist；
2. 将其映射为 `dynamic:<tool-id>`；
3. 未声明动态工具事件继续触发协议错误；
4. 不把完整工具输入、输出或 Service 错误持久化进 GenerationTask；
5. 验证现有 command / fileChange 工具事件映射不回归。

完成标准：Renderer 后续可以通过通用 Generation 事件看到工具进度，但领域层不依赖 Codex item DTO。

## 5. Bootstrap 注入

涉及文件：

- `src/main/bootstrap/create-agent-provider-service.ts`
- `src/main/bootstrap/create-application-runtime.ts`
- 对应 Bootstrap / Provider 测试

步骤：

1. Application Runtime 初始化时创建一个 `AgentFunctionToolRegistry`；
2. 将同一实例传给 `createAgentProviderService` 和 `CodexAgentProvider`；
3. 保持 Registry 不通过 IPC 或 `ApplicationRuntime` 公开；
4. 在具体 Asset / Workspace Service 创建后预留 Feature Tool 注册位置；
5. 本轮没有真实生产工具时不注册虚构工具；
6. 测试空 Registry 不改变现有 Provider 创建、凭证检查和 Generation 行为；
7. 确认初始化失败时不增加额外需要关闭的资源。

完成标准：生产应用拥有完整但默认为空的 Function Tool 基础设施，测试可注册受控工具完成闭环。

## 6. 验证与提交边界

验证顺序：

1. Registry 针对性 Vitest；
2. Codex Function Tool 映射与调用针对性 Vitest；
3. Codex Provider、Runtime 和 Session 回归测试；
4. GenerationTask Definition、prepare、recovery 和 metrics 回归测试；
5. TypeScript 检查；
6. ESLint；
7. 完整 `pnpm check`；
8. 检查生产文件大小、依赖方向和 Git diff。

建议提交：

1. `feat(agent-tools): add application function tool registry`
2. `feat(codex): execute registered dynamic tools`
3. `test(codex): cover dynamic tool routing boundaries`
4. 如 Bootstrap 改动可以独立审阅，再拆为
   `refactor(bootstrap): inject agent function tool registry`

不自动 push。实现过程中如果某一提交无法独立通过类型检查，可以把第 2、3 项合并，
但不能把后续 Skill 或 MCP 一起混入。

## 7. 下一切片：Skill

> 后续状态：Skill 与 MCP 已由
> `2026-08-07-agent-skills-and-mcp-implementation.md` 实现并接入同一 Generation 链路。

Function Tool 闭环通过后再单独规划：

1. `AgentSkillRequirement` 与 TaskDefinition Registry 校验；
2. Documents 下 `agent-capabilities/skills` 路径解析；
3. `AgentSkillService` 文件安装、移除和解析；
4. required / optional Skill 解析；
5. Codex 显式 Skill input 映射；
6. ambient Skill 继续禁用的隔离测试；
7. 仅在出现真实复用需求时给 Mind Map 声明 Skill。
