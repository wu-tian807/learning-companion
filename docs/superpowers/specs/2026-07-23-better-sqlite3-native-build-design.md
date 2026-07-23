# better-sqlite3 原生模块构建设计

## 目标

在 Learning Companion 的 Electron 43 桌面应用中引入 `better-sqlite3`，稳定支持 macOS 与 Windows，避免因 Electron ABI 变化或缺少本地 C++ 工具链导致安装、开发和打包失败。

本次只配置依赖和构建链路，不创建数据库连接、表结构或业务仓库。

## 方案

- 固定使用 `better-sqlite3@13.0.1`。该版本基于 Node-API，并在 npm 包内直接携带 macOS ARM64、macOS x64、Windows ARM64 和 Windows x64 原生二进制，不再依赖按 Electron ABI 下载预编译包。
- 在 `pnpm-workspace.yaml` 中显式允许 Electron 执行安装脚本，同时禁止 `better-sqlite3` 执行隐式源码构建。受支持平台直接使用包内的 Node-API 二进制。
- 在 Electron Forge 的重建配置中忽略 `better-sqlite3`，避免 `@electron/rebuild` 对兼容 Electron 的 Node-API 二进制进行无意义的源码重编译。
- 使用 `@electron-forge/plugin-auto-unpack-natives` 将 `.node` 文件自动放到 `app.asar.unpacked`。
- 在主进程 Vite 配置中把 `better-sqlite3` 标记为外部依赖，防止 Rollup 将原生模块错误地合并进 JavaScript。
- 删除 Linux 的 DEB/RPM Maker，只保留 macOS ZIP 与 Windows Squirrel。
- 增加 macOS、Windows GitHub Actions 构建矩阵。每个平台独立安装、检查并执行 `electron-forge make`，避免不可靠的跨平台原生模块打包。

## 构建边界

- macOS：支持 ARM64 与 x64 原生二进制；当前 CI 在 Apple Silicon runner 上验证 ARM64 产物。
- Windows：支持 x64，CI 在 Windows x64 runner 上验证 Squirrel 安装包。
- Linux：不属于当前发布目标，不配置 Linux Maker 或 CI。
- 暂不配置 macOS 签名、公证和 Windows 代码签名；这些在发布证书准备完成后单独接入。

## 验证

本地 macOS 验证：

1. 使用锁文件安装依赖。
2. 运行类型检查、Lint 和测试。
3. 直接在 Electron 运行时加载 `better-sqlite3`，创建内存数据库并验证写入、查询和 FTS5。
4. 执行 macOS `package` 与 `make`。
5. 从打包后的 ASAR 解包目录加载原生模块，再次执行数据库烟雾测试。

Windows 验证由 GitHub Actions 在 Windows runner 上完成相同的安装、检查、数据库烟雾测试与 `make`，并上传生成的安装包。

## 升级规则

Electron 或 `better-sqlite3` 的版本升级必须单独提交，并重新通过 macOS、Windows 的完整构建矩阵。不得在未验证原生模块加载与 FTS5 的情况下自动合并大版本升级。
