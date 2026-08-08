# Asset 派生资源与 Office 预览设计

> 状态：第一阶段已实施，待真实 Office 文件与 LibreOffice 安装验收
>
> 决策日期：2026-07-30
>
> 范围：可重建的 Asset 派生资源、DOC/DOCX/PPT/PPTX 转 PDF、Office
> Workbench、与现有 PDF Viewer 的复用。本设计不实现 Office 编辑、思维导图
> Workbench、Attachment 或 Asset Relation 表。

## 1. 背景

Learning Companion 需要稳定预览常见学习资料：

- Word：`.doc`、`.docx`；
- PowerPoint：`.ppt`、`.pptx`。

这些格式不适合在 Renderer 中分别重新实现完整排版引擎：

- 只支持 DOCX 的 HTML 转换方案不能覆盖旧 `.doc`；
- PPTX 的纯前端渲染方案成熟度和兼容性不足；
- HTML 与 Office 排版模型存在差异，复杂表格、分页、字体和版式难以稳定还原；
- Learning Companion 第一阶段只需要可靠查看、选择文字和建立学习 Anchor，
  不需要直接编辑 Office 原文件。

因此使用受控 LibreOffice 将 Office 文件转换成 PDF，再复用现有 PDF.js
查看能力。原文件永远不被修改。

## 2. 核心判据：Asset、Attachment 与 Artifact

“机器生成”不是 Artifact 的充分条件。分类取决于用户语义和是否可无损重建。

### Asset

Asset 是用户拥有的、可以独立打开的长期学习内容：

- 出现在 Project 的 Asset 列表中；
- 可以被用户编辑、命名、引用和分享；
- 删除会损失用户认可或编辑后的内容；
- 正文保存在 Project Workspace 文件中。

AI 生成的思维导图、讲义或 Markdown，只要成为用户可持续维护的学习内容，
就是 Asset。

### Attachment

Attachment 是依附于 Asset 或内容位置的学习沉淀：

- 用户笔记；
- AI 解释；
- 高亮；
- 书签；
- 时间标记。

它具有 Anchor 语义，不是渲染缓存。

### Artifact

Artifact 是机器生成、隐藏、可重建的技术派生物：

- 不出现在 Asset 列表；
- 用户不会直接编辑其正文；
- 可以根据原 Asset 和 Producer 版本重新生成；
- 可以被安全清理；
- 用于加速或支持 Workbench 渲染。

Office 预览 PDF、缩略图、波形缓存、OCR 中间结果、思维导图布局缓存或导出预览
都可以是 Artifact。

### 思维导图的组合

```text
Mind Map JSON / Markdown
    = Asset

Mind Map Asset → 来源资料
    = AssetRelation

节点 → 来源 Asset 的具体位置
    = Anchor / Asset Reference

缩略图、自动布局缓存、导出 PDF
    = AssetArtifact
```

如果 AI 只生成了临时候选结果，它仍处在任务 staging 或恢复状态；用户确认后
再创建 Asset。不能为了“尚未确认”把用户内容长期塞入 Artifact。

## 3. 设计目标

1. 为所有可重建的 Asset 派生文件建立统一空间。
2. 文件正文保存在 Project Workspace，SQLite 只保存索引。
3. 数据库永远不指向半生成文件。
4. 派生资源可以按来源 Revision 和 Producer Version 判断过期。
5. 删除 Asset 时可以安全清理派生资源。
6. DOC/DOCX/PPT/PPTX 使用一个 Office Workbench。
7. Office Workbench 复用 PDF.js 查看层，但保留自己的 Workbench 和 Anchor 身份。
8. 已有有效 PDF Artifact 时，不要求 LibreOffice 仍然安装。
9. LibreOffice 缺失、安装中、转换中和失败都有明确 UI。
10. 为缩略图、OCR、媒体转码等后续 Producer 保留扩展边界。

## 4. 非目标

本阶段不实现：

- 编辑或保存 Office 原文件；
- Office 协作、批注、宏、动画和嵌入媒体播放；
- OCR；
- PDF 内容回写到 Office；
- 思维导图 Workbench；
- Attachment、Anchor 或 Asset Relation 数据库表；
- Artifact 跨 Project 共享；
- Artifact 云同步；
- 用户手动管理隐藏 Artifact。

