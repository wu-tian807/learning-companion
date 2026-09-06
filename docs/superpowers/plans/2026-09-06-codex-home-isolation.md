# Codex 会话隔离与原生登录复用

## 目标和授权范围

- LC 的执行 Home 固定到 Electron Documents 下的 `Learning Companion/.codex`。
- 复用已有文件式 Codex 登录；用户默认 Home 不再收到 LC 的新会话。
- 不迁移旧 rollout，不清空 LC 的业务数据库、资料或生成结果。
- 旧会话 ID 找不到时，沿用 Provider 对明确 missing-thread 的新建与重新绑定逻辑。
- 已持久化 GenerationTask checkpoint 仍保持精确恢复语义，不把失败/中断的旧执行伪装成成功恢复；必要时重新发起业务任务。
- 现有刷屏记录的归档另行处理，本次不修改用户已有会话。

## 执行步骤

1. 从当前 `origin/main` 新建 `codex/isolate-codex-home` worktree，保留脏主目录。
2. 拆分执行 Home 与凭据来源解析，显式固定 SQLite 位置，过滤继承的全局认证环境变量。
3. 使用原生凭据文件链接，处理源文件替换、删除、重启、权限限制及独立登录。
4. 添加文件/连接/真实 app-server 组合回归，复查旧 session 缺失与精确恢复边界。
5. 运行 focused tests、`pnpm check`、Windows integration、打包和 Electron smoke。
6. 完成自审、记录验证结果，再交付；本次不自动发布 PR 或合并。

## 实现边界

Bootstrap 只组装路径与 Runtime。Codex 适配层拥有凭据来源、文件链接和调用前同步。
Workbench、Renderer、Preload、GenerationTask 的协议保持原状。

执行进程的 `CODEX_HOME`、`CODEX_SQLITE_HOME`、`-c sqlite_home` 一致指向 LC Home。
命令行 override 优先于私有配置中可能遗留的 SQLite 路径。
不读取/复制用户的 `config.toml`、skills、plugins、sessions 或历史数据库。
LC 已有的显式 Skill/MCP 选择路径保持原状。禁用进程级 Apps/Plugins 自动发现，
避免刚登录独立 Home 就启动与 LC 任务无关的插件同步。

## 登录文件共享

首次选择已有 LC 登录，其次查找显式 `CODEX_HOME`、旧 LC runtime Home、用户默认 Home。
凭据来源解析延迟到 Provider 连接建立，认证故障不会中断整个 Electron 应用初始化。

文件式共享只建立 `auth.json` 链接，不在 JS 中解析或转发 access/refresh token。
同磁盘优先硬链接；跨磁盘/不支持硬链接时尝试文件软链接。
无法建立链接时保持私有 Home 未登录，用户可以使用现有登录入口在 LC 独立登录。
不回退到共享整个 Home，也不复制 refresh-token bundle。
仅有 OS keyring 且没有可读 auth.json 的登录当前不支持自动借用。

`learning-companion-auth-source.json` 仅保存版本与来源路径。先原子保存来源，后创建链接，
使重启能识别借用关系，不能把源文件删除后留下的硬链接误判为独立登录。
每个认证/线程/Turn 操作前检查源文件与目标文件的设备号/inode 和修改时间，
原文件被原子替换时重建链接，原地写入新账号/刷新 token 时重新加载原生认证。
源文件删除后移除 LC 的链接，并显式清除执行实例的缓存认证；原生 account/read 本身不会清除该缓存。
原生认证重载失败时保留待重载状态，下次调用必须先重试成功，才能执行任务。
无法建立链接且私有凭据原本为空时，不重复发送退出通知。

用户主动在 LC 登录/退出登录前，先移除 LC 的借用链接，再原子记录独立认证选择；
因此这些操作不会覆盖或删除用户原 Codex 凭据。该选择跨重启保留。
自动 token 刷新继续由原生 Codex 在同一个文件上处理；这不引入独立的 refresh-token 副本。
并发客户端的 OAuth 刷新仍服从 Codex 原生行为，账号切换在下一次 LC 调用前同步。

## 本地验证中排除的方案

- Windows 普通文件软链接创建实际返回 EPERM，不能作为唯一方案。
- 固定版本 0.146.0 的原生登录写入通过硬链接更新同一文件，已用假凭据验证。
- 外部 token RPC 虽能以 ephemeral 模式登录，但固定版本会把 token 响应写入原生诊断 SQLite；
  因此不采用该实验性接口，不依赖内部 `chatgptAuthTokens` 模式。

