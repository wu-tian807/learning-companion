# Project IPC、Asset Shell 与时间契约收口实施计划

> 依据：`docs/superpowers/specs/2026-07-27-module-boundary-cleanup-design.md`
>
> 日期：2026-07-27
>
> 状态：已完成

## 实施原则

- 只调整已经确认的模块归属、命名与未落库契约。
- 不改变共享 IPC 通道、Preload 或 Renderer 调用方式。
- 不修改文件选择器、managed-json 装配或 Attachment 真实链路。
- 每个改动单独提交，提交前运行对应测试。
- 不修改或提交用户已有的 `AGENTS.md` 和 `tsx教程.md`。

## 阶段一：Project 生命周期 IPC 归位

1. 将 `project:open`、`project:close` Handler 移入 `ipc/projects.ts`。
2. 让 Project IPC 测试覆盖打开、关闭、非法请求和 Handler 移除。
3. 从 Asset IPC 的依赖、测试和清理逻辑中移除 ProjectService。

验证：

```bash
pnpm typecheck
pnpm vitest run src/main/ipc/projects.test.ts src/main/ipc/assets.test.ts
```

提交：`重构：将 Project 生命周期 IPC 归位`

## 阶段二：Asset Shell 服务改名

1. 将文件改名为 `asset-shell-service.ts` 和对应测试文件。
2. 将公开接口、依赖接口和类统一改为 `AssetShellService*`。
3. 更新 Composition Root 和 Asset IPC 的依赖名称。
4. 保持 `revealInFolder()` 行为和错误语义不变。

验证：

```bash
pnpm typecheck
pnpm vitest run src/main/assets/asset-shell-service.test.ts src/main/ipc/assets.test.ts
rg -n "AssetFileService|asset-file-service" src
```

提交：`重构：明确 Asset Shell 平台服务`

## 阶段三：扩展骨架时间契约

将以下字段从 `Date` 改为 Unix 毫秒 `number`：

- `AssetAttachment.createdTime`
- `AssetAttachment.updatedTime`
- `WorkbenchStateRecord.updatedTime`
- `AssetRelation.createdTime`

不新增数据库、构造函数或运行时校验。

验证：

```bash
pnpm typecheck
pnpm vitest run src/main/attachments src/main/workbench
rg -n "createdTime: Date|updatedTime: Date" src
```

提交：`重构：统一扩展骨架时间契约`

## 阶段四：回归与记录

```bash
pnpm check
git diff --check
```

完成后把设计和计划状态改为“已实施/已完成”，记录测试结果并提交：

`文档：记录模块边界收口结果`

## 执行记录

- Project 生命周期 IPC 已迁移至 Project IPC，通道和 Renderer API 保持不变。
- Asset 平台服务已统一为 `AssetShellService`，旧文件名和类型名无残留。
- 所有已预留扩展骨架中的时间字段均使用 Unix 毫秒。
- 新增 AssetAttachment 时间戳构造与克隆测试。
- 静态扫描确认生产代码中不存在旧 AssetFileService 名称或 `Date` 类型时间字段。
- `pnpm check`：36 个测试文件、139 项测试全部通过。
