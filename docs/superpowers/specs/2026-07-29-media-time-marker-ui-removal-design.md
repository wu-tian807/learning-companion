# Audio / Video 时间标记 UI 精简设计

## 背景

Audio 和 Video Workbench 当前都提供显式的“标记当前时间”操作：

- Video 在播放器下方显示时间、格式和“标记当前时间”按钮。
- Audio 在播放器与倍速选择下方显示时间、格式和“标记当前时间”按钮。
- 两种 Workbench 还会把“标记当前时间”贡献到右键菜单和右上角 `...`。

当前产品阶段没有面向音视频的选区或时间标记消费流程，这些入口会让用户看到一个暂时没有后续用途的交互。

## 目标

- 移除 Audio 和 Video 中所有可见的“标记当前时间”入口。
- 精简媒体播放器下方的 UI。
- 保留播放进度恢复和未来音视频 AI 功能所需的时间定位基础。
- 不影响 Markdown、PDF、Plain Text、HTML 和 EPUB 的选区能力。

## UI 调整

### Video Workbench

- 删除播放器下方整条信息栏，包括当前时间、总时长、媒体格式和“标记当前时间”按钮。
- 视频原生 `controls` 继续承担播放、暂停、进度、音量等基础操作。
- Loading 和 Error 遮罩改为覆盖完整 Workbench 内容区域，不再为已删除的底栏保留空间。

### Audio Workbench

- 保留音频原生播放器和倍速选择。
- 删除播放器下方第二行，包括当前时间、总时长、媒体格式和“标记当前时间”按钮。
- Loading 和 Error 遮罩只避让保留下来的播放器控制区。

### 公共操作入口

- 从 Audio 和 Video 的右键菜单中删除“标记当前时间”。
- 从 Audio 和 Video 的右上角 `...` 中删除“标记当前时间”。
- 保留播放/暂停、音频倍速、在文件夹中显示等常用操作。
- 现有尚未启用的音视频 AI Contribution 保持不变。

## 保留的内部能力

本次只删除可见入口，不删除时间定位基础：

- `currentTime`、音量、静音和倍速仍作为 Workbench View State 持久化。
- `audio.time-range` 和 `video.time-range` Anchor 类型继续保留。
- 用户打开右键菜单时，Workbench 仍以当前播放时间构造 Interaction Focus。
- 未来的截帧、转写、片段解释和学习笔记工具可以直接复用当前时间 Anchor。

“播放位置状态”和“用户主动标记时间”是两个概念。本次删除后者，不影响前者。

## 代码范围

- `src/workbenches/audio/renderer.tsx`
- `src/workbenches/audio/renderer-actions.ts`
- `src/workbenches/audio/renderer-actions` 相关测试
- `src/workbenches/video/renderer.tsx`
- `src/workbenches/video/renderer-actions.ts`
- `src/workbenches/video/renderer-actions` 相关测试

不修改 Main Provider、SQLite Schema、Workbench State 协议或 Facility Manifest。

## 验证标准

- Audio 只显示资料占位区、原生播放器和倍速选择，不再显示第二行时间标记。
- Video 只显示原生视频播放器，不再显示额外底栏。
- Audio/Video 右键菜单和 `...` 均不再出现“标记当前时间”。
- 播放位置、音量、静音和倍速仍可保存并在重新打开后恢复。
- Audio/Video 右键 Interaction 仍携带当前时间 Anchor。
- TypeScript、ESLint 和相关单元测试通过。
