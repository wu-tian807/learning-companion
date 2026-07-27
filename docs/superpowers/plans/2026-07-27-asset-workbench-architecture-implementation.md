# Asset 与资料工作台骨架实施计划

> 依据：`docs/superpowers/specs/2026-07-27-asset-workbench-architecture-design.md`
>
> 日期：2026-07-27
>
> 状态：已完成

## 实施原则

- 每层先写失败测试，再实现最小可运行能力。
- 保留 `AssetDatabase` 当前单活动 Project Map 和 SQLite 同步语义。
- 不修改现有 `assets` 表结构；`content_kind` 与 `content_path` 映射为新的 `AssetContentRef`。
- availability 与 checkedTime 只存在于运行时解析结果，不持久化。
- 未完成的 Workbench 不注册，不伪装成可用功能。
- Renderer 不获得文件路径访问、数据库或通用 IPC 能力。
- 每个阶段单独提交，提交前执行与改动相称的测试。

## 阶段一：共享契约和通用注册表

### 新增文件

- `src/shared/workbench/protocol.ts`
- `src/shared/workbench/manifest.ts`
- `src/shared/workbench/attachment.ts`
- `src/shared/workbench/anchor.ts`
- `src/main/content/content-ref.ts`
- `src/main/content/content-handle.ts`
- `src/main/content/content-resolver-registry.ts`
- `src/main/attachments/attachment.ts`
- `src/main/attachments/attachment-service.ts`
- `src/main/attachments/attachment-registry.ts`
- `src/main/attachments/anchor-registry.ts`
- `src/main/relations/asset-relation-service.ts`
- 对应单元测试。

### 工作内容

1. 定义只允许 JSON 可序列化值的 `JsonValue`。
2. 定义 Workbench Manifest、Bootstrap、Command、Result 和 Session 请求契约。
3. 定义 Attachment、Target、Anchor 和 Relation 纯数据契约。
4. 实现 `ContentResolverRegistry`：
   - kind 唯一注册；
   - 重复注册失败；
   - 未知 kind 返回领域错误；
   - 正确分派具体 Resolver。
5. 实现 Attachment 与 Anchor Registry 的唯一键和版本校验。
6. 提供空 AttachmentService、空 AssetRelationService，读操作返回空数组，写操作返回明确的未支持领域错误。
7. 扩展 `AppErrorCode` 和错误策略。

### 验证

- Registry 成功注册和正确分派。
- 重复注册、无效版本、未知类型失败。
- 空 Service 的读写语义明确。
- `pnpm typecheck`。
- 相关 Vitest 测试。

### 提交

```text
功能：建立资料工作台共享契约与扩展注册表
```

## 阶段二：AssetContentRef、Resolver 与 AssetService

### 新增文件

- `src/main/assets/asset-service.ts`
- `src/main/content/resolvers/local-file/local-file-content-resolver.ts`
- `src/main/content/resolvers/managed-json/managed-json-content-resolver.ts`
- `src/main/content/resolvers/managed-json/managed-json-content-repository.ts`
- 对应单元测试。

### 修改文件

- `src/main/assets/asset.ts`
- `src/main/assets/asset-database.ts`
- `src/main/assets/asset-file-service.ts`
- `src/main/projects/project-service.ts`
- `src/main/ipc/assets.ts`
- `src/main/index.ts`
- 现有 Asset、ProjectService 与 IPC 测试。

### 工作内容

1. 把 Asset 内部的 `contentLocator` 拆为持久化 `contentRef`。
2. `AssetDatabase` 从 SQLite Row 映射 `contentRef`，不再执行 availability 检查。
3. 保持 Asset Map、CRUD、计数、生命周期版本和 Relink 持久化语义。
4. 本地文件 Resolver 复用现有 `DefaultLocalFileLocatorChecker`，生成：
   - `AssetContentStatus`
   - 可关闭的本地文件 `ContentHandle`
5. managed JSON 只建立 Repository 与 Resolver 契约，不在生产 Registry 注册。
6. `AssetService` 负责：
   - 加载 Project Asset 并解析运行时内容状态；
   - 导入本地文件、检测 mediaType 和默认名称；
   - 更新、删除、刷新、Relink；
   - 为 Workbench 解析单个 Asset 内容；
   - 对外返回不可变的运行时 Asset 快照。
7. `AssetFileService` 改为依赖 `AssetService` 或并入其系统文件操作能力，避免绕过新的运行时状态。
8. `ProjectService` 通过 `AssetService` 加载、卸载和删除工作区。
9. IPC 继续返回现有 `AssetSummary.contentLocator` 兼容结构，避免本阶段无必要地改写左侧栏。

### 边界处理

- 同一 Asset 的多个解析请求以最新生命周期版本为准。
- Resolver 返回不可用状态时不得包含 Handle。
- Refresh 替换运行时快照但不写 SQLite。
- Relink 先检查新路径，再验证 mediaType 兼容，最后写数据库并更新运行时快照。
- 卸载 Project 时关闭该 Project 已打开的 ContentHandle。

### 验证

- Asset Row 与 `contentRef` 双向映射。
- Project 加载不在 Database 内执行文件 IO。
- AssetService 正确生成 available/missing/inaccessible/invalid 状态。
- 导入、刷新、Relink、Reveal、删除行为保持。
- SQLite 数据结构和现有用户数据无需迁移。
- ProjectService 生命周期回归。
- Asset IPC 回归。
- `pnpm typecheck`、相关 Vitest 测试。

### 提交

```text
重构：分离 Asset 持久化数据与内容解析服务
```

## 阶段三：Main Workbench Registry、Session 与 IPC

### 新增文件