## 5. Project Workspace 目录

Workspace 增加内部派生资源目录：

```text
<Project Workspace>/
├── assets/
│   ├── imported/
│   └── generated/
├── attachments/
└── .learning-companion/
    ├── workspace.json
    └── artifacts/
        └── <assetId>/
            └── <producerId>/
                └── <artifactRevision>.<extension>
```

示例：

```text
.learning-companion/
└── artifacts/
    └── asset-123/
        └── builtin.office.preview/
            └── sha256-abc123.pdf
```

约束：

- `relativePath` 永远相对于 Project Workspace；
- 路径必须经过 Workspace Path Manager 安全解析；
- Producer ID 只能来自受信任 Registry；
- 文件名使用内容 Revision，避免覆盖仍被 Session 使用的旧文件；
- 临时生成目录不放在最终 Artifact 目录中；
- `.learning-companion/artifacts` 是应用内部目录，不作为 Add Asset 默认来源。

## 6. 数据模型

### 6.1 AssetArtifact

```ts
interface AssetArtifact {
  readonly assetId: string;
  readonly producerId: string;
  readonly artifactKey: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly sourceRevision: string;
  readonly producerVersion: string;
  readonly artifactRevision: string;
  readonly updatedTime: number;
}
```

字段含义：

- `assetId`：原始 Asset；
- `producerId`：生成者，例如 `builtin.office.preview`；
- `artifactKey`：同一 Producer 下的稳定用途，例如 `preview`、`thumbnail`；
- `relativePath`：Workspace 内的实际文件；
- `mediaType`：派生文件 MIME；
- `sourceRevision`：生成时原内容 Revision；
- `producerVersion`：生成协议版本和关键工具版本；
- `artifactRevision`：派生文件内容 Hash；
- `updatedTime`：索引更新时间。

主键：

```text
(asset_id, producer_id, artifact_key)
```

第一阶段不增加独立 Artifact ID，也不冗余 `projectId`。Project 可以通过
`assetId` 外键取得。

### 6.2 SQLite 表

```ts
assetArtifacts = sqliteTable(
  'asset_artifacts',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    producerId: text('producer_id').notNull(),
    artifactKey: text('artifact_key').notNull(),
    relativePath: text('relative_path').notNull(),
    mediaType: text('media_type').notNull(),
    sourceRevision: text('source_revision').notNull(),
    producerVersion: text('producer_version').notNull(),
    artifactRevision: text('artifact_revision').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.assetId, table.producerId, table.artifactKey],
    }),
  }),
);
```

SQLite 是 Artifact 索引，文件是 Artifact 内容。这里不增加 `manifest.json`：

- 数据库丢失后，Artifact 可以重新生成；
- 文件丢失后，索引检查会判定失效并重新生成；
- 不维护两个互相竞争的索引事实来源。

## 7. 模块职责

```text
src/main/artifacts/
├── asset-artifact.ts
├── asset-artifact-database.ts
├── asset-artifact-file-manager.ts
├── asset-artifact-producer.ts
├── asset-artifact-registry.ts
└── asset-artifact-service.ts
```

### AssetArtifactDatabase

- CRUD 和按 Asset 查询；
- SQLite Row 与纯数据对象映射；
- 使用外键级联清理索引；
- 不访问文件系统；
- 不执行 Producer。

### AssetArtifactFileManager

- 无状态文件操作；
- 生成 staging 和最终相对路径；
- 校验路径没有逃逸 Workspace；
- 验证产物基本格式和 Hash；
- 原子移动；
- 清理旧 Revision 和孤儿文件；
- 不访问 SQLite。

### AssetArtifactRegistry

- 注册受信任 Producer；
- 检查重复 ID；
- 按 `producerId` 查找；
- 不执行生成。

### AssetArtifactService

- 协调数据库、文件系统和 Producer；
- 查询并验证已有 Artifact；
- 对同一个 `(assetId, producerId, artifactKey)` 任务去重；
- 比较 `sourceRevision` 和 `producerVersion`；
- 创建、提交、失效和清理 Artifact；
- Project 或 Asset 生命周期结束时取消未提交任务。

### AssetArtifactProducer

```ts
interface AssetArtifactProducer {
  readonly id: string;
  readonly version: string;
  supports(request: AssetArtifactRequest): boolean;
  produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedArtifact>;
}
```

