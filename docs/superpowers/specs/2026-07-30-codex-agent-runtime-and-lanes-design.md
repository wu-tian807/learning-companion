# Codex Agent Runtime、Agent Lane 与 Memory 方向

> 状态：已接受
>
> 决策日期：2026-07-30
>
> 作用：作为 Learning Companion 后续 AI 后端、会话映射、上下文注入、
> Memory 和成本控制设计的上位约束。具体实现计划可以继续拆分，但不应在没有
> 新决策记录的情况下偏离本文。

## 1. 背景

Learning Companion 的主要 Workbench 已经能够承载 PDF、Markdown、纯文本、
图片、音视频、HTML 和 EPUB 等资料。下一阶段的重点不再是增加一种通用预览器，
而是把已有 Workbench 的选区、附件、生成入口和编辑能力接入真正可持续的 AI
执行后端。

此前讨论过 ChatGPT Web 自动化、Codex、Claude Code、OpenCode、直接 API、
自建 Conversation Store 和多种 Memory 方案。当前决定先收敛到一条能上线、
成本门槛低且未来仍可扩展的路线：

- 第一阶段只实现 Codex Provider；
- 应用自带并管理需要的 Codex Runtime，通过 Codex App Server 协议接入；
- 用户只需要一个可以正常登录的 ChatGPT 账号，Free 用户也应能完成基础任务；
- Project 持有两个长期 Agent Lane，Asset 只是每一轮的动态上下文；
- Provider 负责原生 Thread、历史和 Compact，应用不复制 Conversation；
- 应用只维护 Thread 映射、学习资料、生成物、笔记 Attachment 和全局 Memory；
- OpenCode 是后续第二套 Provider 的优先候选，但不进入 Codex v1。

## 2. 产品边界

### 2.1 Learning Companion 拥有什么

Learning Companion 是学习工作台和系统事实来源，拥有：

- Project、Asset、Workbench 和生成中心；
- 当前 Asset、文字选区、页码、区域、媒体时间点等交互上下文；
- 笔记、生成物、版本和 Attachment；
- 两个 Agent Lane 的产品语义；
- Lane 到 Provider Thread 的映射；
- Provider 无关的全局 Memory；
- AI 操作权限、确认流程和成本策略。

这一层不命名为 `Core`，也不以 Codex 的 API 对象作为自身领域模型。

### 2.2 Provider 拥有什么

Provider 是执行适配层。Codex Provider 拥有或代理：

- ChatGPT 登录与 Token 刷新；
- 模型发现；
- Thread 创建、恢复、Fork 和归档；
- Turn 执行、流式事件、中断和错误；
- 原生 Conversation 历史；
- 原生上下文压缩；
- 模型推理和工具调用；
- 账号套餐、额度和使用情况。

### 2.3 明确不做

Codex v1 不做：

- ChatGPT 网页嵌入或浏览器自动化；
- 要求用户预装 Codex Desktop 或 Codex CLI；
- 将 ChatGPT 的 Chat / Work UI 模式复制进应用；
- 自建完整 Agent Loop；
- 自建 Conversation Store 或 Context Ledger；
- 按 Asset 新建独立 Thread；
- DeepSeek、OpenCode Go 或任意 OpenAI-compatible API 接入；
- 在 `settings.json`、SQLite 或日志中保存明文 API Key；
- 为自动 Memory 在每一轮无条件增加一次模型调用。

## 3. 总体结构

```text
Learning Companion
├── Project
│   ├── creator Lane
│   │   └── Provider Thread Ref
│   └── tutor Lane
│       └── Provider Thread Ref
├── Active Turn Context
│   ├── current Asset
│   ├── current Workbench
│   ├── text / region / page / time selection
│   └── referenced Attachments
├── Learning Artifacts
│   ├── notes
│   ├── generated Assets
│   └── stable Attachment anchors
├── Global Memory
└── Agent Provider Registry
    └── codex
        ├── managed Runtime
        ├── App Server client
        ├── ChatGPT auth
        └── native Threads
```

