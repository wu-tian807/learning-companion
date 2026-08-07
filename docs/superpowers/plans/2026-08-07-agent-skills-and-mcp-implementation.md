# Agent Skill 与 MCP 实施记录

> 依据：`docs/superpowers/specs/2026-08-07-agent-function-tools-and-skills-design.md`
>
> 日期：2026-08-07
>
> 状态：实现完成；TypeScript、ESLint 与完整测试通过（833 passed，1 skipped）

## 1. 领域声明

`TaskDefinition` 增加两份独立声明：

```ts
skills: readonly AgentSkillRequirement[];
mcpServers: readonly AgentMcpServerRequirement[];
```

两者都使用 required / optional 语义，但不与 `toolRequirements` 合并。Generation prepare、
恢复、修复 Turn 和 Provider-neutral Request 全程保留这两份声明。Definition Registry 校验
ID、availability 和重复项。

## 2. 应用私有文件能力

应用通过 Electron `documentsPath` 固定解析：

```text
<Documents>/Learning Companion/agent-capabilities/
├── skills/<id>/
│   ├── learning-companion-skill.json
│   ├── SKILL.md
│   ├── references/
│   └── scripts/
└── mcp/<id>.json
```

`AgentSkillService` 安装、原子替换、读取、枚举和移除完整 Skill 目录，并校验 front matter
名称。`AgentMcpService` 注册、显式替换、读取、枚举和移除 Provider-neutral MCP Definition。
文件是事实来源，不进入 SQLite，也不读取用户 Codex Home。

## 3. Codex 适配

Provider 在登录检查和 Thread 创建之前解析当前任务声明：

- required 缺失：`FEATURE_NOT_SUPPORTED`；
- optional 缺失：省略；
- Skill：发送 `$id` 文本和显式 `{ type: "skill", name, path }`，Skill 目录只读加入权限；
- MCP：映射到 `configOverrides.mcp_servers.learning_companion_<id>`；
- ambient Skill / MCP 保持禁用；
- 已选 MCP 使用 `default_tools_approval_mode: "approve"`，Agent Loop 仍由 app-server 负责；
- MCP 事件映射为 `mcp:<id>/<tool>`，未知来源按协议错误关闭；
- Skill / MCP 的路径、版本和 Definition 进入 Session 配置指纹。

## 4. 当前业务边界

`mindmap.generate@1` 明确声明 `skills: []` 和 `mcpServers: []`。本次只交付完整基础设施，
不为了验证机制而虚构业务 Skill 或 MCP。首个真实能力由后续 Generation Center 或具体
Workbench 的任务需求注册。

当前延后：MCP OAuth 登录 UI、MCP elicitation 表单、Renderer 能力管理页、第三方 Function
Tool 插件以及通用工具审批 DSL。

## 5. 验证范围

- Skill 目录安装、替换、解析、枚举和删除；
- stdio / streamable HTTP MCP 定义及冲突替换；
- required / optional 能力解析；
- Codex Skill 输入、ambient 隔离、MCP config 映射与事件投影；
- 缺失 required 能力在账号、环境与 Thread 访问前失败；
- Session 指纹随能力版本变化；
- TypeScript、ESLint、针对性 Vitest 和完整 `pnpm check`。
