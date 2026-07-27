# Plain Text Workbench 菜单与格式控制实施计划

> 依据：`docs/superpowers/specs/2026-07-27-plain-text-workbench-menu-design.md`
>
> 日期：2026-07-27
>
> 状态：已完成

## 实施原则

- `AssetWorkbenchHost` 只提供 Header Actions Target，不理解任何 Plain Text 命令。
- Renderer 不直接读取文件；编码、行尾与保存仍由 Main Provider 和 Content Handle 控制。
- 命令请求、响应和持久化状态均做运行时校验。
- 先补测试，再实现最小能力；每个独立改动单独提交。
- 保留现有恢复快照和外部文件 revision 冲突保护。

## 阶段一：指定编码读取

### 修改文件

- `src/main/content/content-handle.ts`
- `src/main/content/text-content.ts`
- `src/main/content/resolvers/local-file/local-file-content-resolver.ts`
- `src/main/content/resolvers/managed-json/managed-json-content-resolver.ts`
- 对应测试。

### 工作内容

1. 定义受支持文本编码和 `ReadTextContentRequest`。
2. `readText` 接受可选的编码覆盖；未指定时保持自动检测。
3. 本地文件指定编码读取使用严格解码，失败时返回领域错误。
4. Managed JSON 只允许默认或 UTF-8。
5. 保持 BOM、行尾检测和 revision 生成语义。

### 验证

- UTF-8、GBK 指定读取成功。
- 无效字节序列失败。
- 自动检测路径无回归。
- Managed JSON 拒绝 GBK。

### 提交

```text
实现指定编码的文本内容读取
```

## 阶段二：Plain Text V2 状态与格式命令

### 修改文件

- `src/workbenches/plain-text/shared.ts`
- `src/workbenches/plain-text/main.ts`
- 对应测试。

### 工作内容

1. 新增 `PlainTextViewOptions` 和 V2 Workbench State。
2. 兼容读取 V1 状态，并在下次写入时升级为 V2。
3. Runtime 分离磁盘 `source.lineEnding` 与 `currentLineEnding`。
4. dirty 判断同时覆盖正文与行尾序列。
5. 新增：
   - `plain-text:set-view-options`
   - `plain-text:set-line-ending`
   - `plain-text:reopen-with-encoding`
6. 编码重开在 Main 再次检查 dirty，成功后返回完整文本快照。
7. Recovery 支持仅格式变化，并恢复当前行尾序列。

### 验证

- V1 状态兼容、V2 状态持久化。
- 显示选项保存与恢复。
- 格式-only dirty、backup、restore、discard、save。
- dirty 时编码重开失败。
- 编码重开失败保持 Runtime 不变。
- 保存继续执行无损编码和 revision 校验。

### 提交

```text
扩展纯文本工作台格式控制协议
```

## 阶段三：Header Actions Target 与菜单

### 修改文件

- `src/renderer/workbench/renderer-workbench-registry.ts`
- `src/renderer/workbench/AssetWorkbenchHost.tsx`
- `src/workbenches/plain-text/renderer.tsx`
- 必要的 Renderer 纯逻辑测试。

### 工作内容

1. Host 创建稳定的 Header Actions DOM Target。
2. Renderer Props 接收 Target；宿主删除静态禁用的三个点。
3. Plain Text Renderer 使用 React Portal 注入菜单。
4. 菜单支持外部点击和 Escape 关闭。
5. CodeMirror 根据状态动态配置自动换行和行号。
6. 行尾选择通过 Workbench 命令更新，并影响 dirty UI。
7. 编码重开仅在 clean 时可用；成功后刷新完整编辑器状态并清空撤销历史。
8. Recovery 显示、保存或重开进行中时禁用相关操作。

### 验证

- Unsupported Workbench 不显示三个点。
- Plain Text Workbench 显示真实菜单。
- 显示选项立即生效并可恢复。
- LF / CRLF 切换更新 dirty 和保存状态。
- dirty 时编码选项禁用。
- 编码重开成功和失败均保持 UI/Main 一致。

### 提交

```text
实现纯文本工作台标题栏菜单
```

## 阶段四：整体验证

### 自动验证

```bash
pnpm check
pnpm smoke:native
pnpm package
pnpm verify:package:native
```

### Electron 验证

1. 打开纯文本 Asset，确认标题栏出现三个点。
2. 切换自动换行与行号，确认 CodeMirror 即时更新。
3. 切换 LF / CRLF，确认进入未保存状态。
4. 不保存切换 Asset，再次打开后确认 Recovery 能恢复格式。
5. 保存后确认磁盘行尾真实变化。
6. clean 时使用 UTF-8 / GBK 重开；失败时确认原内容不变。
7. dirty 时确认编码选项禁用并显示原因。
8. 打开未知媒体类型，确认标题栏没有空的三个点。

## 完成标准

- Host Header Actions 扩展入口已由真实 Workbench 使用。
- Plain Text 菜单所有选项都连接到真实状态或 Main 命令。
- 格式-only 修改不会静默丢失。
- 编码重开与保存不会绕过主进程安全边界。
- 全量测试、Electron 交互和打包验证通过。

## 实施结果

- `pnpm check` 通过：40 个测试文件、161 项测试。
- `pnpm smoke:native` 通过。
- macOS arm64 Electron 产物打包通过。
- 打包后的 `better-sqlite3` 原生模块装载验证通过。
- Electron 实际交互已覆盖菜单显隐、显示选项、行尾切换、编码重开、未保存保护和恢复流程。