Provider Registry 从第一天保留扩展边界，但首版只注册 `codex`。不要为了尚未
实现的 Provider 提前构造复杂的最低公分母协议。

## 4. Agent Lane 与 Thread

### 4.1 Agent Lane 等于产品中的连续 Session

每个 Project 固定拥有两个 Lane：

| Lane | 角色 | 主要职责 |
| --- | --- | --- |
| `creator` | 主线管理者 / 生成者 | 管理学习主线，生成或重做思维导图、提纲、讲义和其他 Project 级学习资产 |
| `tutor` | 资料讲解者 | 围绕当前打开的 Asset 和选区答疑、讲解、关联知识并沉淀笔记 |

Lane 是 Project 级长期上下文，而不是当前 Asset 的子对象。用户切换 Asset 时，
继续使用同一个 Tutor Lane；这样资料间的连续学习不会因为切换文件而丢失。

### 4.2 双字典映射

产品层使用 Lane 优先的双字典：

```ts
type AgentLaneId = 'creator' | 'tutor';
type AgentProviderId = 'codex' | string;

type ProjectAgentThreads = Readonly<
  Record<
    AgentLaneId,
    Readonly<Partial<Record<AgentProviderId, ProviderThreadRef>>>
  >
>;

interface ProviderThreadRef {
  readonly providerId: AgentProviderId;
  readonly threadId: string;
}
```

含义是：

- 产品中的一个 Lane 对用户表现为一个连续 Session；
- 每个 Provider 可以为该 Lane 保留自己的原生 Thread；
- 当前只有 `codex` 键；
- 将来切换到 OpenCode 时，不需要把 Codex Thread 转写成另一家的 Session 格式；
- 切回某 Provider 时，只恢复该 Provider 自己的 Thread。

不尝试在不同 Provider 之间迁移完整上下文。Provider 切换依靠全局 Memory、
Project 资料和当前 Turn Context 获得必要背景，而不是伪造另一家的内部 Session。

### 4.3 应用不复制 Conversation

Learning Companion 只持久化 `ProviderThreadRef`，不持久化 Provider 的完整
消息序列作为恢复来源：

- 恢复上下文依赖 `thread/resume`；
- 长上下文压缩依赖 Codex 自己的 Compact；
- 不把 Codex Event 或 Message DTO 作为领域数据库结构；
- UI 若需要近期消息，可以从 Provider 读取或维护可丢弃的显示缓存；
- 显示缓存不能成为恢复 Thread 的事实来源。

## 5. 当前上下文与 Attachment

Thread 是 Project 级的，但每一轮输入必须显式携带当前学习现场：

```ts
interface LearningTurnContext {
  readonly projectId: string;
  readonly laneId: AgentLaneId;
  readonly assetId?: string;
  readonly workbenchId?: string;
  readonly selection?: WorkbenchInteraction;
  readonly attachments: readonly LearningAttachmentRef[];
}
```

Turn Context 由当前 Workbench 动态组合：

- 文本或 Markdown 的文字范围；
- PDF / EPUB 的页码、文字范围或区域；
- HTML 中的文本、链接和 Frame 来源；
- 图片区域；
- 音视频时间点或时间段；
- 用户明确加入本轮的笔记和其他 Asset。

不要把整个 Project 或所有 Asset 无条件塞入每一轮。上下文应遵循：

1. 当前显式选区优先；
2. 当前 Asset 的必要元数据其次；
3. 用户显式引用的 Attachment 再次；
4. 全局 Memory 只检索少量相关项；
5. 其余内容通过受控工具按需获取。

稳定 Attachment 由 Learning Companion 维护，而不是交给模型写入任意 Markdown
文件。Attachment 必须保留可重新定位的信息，例如 `assetId`、页码、文本锚点、
区域坐标或媒体时间。

## 6. Codex Runtime 与登录

### 6.1 内置 Runtime

