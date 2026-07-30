# 外部运行时、Asset Artifact 与 Office 预览实施计划

> 状态：第一阶段代码已完成，待真实 LibreOffice 安装和 Office 文件人工验收

> 依据：
>
> - `docs/superpowers/specs/2026-07-30-external-library-runtime-design.md`
> - `docs/superpowers/specs/2026-07-30-asset-artifacts-office-preview-design.md`
>
> 实施原则：每个阶段保持可编译、可测试和可单独回退；在 Office Workbench
> 注册前，不改变当前不支持类型的用户行为。

## 阶段一：Artifact 数据与领域基础

### 任务 1：Office MIME

修改：

- `src/main/assets/asset-media-type.ts`
- `src/main/assets/asset-media-type.test.ts`

步骤：

1. 先增加 DOC、DOCX、PPT、PPTX 的失败测试。
2. 增加四种显式 MIME 映射。
3. 验证未知二进制 Fallback 行为没有变化。

### 任务 2：Asset Artifact Schema 与 Migration

新增：

- `src/main/database/schema/asset-artifacts.ts`
- `src/main/database/migrations/0007-create-asset-artifacts.ts`

修改：

- `src/main/database/database-context.ts`
- `src/main/database/initialize-database.ts`
- `src/main/database/initialize-database.test.ts`

步骤：

1. 为版本 7 写失败测试。
2. 创建 `asset_artifacts` 复合主键、Asset 外键和索引。
3. 将 Schema 注册到 Drizzle Context。
4. 测试 Asset / Project 删除时的数据库级联。

### 任务 3：Artifact 纯数据与数据库接口

新增：

- `src/main/artifacts/asset-artifact.ts`
- `src/main/artifacts/asset-artifact.test.ts`
- `src/main/artifacts/asset-artifact-database.ts`
- `src/main/artifacts/asset-artifact-database.test.ts`

步骤：

1. 定义不可变 `AssetArtifact` 和输入校验。
2. 实现按复合键 get/upsert/delete/listByAsset。
3. 数据库层只处理 SQLite，不访问文件。
4. 测试非法路径、空键、非法 Revision 和写入冲突。

### 任务 4：Artifact 文件与服务

新增：

- `src/main/artifacts/asset-artifact-file-manager.ts`
- `src/main/artifacts/asset-artifact-file-manager.test.ts`
- `src/main/artifacts/asset-artifact-registry.ts`
- `src/main/artifacts/asset-artifact-registry.test.ts`
- `src/main/artifacts/asset-artifact-service.ts`
- `src/main/artifacts/asset-artifact-service.test.ts`

步骤：

1. 实现受控路径、staging、Hash、验证和原子提交。
2. 实现 Producer Registry。
3. 实现命中、过期、同键任务去重和提交顺序。
4. 使用假 Producer 验证失败不污染索引。
5. 暂不在应用入口创建 Service，等 Office Provider 接入时统一装配。

验收：

```text
pnpm typecheck
pnpm lint
pnpm test -- src/main/assets/asset-media-type.test.ts
pnpm test -- src/main/database/initialize-database.test.ts
pnpm test -- src/main/artifacts
```

## 阶段二：外部运行时基础

### 任务 5：Settings 与路径

修改：

- `src/shared/app-preferences.ts`
- `src/main/settings/settings-repository.ts`
- `src/main/settings/json-settings-repository.ts`
- 对应测试
- `src/main/index.ts`

步骤：

1. 增加 `externalLibrariesPath`。
2. 默认值使用 `<Documents>/Learning Companion/externalLib`。
3. 兼容旧 settings.json 自动补默认值。

### 任务 6：Definition、Registry 与 Installation Store

新增：

- `src/main/external-libraries/external-library-definition.ts`
- `src/main/external-libraries/external-library-registry.ts`
- `src/main/external-libraries/external-library-installation-store.ts`
- 对应测试

步骤：

1. 固定受信任 Definition 契约。
2. 校验 ID、版本、平台、URL、Hash 和相对可执行路径。
3. 读写和验证 `installation.json`。

### 任务 7：下载与安装状态机

新增：

- `src/main/external-libraries/external-library-service.ts`
- `src/main/external-libraries/external-library-path-manager.ts`
- `src/main/external-libraries/external-library-installer.ts`
- 平台 Installer 和测试

步骤：

1. 先使用小型假包覆盖下载、Hash、staging 和提交。
2. 实现任务互斥、取消和进度。
3. 实现 macOS DMG、Windows MSI 安装器。
4. 注册固定 LibreOffice Definition。

### 任务 8：IPC、设置 UI 与迁移

新增或修改：

- `src/shared/ipc.ts`
- `src/preload/index.ts`
- `src/main/ipc/external-libraries.ts`
- Settings UI 与测试

步骤：

1. 暴露 list/install/cancel/remove/choose/migrate/subscribe。
2. 设置页展示路径和安装状态。
3. 实现同盘和跨盘迁移。
4. 实现未知目标冲突确认。

验收：

```text
pnpm check
pnpm package
```

## 阶段三：共享 PDF Viewer 与 Office Workbench

### 任务 9：抽取 PDF 表现层

目标：

- 原生 PDF Workbench 行为完全不变；
- 抽取 PDF.js Viewer、Adapter 和样式；
- 不让共享组件依赖 `builtin.pdf`。

先补齐分页、缩放、滚动、多行选择、Context Menu 和 State 隔离回归测试，再重构。

### 任务 10：Office 协议和 UI

新增：

- `src/workbenches/office/shared.ts`
- `src/workbenches/office/main.ts`
- `src/workbenches/office/renderer.tsx`
- `src/workbenches/office/renderer-actions.ts`
- 对应测试

实现 `ready`、`runtime-required`、`converting` 和 `failed` 四种状态。此时可以先用
假 Producer 验证整个 Workbench 生命周期。

## 阶段四：LibreOffice 转换

### 任务 11：Office Preview Producer

实现：

- 隔离 LibreOffice User Profile；
- 单并发转换队列；
- 超时和 AbortSignal；
- staging 输出；
- PDF 基本验证；
- Producer Version；
- 日志限长和错误映射。

### 任务 12：Artifact 与 Workbench 装配

修改：

- `src/main/index.ts`
- Main / Renderer Workbench Registry
- Project / Asset 删除生命周期

实现：

1. 注册 Artifact 和 External Library Service。
2. 注册 Office Provider 和 Renderer。
3. 有缓存直接预览。
4. 无缓存时安装、转换、重试。
5. 删除 Asset 后清理 Artifact 文件。

## 阶段五：验收与文档

### 自动检查

```text
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### 手工验收

- macOS Apple Silicon；
- macOS Intel 构建；
- Windows x64；
- DOC、DOCX、PPT、PPTX；
- 中文、英文、表格、图片、多页和多幻灯片；
- 缺少运行时、安装失败、取消、重试；
- 自定义外部库目录和跨盘迁移；
- 已有 Artifact 但运行时被删除；
- 原文件变化后自动重建。

### 文档

更新：

- `TECH_STACK.md`
- 用户可见的外部运行时来源、许可证与体积说明；
- 开发期 LibreOffice Definition 更新流程。