Producer 只把结果写入指定 staging 目录，不直接更新数据库或最终目录。

## 8. Artifact 提交流程

```text
解析原 Asset
→ 取得 sourceRevision
→ 查询索引
→ 校验索引字段和实际文件
→ 命中则返回
→ 创建独立 staging
→ Producer 生成
→ 验证媒体格式和内容 Hash
→ 移动到不可变 Revision 路径
→ SQLite 事务 upsert 索引
→ 事务提交后清理旧 Revision
→ 返回 Artifact Handle
```

崩溃边界：

- Producer 失败：只有 staging，数据库不变；
- 最终移动后、数据库提交前崩溃：留下可清理孤儿文件；
- 数据库提交后崩溃：索引已经指向完整不可变文件；
- 旧文件只能在新索引提交后清理；
- 应用启动或 Project 打开时可以执行限量孤儿清理。

Artifact 文件不能直接复用 Asset 的 `ContentRef` 数据对象，因为它没有独立 Asset
身份。Service 返回受控 Artifact Handle，并通过现有内容资源协议向 Workbench
提供 URL。

## 9. Office 媒体类型

扩展显式 MIME 映射：

| 扩展名 | mediaType |
| --- | --- |
| `.doc` | `application/msword` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.ppt` | `application/vnd.ms-powerpoint` |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |

Office 文件不走纯文本 Fallback。Asset 创建后 `mediaType` 仍然遵守不可变原则。

## 10. Office Workbench

```text
src/workbenches/office/
├── shared.ts
├── main.ts
├── renderer.tsx
├── renderer-actions.ts
└── office-preview-producer.ts
```

Workbench ID：

```text
builtin.office
```

Producer ID：

```text
builtin.office.preview
```

一个 Office Workbench 支持四种 MIME，并在 Bootstrap 中区分：

```ts
type OfficeDocumentKind = 'word' | 'presentation';
```

### 10.1 Bootstrap 状态

Office Workbench 不把“运行时未安装”当作不可恢复的通用异常。Bootstrap 使用
显式状态：

```ts
type OfficeWorkbenchBootstrap =
  | {
      readonly status: 'ready';
      readonly documentKind: OfficeDocumentKind;
      readonly contentUrl: string;
      readonly sourceRevision: string;
      readonly state: OfficeWorkbenchState;
    }
  | {
      readonly status: 'runtime-required';
      readonly documentKind: OfficeDocumentKind;
      readonly library: ExternalLibrarySnapshot;
    }
  | {
      readonly status: 'converting';
      readonly documentKind: OfficeDocumentKind;
      readonly progress?: OfficeConversionProgress;
    }
  | {
      readonly status: 'failed';
      readonly documentKind: OfficeDocumentKind;
      readonly error: AppErrorPayload;
    };
