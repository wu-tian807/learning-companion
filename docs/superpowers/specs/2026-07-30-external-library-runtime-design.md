# 外部运行时管理设计

> 状态：第一阶段已实施，待 macOS / Windows 真机安装验收
>
> 决策日期：2026-07-30
>
> 范围：大型可选运行时的注册、下载、校验、安装、发现、迁移和 UI 状态。
> LibreOffice 是第一位使用者，但本设计不把框架绑定到 Office。

## 1. 背景

Learning Companion 后续会逐步依赖一些体积较大、不能适合全部打入 Electron
安装包的外部运行时，例如：

- LibreOffice：DOC、DOCX、PPT 和 PPTX 转 PDF；
- FFmpeg：音视频转码、截取和未来录屏处理；
- OCR Runtime：扫描资料的文字识别；
- 其他媒体分析或本地模型组件。

这些依赖必须做到按需安装，并且不能默认全部占用系统盘。应用需要一套统一的
外部运行时基础设施，而不是让每个 Workbench 独立实现下载器和路径设置。

## 2. 设计目标

1. 外部运行时按需下载，不增加基础安装包体积。
2. macOS 和 Windows 使用一致的领域接口。
3. 设置中提供统一的外部库根目录。
4. 默认目录位于用户 Documents，而不是 Electron `userData`。
5. 用户改变根目录时真实迁移已有安装。
6. 下载、校验、解包和切换过程可恢复，不暴露半安装状态。
7. 应用固定精确版本、官方来源和 SHA-256，不执行来源不明的文件。
8. 同一运行时的安装、迁移和删除任务互斥。
9. Workbench 只声明自己需要什么运行时，不理解 DMG、MSI 或目录迁移细节。
10. 为 FFmpeg、OCR 等后续运行时保留注册边界。

## 3. 非目标

本阶段不实现：

- Linux 外部运行时安装；
- 自动静默更新已经可用的运行时；
- 第三方插件任意注册和执行下载脚本；
- 把外部运行时放进 Project Workspace；
- 把运行时目录同步到云盘；
- 允许 Workbench 直接执行任意二进制；
- LibreOffice 以外的真实运行时 Definition。

## 4. 存储边界

### 4.1 设置

`settings.json` 增加：

```ts
interface AppSettings {
  readonly externalLibrariesPath: string;
}
```

默认值：

```text
<Documents>/Learning Companion/externalLib
```

该值在 Electron `app.whenReady()` 后通过 `app.getPath('documents')` 计算。设置文件
本身仍保留在 Electron `userData`，不迁入 Documents。

设置只保存根目录。运行时的版本、平台、可执行文件和校验信息来自应用内
Definition；实际安装状态由磁盘上的受控目录和安装标记判定。

### 4.2 目录

```text
externalLib/
├── .staging/
├── .downloads/
└── libreoffice/
    └── <pinned-version>/
        └── <platform-arch>/
            ├── installation.json
            └── runtime/
```

示例平台：

```text
darwin-arm64
darwin-x64
win32-x64
```

规则：

- `.partial` 下载文件只存在于 `.downloads`；
- 解包和验证只在 `.staging` 进行；
- 只有完整验证后才原子移动到正式版本目录；
- `installation.json` 记录 Definition ID、精确版本、平台、架构、包 SHA-256、
  安装格式版本和安装时间；
- 正式目录不允许 Workbench 自行写入。

## 5. 领域模型

### 5.1 Definition

```ts
interface ExternalLibraryDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly installationFormatVersion: number;
  readonly packages: readonly ExternalLibraryPackage[];
  readonly sourceUrl: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
}

interface ExternalLibraryPackage {
  readonly platform: 'darwin' | 'win32';
  readonly architecture: 'arm64' | 'x64';
  readonly packageType: 'dmg' | 'msi';
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly expectedSize: number;
  readonly executableRelativePath: string;
  readonly payloadRelativePath?: string;
  readonly verifyCodeSignature?: boolean;
}
```

Definition 是随应用发布的可信清单：

- 版本和 SHA-256 必须精确固定；
- URL 必须来自受信任官方来源；
- 更新依赖版本要经过正常代码评审和发布；
- Renderer 不能提交 URL、Hash、安装命令或可执行路径。

### 5.2 运行时状态

```ts
type ExternalLibraryStatus =
  | 'not-installed'
  | 'discovering'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'available'
  | 'invalid'
  | 'migrating'
  | 'failed';
```

对 Renderer 返回 Snapshot：

```ts
interface ExternalLibrarySnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly expectedSize: number;
  readonly rootPath: string;
  readonly status: ExternalLibraryStatus;
  readonly installationPath?: string;
  readonly progress?: {
    readonly completedBytes: number;
    readonly totalBytes: number;
  };
  readonly errorCode?: string;
}
```