Learning Companion 自带并启动所需的 Codex Runtime，通过 App Server 的
JSON-RPC 接口通信。用户电脑上是否安装 Codex Desktop 或 Codex CLI，不是产品
可用性的前置条件。

运行时集成至少覆盖：

- `initialize`；
- `account/read` 和托管 ChatGPT 登录；
- `model/list`；
- `thread/start`、`thread/resume`；
- `turn/start`、流式通知、完成和中断；
- `account/rateLimits/read` 及额度更新。

Codex App Server 是官方面向富客户端的接口，负责认证、Conversation History、
审批和流式 Agent Event：

- <https://learn.chatgpt.com/docs/app-server>
- <https://github.com/openai/codex/tree/main/codex-rs/app-server>

### 6.2 登录原则

默认登录方式是 ChatGPT OAuth，而不是要求用户提供 OpenAI API Key。

首次使用流程：

1. 启动应用管理的 Runtime；
2. 调用 `account/read`；
3. 未登录时发起 App Server 托管的 ChatGPT 登录；
4. 登录完成后读取 `planType`、模型列表和额度；
5. 至少创建当前 Project 所需的 Lane Thread 时才真正消耗 Agent 资源。

Codex 当前向 Free 计划提供基础可用能力，但模型、额度和实际功能以账号和
Workspace 返回结果为准：

- <https://learn.chatgpt.com/docs/pricing>

产品文案使用“使用 ChatGPT 账号登录”，不承诺不限量，也不把“有账号”误写为
“必然拥有某个固定模型”。

是否显式复用用户机器上已经存在的 `CODEX_HOME`，属于后续安全与迁移设计，
不是首版可用性的依赖。无论机器上是否存在外部 Codex 状态，应用都必须能够
完成自己的登录流程；不得静默复制 Token。

## 7. Chat / Work 与行为模式

不在 Provider 层实现 `chatMode` / `workMode` 开关。

ChatGPT 产品 UI 中的 Chat / Work 不是 Codex App Server 暴露的一对可互换
会话模式。Learning Companion 的两种核心行为由 Lane、提示、工具权限和当前
上下文决定：

- Tutor Lane 表现得更像讲解和连续问答；
- Creator Lane 表现得更像规划、生成和修改资产；
- 两者本质上都是 Codex Thread；
- 两者都消耗同一账号对应的 Codex 额度。

不要为了模拟 Chat 模式而另外接 ChatGPT 网页或维护第二套 Conversation。

## 8. 全局 Memory

### 8.1 定位

Memory 位于全局层，不属于某个 Asset、Project、Lane 或 Provider。它只保存
跨学习场景仍有价值的稳定事实，例如：

- 用户长期学习目标；
- 已确认的知识薄弱点；
- 稳定的讲解偏好；
- 用户明确要求记住的事实；
- 对多个 Project 都有用的学习习惯。

Memory 不用于恢复 Codex Thread，也不保存完整 Conversation。

### 8.2 开关

用户设置提供全局“自动记忆”开关：

```ts
interface MemoryPreferences {
  readonly autoCapture: boolean;
}
```

- 关闭自动记忆时，用户仍可显式执行“记住这件事”；
- 已有 Memory 仍可被相关检索使用；
- 完全清空、暂停检索和自动提取是不同操作，不应混成同一个危险开关；
- Free 用户和经济模式默认关闭自动记忆；
- 用户可以随时手动开启，产品只给出额度提示，不强制禁止。

推荐提示：

> 当前为额度敏感模式，自动提取记忆可能增加上下文或模型调用，因此默认关闭。
> 手动记忆和已有记忆仍可使用。

首版优先通过用户显式记忆，或让主 Turn 在已有调用内产出结构化 Memory
候选；不要默认在每一轮结束后再执行一次独立 LLM 提取。

## 9. 成本与额度策略

### 9.1 动态发现，不硬编码套餐能力

登录后使用 App Server：

- `account/read` 获取认证状态和可用时的 `planType`；
- `model/list` 获取当前账号真实可用模型、默认模型和推理强度；
- `account/rateLimits/read` 获取额度使用比例和重置时间；
- 监听额度更新，避免 UI 使用过期状态。