```

如果有效 Artifact 已存在，Bootstrap 直接进入 `ready`，不检查 LibreOffice
当前是否安装。

### 10.2 打开流程

```text
Office Provider 解析原 Asset
→ 计算 sourceRevision
→ 查询 builtin.office.preview / preview
→ 有效则注册 Artifact 内容 URL
→ 没有或过期则检查 LibreOffice
→ 缺失则返回 runtime-required
→ 用户安装后重试
→ LibreOffice Producer 转换
→ Artifact Service 提交
→ 注册 Artifact 内容 URL
→ Renderer 复用 PDF Viewer
```

## 11. LibreOffice 转换

转换命令使用参数数组调用，不拼接 Shell 字符串。核心参数包括：

```text
--headless
--convert-to pdf
--outdir <staging-output>
-env:UserInstallation=file:///<isolated-profile>
```

要求：

- 每个任务使用独立的临时 Profile；
- 输入文件只读，输出进入任务 staging；
- LibreOffice 转换任务第一阶段全局单并发；
- 有超时和取消；
- 限制日志大小；
- Session 切换和 Project 关闭时取消未提交任务；
- 完成后校验文件头、非零大小，并使用 PDF.js 或 PDF 解析器完成基本可打开验证；
- 清理临时 Profile、转换目录和进程。

`producerVersion` 至少包含：

```text
office-preview-protocol-version + libreoffice-version
```

更换 LibreOffice 或转换参数会自然使旧 Artifact 过期。

LibreOffice 官方文档提供命令行转换和过滤器说明：

- [PDF 命令行参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html?DbPAR=SHARED&System=MAC)
- [LibreOffice 转换过滤器](https://help.libreoffice.org/latest/om/text/shared/guide/convertfilters.html?DbPAR=WRITER&System=WIN)

## 12. PDF Viewer 复用

当前 PDF Workbench 的 PDF.js UI 需要抽取为内部共享组件，例如：

```text
src/renderer/workbench-viewers/pdf/
├── PdfDocumentViewer.tsx
├── pdf-document-adapter.ts
└── styles.css
```

原生 PDF Workbench 与 Office Workbench 都使用该 Viewer，但各自保留：

- Workbench Manifest 和 ID；
- Bootstrap 协议；
- State Key；
- Anchor 工厂；
- Context Menu / Overflow Contribution；
- 错误和运行时状态。

不能把 Office Asset 临时伪装成 `application/pdf`，也不能让 Office Provider
调用 `PdfWorkbenchProvider`。共享的是 PDF 表现层和 PDF.js Adapter，不是领域
身份。

### 12.1 文字选择

LibreOffice 导出的文本型 PDF 通过 PDF.js Text Layer 支持文字选择，接入现有
Text Selection Facility。

- 扫描图片中的文字不可选；
- 字体轮廓化或转换失败的文字可能不可选；
- 后续 OCR 是新的 Producer / Workbench 能力，不在本阶段处理。

### 12.2 分页

- Word 使用转换后 PDF 页；
- PowerPoint 一张幻灯片对应转换后 PDF 的一页；
- PDF Viewer 保持现有分页、缩放和滚动能力；
- Office 的阅读状态保存于 `workbench_states`，不进入 Artifact 表。

### 12.3 Workbench 物化能力

Office 转 PDF 是 Office Workbench 的能力，而不是 Generation 或通用 Artifact 层的媒体
策略。`MainWorkbenchProvider` 可选提供 `materializeContent()`；Office Provider 在该方法
中通过 `AssetArtifactService.getOrCreate()` 返回自己实际使用的 PDF 内容。

Workbench 的 `preparePreview` 与 Generation prepare 共用同一个 Office 物化实现：前者把
返回的 PDF 注册为渲染 URL，后者只把同一个 PDF 复制到任务 Workspace。Generation 不认识
LibreOffice、Office MIME、Producer ID 或 Artifact Key。未提供物化能力的 Workbench 继续
使用 Asset 原始内容。

`LibreOfficePreviewProducer` 的实现归属 Office Workbench；通用 Main 层只保留 Artifact
Registry、Service、Database 和文件生命周期基础设施。

## 13. Anchor 语义预留

本阶段不创建 Anchor 表，但 Office Workbench 不使用 `pdf.*` Anchor 作为最终
领域身份。

未来建议：

```text
office.page
office.text-range
presentation.slide
presentation.text-range
```

Anchor Payload 应包含：

- 原 Office Asset ID；
- 原内容 `sourceRevision`；
- 页或幻灯片信息；
- 选中文本和必要的前后文 Quote；
- 生成预览所用的 `producerVersion`。

Word 的分页可能随字体和转换器版本变化，因此页码不是唯一稳定定位信息。Quote
用于重新附着或明确提示 Anchor 已过期。

PowerPoint 页码通常可映射幻灯片编号，但 Anchor 仍属于原 PPT/PPTX Asset，
不是隐藏 PDF Artifact。

## 14. UI

### 14.1 Runtime Required

Office 内容区展示：

- 当前文件类型；
- 需要 LibreOffice 生成预览的原因；
- 官方来源、许可证和近似体积；
- 当前外部库安装位置；
- “安装并预览”；
- “更改存储位置”；
- “取消”。

安装期间在原内容区展示下载、校验和安装阶段；用户离开 Workbench 不必终止
已经确认的运行时安装。

### 14.2 Converting

展示：

- 正在生成预览；
- 文件名；
- 当前阶段；
- 取消按钮。

转换任务只服务当前 Artifact 请求。用户离开或打开其他 Asset 时可以取消。

### 14.3 Failed

可操作错误：

- 文件加密；
- 文件损坏；
- LibreOffice 不支持；
- 权限不足；
- 磁盘空间不足；
- 运行时失效；
- 转换超时。

UI 提供：

- 重试；
- 重新安装或修复运行时；
- 在 Finder / 文件资源管理器中显示原文件；
- 取消。

不能使用右上角容易忽略的轻提示作为唯一反馈。

## 15. 删除、失效与清理

- 删除 Asset：数据库外键删除 Artifact 索引，Service 清理对应 Artifact 目录；
- 删除 Project：在 Project 生命周期卸载后清理数据库记录；是否删除 Workspace
  仍遵守 Project 删除策略，不因 Artifact 自动扩大物理删除范围；
- 原文件 Revision 变化：旧索引判定过期，生成新 Revision 后清理旧文件；
- Producer Version 变化：按同样流程重建；
- Artifact 文件 Missing / Invalid：删除失效索引并重新生成；
- 孤儿文件：只清理 `.learning-companion/artifacts` 中符合受控布局且不被索引
  引用的文件；
- 永不递归清理用户 Workspace 的其他目录。

## 16. 错误边界

### 用户错误

- 原文件不存在或不可访问；
- 加密或损坏；
- 磁盘空间不足；
- 用户取消；
- 外部运行时没有安装；
- 转换不支持。

### 内部错误

- Artifact 索引与不变量冲突；
- Producer 返回 Workspace 外路径；
- Registry 缺少声明；
- 不可能的 Bootstrap 状态；
- 数据库或进程管理异常。

所有异常最终都经过 IPC 错误映射；但 `runtime-required`、`converting` 和用户取消
是正常状态，不应依赖抛异常驱动 UI。

## 17. 测试策略

### Artifact 单元测试

- Mapper 和复合主键；
- Source / Producer Revision 命中和过期；
- 路径逃逸；
- 任务去重；
- staging 失败不修改索引；
- 文件提交后数据库失败产生可清理孤儿；
- DB 成功后旧 Revision 才被清理；
- Asset 级联删除和文件清理边界。

### Office Provider 测试

- 四种 MIME 选择同一 Provider；
- 有效 Artifact 无需 Runtime；
- 缺少 Runtime 返回 `runtime-required`；
- 安装完成后重试；
- 转换中状态；
- Session 关闭取消转换；
- Word 和 Presentation Bootstrap 差异；
- 原文件 Revision 改变触发重建。

### PDF 共享层回归

- 原生 PDF 行为不变；
- Office PDF 分页、缩放和滚动；
- 单行和多行文字选择；
- Context Menu、Overflow 和 Text Selection Facility；
- 状态按不同 Workbench ID 隔离。

### 转换验收样本

每种格式至少准备：

- 简单文字；
- 表格和图片；
- 中文和英文字体；
- 多页 / 多幻灯片；
- 可选择文字；
- 损坏文件；
- 加密文件；
- 旧 `.doc` / `.ppt`。

样本若有版权限制，不进入公开仓库。

## 18. 实施顺序

1. 新增 Office MIME 映射。
2. 新增 `asset_artifacts` Schema、Migration 和数据库层。
3. 新增 Artifact File Manager、Registry 和 Service。
4. 从 PDF Workbench 抽取可复用 PDF Viewer。
5. 建立 Office Workbench 协议和空状态 UI。
6. 实现 LibreOffice Preview Producer。
7. 接入 External Library Service。
8. 实现运行时安装、转换、失败和重试 UI。
9. 接入 Artifact 删除、失效和孤儿清理。
10. 完成 macOS / Windows 验收。

## 19. 已确认决策

- DOC/DOCX/PPT/PPTX 使用 LibreOffice 受控转换 PDF；
- 第一阶段只读，不编辑 Office；
- 使用一个 `builtin.office` Workbench；
- 复用 PDF.js 表现层，不复用 PDF Workbench 的领域身份；
- 转换 PDF 是 Artifact，不是 Asset；
- Artifact 文件放在 Project Workspace，SQLite 保存索引；
- 不增加 Artifact `manifest.json`；
- 有有效 Artifact 时不要求运行时继续存在；
- 思维导图正文是 Asset，其缓存和导出才可能是 Artifact；
- Attachment 引用 Asset、AssetRelation 和 AssetArtifact 是三个不同关系维度。