Renderer 只获得展示所需信息，不获得可执行文件路径。

## 6. 模块职责

```text
src/main/external-libraries/
├── external-library-definition.ts
├── external-library-registry.ts
├── external-library-service.ts
├── external-library-path-manager.ts
├── external-library-installer.ts
├── external-library-installation-store.ts
└── installers/
    ├── macos-dmg-installer.ts
    └── windows-msi-installer.ts
```

### ExternalLibraryRegistry

- 注册应用内可信 Definition；
- 按 ID 查找 Definition；
- 校验重复 ID、平台包缺失和非法相对路径；
- 不下载、不安装、不保存状态。

### ExternalLibraryService

- 应用级有状态 Service；
- 发现、安装、删除和迁移运行时；
- 为每个 Definition 维护 Snapshot；
- 保证同一运行时任务互斥；
- 向 IPC 发送进度和最终状态；
- 对调用方提供受限的“运行指定能力”入口，而不是裸可执行路径。

### ExternalLibraryPathManager

- 无状态路径和文件操作；
- 创建受控根目录；
- 解析版本目录、下载目录和 staging 目录；
- 校验目标路径位于配置的根目录下；
- 执行同盘 rename 或跨盘复制、校验、切换和清理；
- 不保存当前设置和当前运行时。

### ExternalLibraryInstaller

- 定义安装器接口；
- 根据 `packageType` 和平台选择具体实现；
- 只接受已经完成 Hash 校验的本地包；
- 把内容安装到 staging；
- 返回验证后的运行时目录。

### ExternalLibraryInstallationStore

- 读写 `installation.json`；
- 验证安装标记与 Definition 是否一致；
- 验证关键文件存在且可执行；
- 不使用 SQLite 维护安装清单，使目录迁移后安装信息能随目录移动。

## 7. LibreOffice 安装

### 7.1 macOS

第一阶段支持：

- Apple Silicon；
- Intel x64。

流程：

1. 下载官方 DMG；
2. 校验固定 SHA-256；
3. 使用 `hdiutil attach` 只读挂载；
4. 将 `LibreOffice.app` 复制到 staging；
5. 卸载 DMG；
6. 校验 Bundle、`soffice` 可执行文件和架构；
7. 在条件允许时执行 `codesign` / `spctl` 验证；
8. 提交到正式目录。

### 7.2 Windows

第一阶段支持 Windows x64。

流程：

1. 下载官方 MSI；
2. 校验固定 SHA-256；
3. 使用 MSI 管理安装模式展开到 staging；
4. 不把 LibreOffice 注册成系统默认 Office 应用；
5. 校验 `program/soffice.exe`；
6. 提交到正式目录。

LibreOffice 官方文档支持无界面命令行参数和文档转换；The Document Foundation
文档也给出了 Windows MSI 管理安装到自定义目录的方式：