不要在客户端硬编码“Free 必有模型 X”或“Plus 永远有模型 Y”。

### 9.2 默认经济策略

Codex v1 默认成本敏感：

- 复用两个长期 Thread，不重复发送完整历史；
- 依赖 Codex Compact，而不是客户端重放 Conversation；
- 只注入当前 Asset、选区、相关 Attachment 和少量相关 Memory；
- 普通问答使用账号返回的推荐模型与较低或默认推理强度；
- 高推理、高质量重做和长时间生成由用户显式触发；
- 自动 Memory 默认关闭；
- 不运行无可见价值的后台 Agent Turn；
- 不为所有 Workbench 预读和上传完整文件。

可以在 UI 中提供“经济 / 均衡 / 高质量”产品策略，但它们必须映射到
`model/list` 返回的能力，不能写死具体模型。

### 9.3 额度降级

- 接近额度上限：提示经济模式，暂停非必要后台任务；
- 额度耗尽：显示重置时间和原因；
- AI 暂不可用时，所有本地 Workbench、阅读、编辑和笔记仍然可用；
- 不因为 Provider 暂时不可用而阻止用户打开 Project；
- 进行中的 Turn 按 App Server 返回状态完成或失败，不伪造成功。

## 10. Provider 领域边界

应用层定义自己的最小接口，再由 Codex Adapter 翻译 App Server DTO：

```ts
interface AgentProvider {
  readonly id: string;

  getAccount(): Promise<AgentAccountState>;
  login(): Promise<AgentLoginResult>;
  listModels(): Promise<readonly AgentModel[]>;
  getUsage(): Promise<AgentUsageState>;

  startThread(input: StartAgentThreadInput): Promise<ProviderThreadRef>;
  resumeThread(ref: ProviderThreadRef): Promise<AgentThread>;
  startTurn(input: StartAgentTurnInput): AsyncIterable<AgentEvent>;
  interruptTurn(input: InterruptAgentTurnInput): Promise<void>;
}
```

约束：

- `AgentEvent`、`AgentModel`、`AgentUsageState` 是应用自定义类型；
- Codex 的 JSON-RPC 类型只存在于 Codex Adapter 内；
- 不提前要求所有未来 Provider 支持 Codex 的全部特性；
- Provider 不拥有 Project、Asset、Lane 角色或 Memory；
- Provider Thread ID 是不透明字符串，业务层不解析其内部结构。

## 11. Learning Companion 工具

Codex 可以调用的自定义工具必须来自 Learning Companion 的受控能力，而不是
让 Renderer 暴露通用文件系统或 Shell：

- 读取当前 Asset 的指定范围；
- 解析或打开 Attachment；
- 创建新的学习 Asset；
- 对可编辑 Asset 生成结构化补丁；
- 在稳定锚点附近插入笔记或引用；
- 查询 Project 内的 Asset 元数据；
- 请求用户确认破坏性重做或大范围替换。

工具契约由应用定义，Codex Adapter 再通过 App Server 支持的工具或 MCP
机制注入。模型生成 HTML、Markdown 或其他可编辑资料时，应优先返回结构化
操作，并由 Workbench Provider 执行、校验和保留 Attachment。

## 12. 持久化责任

建议落点如下：

| 数据 | 责任方 | 建议存储 |
| --- | --- | --- |
| Project、Asset、生成物 | Learning Companion | SQLite 与现有文件存储 |
| Lane 定义和 Provider Thread Ref | Learning Companion | SQLite |
| 当前选区和瞬时 Turn Context | Workbench Runtime | 内存 |
| 笔记 Attachment 与稳定锚点 | Learning Companion | SQLite / 对应 Asset 数据 |
| Conversation、Compact、Thread 内容 | Codex Runtime | Codex 原生存储 |
| ChatGPT Token | Codex Runtime | Codex 认证存储 |
| `autoCapture` 等全局偏好 | Learning Companion | `settings.json` |
| 全局 Memory 条目 | Learning Companion | SQLite |

