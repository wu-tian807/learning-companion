# Learning Companion 工程哲学

本文件记录本项目长期稳定的架构原则。实现新功能、修复缺陷或回应评审意见时，应优先保持这些边界，而不是为单一场景建立旁路。

## 1. 本地优先，失败隔离

- Project、Asset 和 Workbench 的本地阅读体验不依赖网络或 AI 可用性。
- 网络、Provider、外部 Runtime 和 Renderer 的失败必须被限制在各自边界内，不能破坏已经存在的本地数据和工作区。
- 对损坏数据、未知协议、未声明能力和非明确的缺失状态应诚实失败，不能静默伪造成功或替换有效状态。

## 2. 数据、行为和生命周期分离

- 数据对象只表达经过校验的状态，不逐步膨胀为万能 Service。
- Database/Repository 负责持久化，Service 负责有状态生命周期和编排，Manager 负责无状态路径或文件操作，Provider 负责可替换能力，Registry 负责稳定 ID 注册与选择。
- 使用小接口和显式组合，不通过全局 Service Locator 或跨层捷径绕过领域边界。

## 3. 按领域确定 source of truth

- Main Process 是本地业务事实和可信写入边界；Renderer 只消费经过校验的完整快照并形成 UI 投影。
- Codex Runtime/thread 维护完整对话历史与 compact；应用只保存 Provider thread 的不透明引用。
- Workbench 可以保存 messages、标题、时间、Anchor、定位和高亮等 UI 状态，但这些数据只是展示缓存，不能用于重放或拼接模型上下文。
- 流式 delta 是可选的体验增强，不是最终结果的权威来源。任务完成时的持久化业务 result 必须能够独立恢复和校正 Renderer。

## 4. Workbench、Generation、Session 与 Provider 各司其职

- Workbench 拥有媒体业务协议和交互语义，不拥有 Provider Runtime，也不保存 provider threadId。
- 一个 GenerationTask 表达一次用户业务意图。TaskDefinition 是静态、版本化的业务配方；Instruction 是本次经过校验的业务输入。
- Generation 框架负责 prepare/process/complete 生命周期、checkpoint、恢复、事件和指标；TaskDefinition.process() 负责具体业务流程和最终 JSON result。
- TaskDefinition 只通过受控的 TaskAgentSession 门面调用 Agent，不能直接访问 Provider、AgentSessionService 或凭证。
- AgentSession 的稳定身份是 `(projectId, workspaceKey, instanceKey)`；Provider binding 只保存不透明 session/thread ID。模型、connection 和账号配置不属于 Session identity。
- AgentWorkspaceManager 只提供安全、无业务语义的目录操作。Workspace 的 key、实例规划和权限属于 TaskDefinition/Generation 准备阶段。

## 5. 可恢复性优先于瞬时控制流

- 不序列化 Promise、continuation 或函数栈。任务恢复时，TaskDefinition.process() 从头重新执行。
- 每次 Agent 调用使用稳定 callKey；完成的调用及其业务所需输出必须写入单调 checkpoint，恢复时直接重放，不能重复调用 Provider。
- Provider 已完成但本地 checkpoint 尚未写入时，应使用稳定的执行身份恢复已有 Turn。
- 文件写入、领域提交和补偿操作必须可验证、可重试并尽量幂等。

## 6. Authoritative snapshot 与事件语义

- Main 对长生命周期状态返回或广播完整 authoritative snapshot；Renderer 使用 revision、时间或稳定 ID 拒绝过期结果。
- execution event 用于进度、delta 和工具活动等瞬时反馈；completed checkpoint/result 用于交付最终业务事实。
- 监听器或 Renderer 消费失败不能反向把已经持久化成功的任务变成失败。

## 7. 扩展规则

- 新场景应优先扩展已有领域契约的最小缺口，不把业务语义下沉到无关基础设施。
- Provider DTO 和 Codex 专属事件不得泄漏到 Project、Asset、Workbench 或 Renderer 协议；跨 Provider 的完成输出应使用应用定义的中立类型。
- 新的会话型 Workbench 应把稳定 conversationId 作为业务 Instruction 的一部分，并将其映射到 Session locator 的 instanceKey；恢复历史继续使用原 conversationId，新建对话生成新 ID。
- 不把本地 messages 全量重发为 prompt，不把完整最终回答伪装成一条流式 delta，不把 connection/model 指纹加入 Session identity。