## 边界测试矩阵

| 行为 | 层次 | 正常与边界 | 证据 |
|---|---|---|---|
| Home 隔离 | 路径 + 进程 | 默认/显式/旧来源、相对路径拒绝、环境变量覆盖 | home-resolver / app-server-process tests |
| 凭据共享 | 文件 | 同 inode、并发 prepare、原生写入、原子替换、源删除/重建 | auth-file-link tests |
| 重启 | 文件 + 原生 runtime | 已记录来源、源删除后重启、独立登录选择 | auth integration tests |
| 登录/退出 | 连接 + 原生 runtime | 先解除共享、原件保留、退出后不自动复用 | auth-connection / auth integration tests |
| 权限失败 | 文件 | EXDEV -> symlink、EPERM、损坏 marker、无秘密错误 | auth-file-link tests |
| 生命周期 | 连接 | 序列化、错误后重试、等待期间关闭、不再发送请求 | auth-connection tests |
| 新线程 | 真实 app-server | 新 rollout 仅在 LC Home，来源目录无 sessions/DB | auth integration tests |
| 旧线程 | Provider | 明确 missing 才重建，临时错误不重建，checkpoint 保持精确恢复 | codex-agent-provider / generation-task-agent-session tests |
| 业务/UI | 不改 UI 合约 | Electron 初始化、Preload 调用与认证状态 smoke | 最终验证记录 |

不涉及数据库 schema、资料所有权、Attachment 删除、UI 交互修改或平台打包依赖调整。
真实 ChatGPT 登录/付费模型集成只在显式 opt-in 环境运行；常规回归使用隔离的假凭据。

## 验证结果

2026-09-06，Windows x64；基于 `origin/main` 的 `8de58c2`，独立分支 `codex/isolate-codex-home`。

| 检查 | 结果 |
|---|---|
| 最终定向认证测试 | 3 个文件、13 项通过 |
| `pnpm check` | TypeScript、ESLint 通过；400 个测试文件、1,887 项测试通过；4 个文件/8 项按原有平台或 opt-in 条件跳过 |
| `pnpm test:windows-integration` | 1 项通过，子进程树终止验证 |
| `pnpm package` | Windows x64 打包成功 |
| `pnpm smoke:native` | Electron 43.2.0 / SQLite 3.53.3 通过 |
| `pnpm verify:package:native` | better-sqlite3、canvas、pdfjs 打包依赖通过 |
| Electron 实际启动 | 独立 userData/Documents，界面渲染正常；Preload health 为 ok，Provider 为 ready，来源目录仅 auth.json，来源/目标同 inode，无 renderer 错误 |
| 原生 Agent 执行 | 固定 Codex 0.146.0 + 本地 Responses fixture，实际生成 LC_ISOLATED_OK，校验 Authorization，关闭/重启后恢复完整 Turn |
| `git diff --check` | 通过 |

最后一轮完整检查起于本地 06:05:23，随后重新打包并在 06:06 复验 Electron。
Electron 证据位于本机临时目录 `lc-home-electron-smoke-eFXjOO`（result.json / screenshot.png），
检查日志为 `lc-home-isolation-check.log`、`lc-home-isolation-package.log`、`lc-home-isolation-electron.log`。

自审未发现剩余阻断项。所有变更属于 Bootstrap 组装与 Codex 适配层，业务资料、Renderer/Preload 合约、
Workbench 上下文所有权和持久化 schema 无变更。结论：`READY_FOR_PR`，尚未发布 PR 或运行远程 CI。

已知限制与后续：

- 未进行真实 ChatGPT OAuth token 轮换/多客户端并发刷新验证；本次原生认证测试使用合成凭据，模型请求只到本地 fixture。
- macOS ARM64 行为及安装包构建需后续 CI；本地没有改动打包依赖，未运行 `pnpm make`。
- 文件系统不允许两种文件链接，或只有 OS keyring 凭据时，需要在 LC 使用现有入口独立登录。
- 旧 Provider session 不迁移；普通继续会话遇到明确 missing 可重建。旧进行中任务的精确 checkpoint 恢复仍要求原线程存在，失败后需重新发起任务。
- 历史刷屏任务的清理由后续单独处理；本次没有修改用户默认 Home 的已有会话或真实登录凭据。
- 主工作区未提交内容保持原状；此分支的实现尚未切换到用户当前运行版本。