Token、API Key 和完整 Provider Conversation 不进入应用自己的
`settings.json` 或业务数据库。

## 13. OpenCode 的后续位置

OpenCode 是 Codex 之后的优先候选 Provider，但应作为独立 Runtime Adapter，
而不是强行从 Codex 自定义 `base_url` 接入。

原因是 Codex 当前的自定义模型 Provider 只支持 OpenAI Responses 协议：

- <https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers>
- <https://learn.chatgpt.com/docs/config-file/config-reference>

OpenCode Go 和 DeepSeek 官方接口主要提供 Chat Completions 或 Messages，
不能仅靠修改 Codex `base_url` 可靠接入：

- <https://opencode.ai/docs/go/>
- <https://api-docs.deepseek.com/api/create-chat-completion>

未来的顺序是：

1. 完成 Codex Provider 和两个 Lane；
2. 验证真实学习工作流、额度和 Memory 策略；
3. 若低价套餐需求明确，再实现独立 `OpenCodeProvider`；
4. 不在 Codex v1 中提供第三方 API Key UI 或协议转换网关。

Claude Code 和其他 Provider 不在当前路线内，只保留领域模型不被 Codex
绑死这一条扩展约束。

## 14. 实施顺序

后续实现计划应按以下依赖顺序拆分：

1. 定义 Provider 无关的领域类型、Lane 标识和错误模型；
2. 打包并启动受应用管理的 Codex Runtime，完成 App Server 初始化；
3. 完成 ChatGPT 登录、账号读取、模型发现和额度读取；
4. 实现 Codex Thread / Turn Adapter 与流式事件；
5. 为每个 Project 持久化 `creator` / `tutor` 两个 Lane 的 Thread Ref；
6. 将当前 Asset、Workbench Interaction 和 Attachment 组装成 Turn Context；
7. 接入 Tutor Lane 的首个端到端提问；
8. 接入 Creator Lane 的首个结构化 Asset 生成操作；
9. 增加经济策略、额度提示和不可用降级；
10. 最后增加全局手动 Memory，再评估自动 Memory。

首个纵向闭环应是：

```text
选中 Workbench 内容
→ 发送给当前 Project 的 Tutor Lane
→ Codex Thread 流式回答
→ 回答可引用稳定 Attachment
→ 重启应用后通过 Thread Ref 恢复
```

## 15. 验收约束

Codex v1 至少满足：

- 未安装 Codex Desktop/CLI 的机器也能启动内部 Runtime；
- ChatGPT Free 账号可以完成登录并在其额度允许时发起基础 Turn；
- 不要求 OpenAI API Key；
- 每个 Project 恰有两个产品 Lane；
- 切换 Asset 不会自动切换或新建 Tutor Thread；
- 重启应用后能通过 Provider Thread Ref 恢复 Lane；
- 应用数据库中没有完整 Conversation 副本；
- 当前选区和 Attachment 能进入 Turn，且不会无条件上传整个 Project；
- 额度信息可见，额度耗尽不会破坏非 AI 工作台；
- 自动 Memory 在 Free / 经济模式下默认关闭；
- Codex DTO 没有泄漏到 Project、Asset、Workbench 和 Memory 的领域结构；
- OpenCode 或 DeepSeek 没有被伪装成 Codex 自定义 Provider。

## 16. 尚未在本文敲定的事项

以下问题留给各自实现设计，不应被误认为已有结论：

- Codex Runtime 的具体打包产物、升级和完整性校验方式；
- 是否以及如何显式复用已有 `CODEX_HOME`；
- Provider Thread Ref 的最终数据库表结构；
- 全局 Memory 条目的 Schema、检索算法和删除审计；
- 结构化 HTML 重做时的补丁、版本和 Attachment 重定位协议；
- 两个 Lane 在界面中的最终命名和切换交互；
- OpenCode Provider 的具体落地时间。