- `src/main/workbench/workbench-registry.ts`
- `src/main/workbench/workbench-session.ts`
- `src/main/workbench/workbench-session-manager.ts`
- `src/main/workbench/workbench-state-repository.ts`
- `src/main/ipc/workbench.ts`
- `src/workbenches/unsupported/shared.ts`
- `src/workbenches/unsupported/main.ts`
- 对应单元测试。

### 修改文件

- `src/shared/ipc.ts`
- `src/preload/index.ts`
- `src/main/errors/app-error.ts`
- `src/main/index.ts`
- `src/main/projects/project-service.ts`
- 相关 IPC 与 ProjectService 测试。

### 工作内容

1. 实现 Main `WorkbenchRegistry`：
   - 注册 Provider；
   - 校验 Manifest；
   - 按 mediaType 和 Content Capability 选择；
   - 无匹配项时使用 Unsupported Provider。
2. 实现空 `WorkbenchStateRepository`。
3. 实现 `WorkbenchSessionManager`：
   - 一个活动 Session；
   - 打开、命令、关闭；
   - 异步打开替代保护；
   - Session ID 校验；
   - 失败回滚和 Handle 释放。
4. 实现 Unsupported Main Provider，只返回安全 Bootstrap，不读取文件内容。
5. 新增受限 Workbench IPC 与 Preload API。
6. Project 卸载和删除前关闭活动 Workbench Session。
7. Main 初始化时组合 Resolver、Attachment、State 和 Workbench Registry。

### 验证

- Manifest 无效或重复注册启动失败。
- 可用内容无匹配 Workbench 时选择 Unsupported。
- 不可用内容返回包含 availability 的 Unsupported Bootstrap。
- 快速切换时旧请求不能覆盖新 Session。
- 关闭和重复关闭释放 Handle。
- 过期 Session 命令被拒绝。
- Project 卸载顺序为 Workbench Session → AssetService → AssetDatabase。
- IPC 请求与响应运行时校验。
- `pnpm typecheck`、相关 Vitest 测试。

### 提交

```text
功能：建立 Main 资料工作台会话与受限 IPC
```

## 阶段四：Renderer Host 与 UnsupportedWorkbench

### 新增文件

- `src/renderer/workbench/AssetWorkbenchHost.tsx`
- `src/renderer/workbench/renderer-workbench-registry.ts`
- `src/renderer/workbench/AttachmentHost.tsx`
- `src/workbenches/unsupported/renderer.tsx`
- Renderer 纯逻辑测试或组件测试所需文件。

### 修改文件

- `src/renderer/ProjectPage.tsx`
- `src/renderer/env.d.ts`
- `src/renderer/index.css`（仅在现有样式无法覆盖状态时修改）
- `src/shared/ipc.ts`

### 占位目录

- `src/workbenches/plain-text/README.md`
- `src/workbenches/markdown/README.md`
- `src/workbenches/pdf/README.md`
- `src/workbenches/mindmap/README.md`

### 工作内容

1. 实现 Renderer Registry，按 Workbench ID 注册 View。
2. 实现 `AssetWorkbenchHost` 状态机：
   - idle；
   - opening；
   - ready；
   - failed。
3. selectedAssetId 变化时打开新 Session，忽略迟到响应并关闭旧 Session。
4. ProjectPage 卸载或返回 Home 时关闭活动 Session。
5. 实现 Unsupported View：
   - 未选择资料；
   - 文件缺失；
   - 无权限；
   - 路径无效；
   - mediaType 尚无 Workbench。
6. 保留现有 Relink 和刷新入口，通过 Host 事件回调交还 ProjectPage。
7. 实现空 `AttachmentHost`，不产生可见占位内容。
8. Project 页面中栏移除旧的媒体判断分支，统一交给 Host。
9. 未实现模块只保留说明文件，不进入 Registry。

### 验证

- Host 状态转换与迟到响应保护。
- Workbench ID 正确分派，未知 ID 安全兜底。
- 不同 availability 的文案与恢复入口。
- 快速选择 Asset 不出现旧内容闪回。
- 返回 Home 后不再更新已卸载页面。
- 左侧 Asset 增删改查、刷新和状态提示无回归。
- `pnpm typecheck`、相关 Vitest 测试。

### 提交

```text
界面：接入 AssetWorkbenchHost 与不支持类型兜底
```

## 阶段五：整体回归与文档状态

### 验证命令

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### Electron 手动验证

1. 从 Home 打开空 Project，再返回 Home。
2. 添加一个支持映射的本地文件和一个未知二进制文件。
3. 切换 Asset，确认中栏始终由 UnsupportedWorkbench 承载。
4. 删除或移动已添加文件，刷新后确认 missing 状态。
5. Relink 同类型文件并恢复可用。
6. 在 Finder 或 Windows Explorer 中显示文件。
7. 快速切换多个 Asset，确认没有旧 Session 报错弹窗或内容闪回。
8. 删除当前 Project，确认 Session、Asset Map 和数据库数据按顺序清理。

### 文档

- 将设计文档状态更新为“第一阶段已实施”。
- 记录实际目录与设计差异；无差异则明确写明。
- 检查只保留用户已有的未跟踪文件，不纳入提交。

### 提交

仅在文档状态发生变化时提交：

```text
文档：记录资料工作台骨架实施结果
```

## 第一阶段完成标准

- 所有设计中的目录边界均已在仓库中表达。
- 至少一条真实的 Asset → ContentResolver → Session → Main Provider → Renderer View 链路可运行。
- 未实现的媒体能力不会被 Registry 选中。
- 现有本地文件 Asset 工作流无回归。
- 全量检查、原生依赖烟雾测试和打包验证通过。
- 每一层具有独立测试，后续添加 Workbench 不需要修改 Host 主流程。