- [LibreOffice 启动参数](https://help.libreoffice.org/latest/ast/text/shared/guide/start_parameters.html)
- [LibreOffice PDF 命令行参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html?DbPAR=SHARED&System=MAC)
- [Windows 并行与管理安装](https://wiki.documentfoundation.org/Installing_in_parallel/Windows/es)

具体 LibreOffice 版本和包 Hash 不写死在本设计文档中。实施时选择当期稳定版本，
写入源码 Definition，并由测试固定。

## 8. 安装流程

```text
Workbench 请求能力
→ Service 查询 Snapshot
→ 已安装则返回
→ 未安装则 Renderer 展示确认 UI
→ 用户确认
→ 下载 .partial
→ 校验大小和 SHA-256
→ 安装到 staging
→ 验证运行时
→ 写 installation.json
→ 原子提交正式目录
→ 发布 available 事件
→ Workbench 重试原任务
```

要求：

- 网络失败可以重试；
- 用户可以取消下载；
- 校验失败必须删除 staging 和不可信下载；
- 安装失败不能覆盖已有可用版本；
- 应用退出后残留的 `.partial` 和 staging 可在下次启动清理；
- 同一 Library ID 只允许一个活动安装任务；
- 不在 Renderer 中执行下载或系统命令。

## 9. 目录迁移

### 9.1 设置 UI

全局设置页提供：

- 当前外部库路径；
- “更改位置”；
- 已安装组件、版本、状态和占用空间；
- 安装、重试、移除；
- 打开目录。

第一次需要安装 LibreOffice 时，确认界面同时展示：

- 来源和许可证；
- 近似下载和安装体积；
- 当前安装路径；
- “安装并预览”；
- “更改存储位置”；
- “取消”。

### 9.2 迁移事务

路径更改不是单纯修改字符串：

```text
暂停新的安装任务
→ 扫描旧根目录和目标根目录
→ 形成冲突计划
→ 用户处理未知冲突
→ 同盘 rename 或跨盘复制
→ 校验目标安装
→ 原子保存 settings.json
→ 切换 Service 根目录
→ 清理旧受控目录
→ 恢复任务
```

任何关键阶段失败：

- 设置仍指向旧目录；
- 旧运行时保持可用；
- 临时目标可以安全清理；
- UI 显示失败原因和残留位置。

### 9.3 冲突规则

| 目标状态 | 默认行为 |
| --- | --- |
| 同版本、标记和 Hash 全部一致 | 复用目标安装 |
| 已识别的其他版本 | 并存 |
| 受控目录但安装不完整 | 提示清理后重试 |
| 同名但没有合法安装标记 | 要求用户决定 |

未知冲突允许：

- 保留两份：先把目标未知内容重命名为冲突备份，再迁移受控安装；
- 替换：将目标未知内容移动到可恢复备份，再迁移；
- 跳过：该运行时留在旧路径并变为非活动残留；
- 选择其他目录。

绝不静默覆盖未知文件。

## 10. IPC 与错误

Preload 暴露窄接口：

```ts
externalLibraries.list()
externalLibraries.install({ libraryId })
externalLibraries.cancel({ libraryId })
externalLibraries.remove({ libraryId })
externalLibraries.chooseRootDirectory()
externalLibraries.migrateRoot({ targetPath, conflictDecisions })
externalLibraries.subscribe(listener)
```

约束：

- `libraryId` 必须在 Registry 中存在；
- Renderer 不传 URL、命令或真实二进制路径；
- 进度通过订阅事件发送，最终结果仍由请求 Promise 返回；
- 用户取消归类为 `cancelled`，不弹错误确认框；
- 网络、磁盘空间、权限、校验失败和冲突使用可操作的用户错误；
- 非预期异常由统一 IPC 错误兜底。

## 11. 安全与进程隔离

- 只下载应用内 Definition 声明的官方包；
- 必须校验 SHA-256；
- 安装器参数使用参数数组，不拼接 Shell 字符串；
- 运行时子进程限制工作目录、环境变量、超时和输出大小；
- LibreOffice 使用独立用户 Profile，避免连接或影响用户自己的 LibreOffice；
- 临时 Profile 位于应用 Cache 或 Recovery 下；
- Workbench Session 关闭时取消尚未提交的转换任务；
- Renderer 不获得 Node、文件系统或进程执行能力。

LibreOffice 的 User Profile 具有单进程占用语义，转换任务必须使用隔离的
`-env:UserInstallation=file:///...` Profile：

- [LibreOffice User Profile](https://wiki.documentfoundation.org/UserProfile/pt-br)

## 12. 测试策略

### 单元测试

- Definition 注册和平台选择；
- 路径逃逸和非法相对路径；
- 安装标记解析和版本不匹配；
- Snapshot 状态转换；
- 同一运行时任务互斥；
- 冲突计划生成；
- 同盘和跨盘迁移失败回滚。

### 集成测试

- 使用小型假运行时包测试下载、Hash、staging 和原子提交；
- 模拟断网、磁盘不足、校验失败和应用重启；
- 模拟目标目录已有合法安装和未知文件；
- 验证迁移失败不会改变 settings；
- 验证 IPC 不接受未知 Library ID。

### 平台验收

- macOS Apple Silicon；
- macOS Intel 构建至少完成 CI 或真机验证；
- Windows x64；
- LibreOffice 首次安装、已有安装发现、删除和重新安装；
- 自定义外部磁盘路径以及跨磁盘迁移。

真实 LibreOffice 大包不进入普通单元测试和 Git 仓库。

## 13. 实施顺序

1. Settings 数据结构与默认路径。
2. Definition、Registry、Installation Store 和 Path Manager。
3. Service 状态机、下载器和进度 IPC。
4. macOS DMG Installer。
5. Windows MSI Installer。
6. Settings UI 和迁移 UI。
7. 注册 LibreOffice Definition。
8. Office Workbench 接入运行时能力。

## 14. 已确认决策

- 保留 Electron `userData` 存放设置和 SQLite；
- 外部库默认放在 Documents；
- 用户可以自定义和真实迁移外部库目录；
- 目录迁移不能静默覆盖未知文件；
- 安装状态以磁盘安装标记为准，不新增 SQLite 安装表；
- LibreOffice 使用官方包、固定版本和固定 Hash；
- 外部运行时框架必须可被后续 FFmpeg、OCR 等复用；
- 第一阶段平台范围为 macOS 和 Windows。
