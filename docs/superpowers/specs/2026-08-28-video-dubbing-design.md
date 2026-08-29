# 视频/音频本地配音：最终选型与首版接入

> 更新日期：2026-08-28
> 当前范围：Windows x64 + NVIDIA GPU；Video/Audio 的可靠整轨生成、持久断点和
> 已完成后缀的即时预览。

## 1. 最终选择

首版正式路径采用：

```text
媒体字幕 Artifact
  ├─ 原文字幕：沿用真实 Cue 起止时间
  └─ LLM 翻译：TaskDefinition 分段调用同一 Agent Session
          ↓
FFmpeg 抽取原始音轨
          ↓
sherpa-onnx + UVR-MDX-NET-Inst_HQ_4
  ├─ vocals.wav：选择 one-shot 参考人声
  └─ background.wav：最终保留的背景轨
          ↓
VoxCPM2：按翻译 Cue 从媒体结尾向前生成
          ↓
FFmpeg：逐段适配真实 Cue 时长并混合背景轨
          ↓
AssetArtifact：缓存完整配音音轨
```

- **正式模型：VoxCPM2 官方 Python/CUDA 实现。** 当前盲听中，它的中英文 one-shot 清晰度、音色保持和跨语种表现最好。
- **备选模型：F5-TTS、VoxCPM1.5。** Demo 保留适配器和测试资料，但主程序不下载、不注册、不出现模型选择，避免第一版同时维护三套运行时。
- **人声分离：sherpa-onnx CUDA + UVR HQ4。** 该组合已在真实视频上验证，输出顺序明确为 background、vocals。
- **翻译：Agent TaskDefinition。** 不再安装本地翻译模型；翻译复用工作台 AI Selector，并由 GenerationTask 保留任务状态和 Provider Session。
- **存储：现有 GenerationTask + AssetArtifact。** 不增加字幕表、配音表或 Job 表。

## 2. 为什么现在选择 VoxCPM2

Demo 最初同时验证了 F5-TTS、VoxCPM1.5 与 VoxCPM2。最终不再以安装体积单独决定模型，而以真实用户试听为主：

- VoxCPM2 的中文和英文 one-shot 最清晰，跨语言后仍较好保持说话人身份；
- F5-TTS 的速度和显存成本有优势，因此保留为未来“快速模式”候选；
- VoxCPM1.5 能用，但在本轮盲听中没有形成相对 VoxCPM2 的质量优势；
- CPU 完整媒体克隆耗时不可接受，首版不提供 CPU 路径。

因此产品现在只暴露一条可解释、可验证的高质量路径。只有后续真实设备数据证明需要“快速模式”时，才把 F5-TTS 接入相同 Producer 接口。

## 3. LLM 分段翻译

翻译必须走项目既有主链：

```text
MediaSubtitleService
  → GenerationTask
  → SubtitleTranslationTaskDefinition
  → TaskAgentSession
  → 当前 Workbench Provider Selector
  → MediaSubtitleTranslationProducer
  → AssetArtifactService
```

每个翻译任务：

1. 最多取 16 个目标 Cue、约 1400 个字符作为一个目标段；只在真实 Cue 边界切分。
2. 同时提供前 3 个和后 3 个 Cue 作为语境，但明确禁止模型翻译或输出这些上下文。
3. 所有分段使用同一个 `TaskAgentSession`，保证人名、术语和语气可以延续。
4. 模型只返回目标 Cue 的 `id + text`；时间戳不能被模型修改。
5. 每个完整分段通过校验后，逐 Cue 发布翻译进度；最终一次性提交 Translation Artifact。
6. 格式错误只允许同一 Session 修复一次，仍不合法则由 GenerationTask 正常失败和重试。

TaskDefinition 的工作区权限为只读关闭、写入关闭，因为所有字幕都已经放进用户消息；这样可避免 Agent 在工作区做无关探索。该限制只属于这个翻译 TaskDefinition，不是全局 Provider 策略。

## 4. 配音计划与时间轴

- one-shot 参考从分离后的纯人声中自动选择，不让用户额外确认；
- 参考窗口为连续 3–10 秒，跨 Cue 间隔不得超过 700 ms；
- 相邻短译文可以合并，但只能沿真实 Cue 边界，间隔不超过 700 ms、总时长不超过 8 秒；
- 中文朗读文本会把阿拉伯数字转成自然中文读法，字幕画面仍保留原文字；
- VoxCPM2 按 Phrase 倒序生成，因此进度条从最右侧向左扩展；
- 每段生成后用 FFmpeg `atempo + apad + atrim` 精确适配对应 Cue 窗口；不按字数猜时间，也不改写时间戳；
- 每个 Phrase 写入 `voice.wav` 后，立即与同时间范围的背景轨混入持久 `preview.wav`；
- 只有混音文件 flush 完成后才原子更新进度，因此反向白条只覆盖真正可播放的后缀；
- 用户可在生成过程中提前选择“配音”。播放头进入已完成后缀时自动切换 Preview，
  尚未相遇时继续播放原声；完整 Artifact 提交后切换为最终 AAC 音轨。

若源视频画面比原始音轨更长，最终混音以较长音轨为准，再裁到视频时长，不能使用 `amix duration=first` 截掉尾部配音。

## 5. 安装与缓存

设置页注册独立的“VoxCPM2 视频/音频配音组件”：

- VoxCPM2 固定 revision 的 7 个官方模型文件；
- UVR-MDX-NET-Inst_HQ_4 人声分离模型；
- 固定版本的 `uv` 引导程序；
- 模型下载约 5.04 GB，所有资源都有固定大小和 SHA-256；
- 只有安装状态检查确认组件可用后，兼容的 Audio/Video Workbench 才会在后台预热；未安装、平台不支持或已经恢复完整配音 Artifact 时不准备 Python、不启动 Worker；
- 首次成功预热或生成时，在同一个 External Library 根目录准备隔离 Python 3.12、PyTorch CUDA、VoxCPM 与 sherpa-onnx 环境；缓存也全部留在该根目录；
- Audio/Video 的所有打开会话共享一个 VoxCPM2 resolver 和一个模型进程，每个会话成对 retain/release，避免重复加载；
- 空闲预热模型最多驻留 5 分钟；最后一个兼容 Workbench 关闭后保留 30 秒宽限，期间重新打开会取消旧卸载，避免切换页面反复冷启动；
- 正在执行的配音任务不因普通 Workbench 关闭而中止，任务完成后释放一次性 Worker；应用退出则显式中止并等待模型进程和临时 Session 清理完成；
- 卸载 External Library 时，模型、Python 环境和下载缓存可作为一个目录整体删除；不使用系统 Python，也不写项目数据库。

当前第一版只声明 Windows x64。macOS 不以“理论可运行”冒充“已支持”；需要单独完成 Metal 模型、安装体积和真实长视频 RTF 验证后再注册 macOS package。

## 6. Workbench 所有权

可被两种媒体复用的实现位于：

```text
src/workbenches/media-dubbing/
├─ external-libraries/       # VoxCPM2 下载定义与隔离 Runtime
├─ dubbing-phrase-planner.ts # Cue 合并、参考窗口、数字朗读
├─ voxcpm2-worker-sources.ts # UVR 与 VoxCPM2 受控 Worker
├─ voxcpm2-dubbing-producer.ts
├─ media-dubbing-service.ts
└─ main-feature.ts           # 通过 Workbench Catalog 注册依赖与 Producer
```

Audio/Video Workbench 分别持有自己的交互状态和事件命名，只消费同一套媒体配音服务，
彼此不依赖。通用层只提供已有能力：External Library、AssetArtifact、GenerationTask、
Content Resource 和 Workbench Event。`bootstrap` 不判断 VoxCPM2，也不包含媒体配音流程。

失败或中断的配音 checkpoint 保存在目录
`.learning-companion/checkpoints/video-dubbing`。它位于统一的应用私有命名空间；
删除 Project 时随 `.learning-companion` 整体清理，不需要媒体专属删除旁路。

## 7. 已完成验证

本机 RTX 4090 D 已使用正式 Worker 对 9.9 秒真实视频完成：

- FFmpeg 音频抽取；
- CUDA UVR 人声/背景分离；
- VoxCPM2 三段 one-shot 倒序生成；
- 真实 Cue 时长适配；
- 背景与克隆人声混合；
- FFprobe 验证最终音轨为 AAC 且覆盖完整视频时长。

完整流水线约 35–40 秒。该数字包含模型加载和三段生成，只是当前机器的短片工程验证，不是产品性能承诺。

Demo 的 `.runtime` 与 `.models` 曾用于模型赛马，验证完成后已删除；保留源码、测试与评价标准，仓库内不保存大模型或 Python 环境。

## 8. 暂不实现

- 用户拖动后动态重排生成队列；
- 多说话人 diarization 和每人独立 voice profile；
- 失败 Phrase 的逐段原人声回填；
- CPU、macOS、AMD/Intel GPU；
- F5-TTS / VoxCPM1.5 的产品 UI 选择。

这些能力都有明确扩展点，但不进入首版主链，避免实时调度与多运行时把当前可靠实现复杂化。
