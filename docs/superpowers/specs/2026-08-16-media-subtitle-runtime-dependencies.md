# 媒体字幕外部依赖与模型总表

> 日期：2026-08-16
> 状态：已实现；2026-08-28 将字幕翻译迁移到 GenerationTask；2026-09-01 恢复 Whisper/SenseVoice，并将 Sherpa 统一归入字幕组件
> 范围：Video 与 Audio 共用的媒体解码和原文字幕识别依赖。字幕翻译不再下载本地模型。

## 1. 所有组件放在哪里

所有按需下载的组件继续使用 Learning Companion 已有的外部组件根目录：

```text
<Documents>/Learning Companion/externalLib/
```

用户在设置中更换外部组件位置时，字幕组件与 LibreOffice 一起迁移。每个组件按
`组件 ID / 版本 / 平台` 隔离；下载文件经过大小与 SHA-256 校验，解压完成后再
原子提交，因此失败或取消不会留下“看似安装完成”的目录。

通用下载、校验和安装只存在于 `src/main/external-libraries`。媒体领域只在
`src/workbenches/media-subtitles` 声明具体资源和把已安装目录解析为可执行文件、
模型与 VAD 路径。Video 与 Audio 以后都组合这一能力；Audio 不依赖 Video。

## 2. 原文字幕识别不是翻译的附带功能

产品只暴露一个字幕组件。安装前由 Main 自动检测平台和加速设备，并选择一套互斥的
识别实现；用户不选择 CPU/GPU，也不会同时下载备用识别模型：

| 内部能力            | 运行时与模型                                                  | 产品角色                                                              |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 媒体解码            | FFmpeg 8.1.2                                                  | 把音视频规范化为 16 kHz 单声道 PCM，并读取媒体信息                    |
| Windows CPU 字幕    | funasr-llama.cpp 0.1.9 + SenseVoiceSmall Q8 + FSMN-VAD        | 使用真实 VAD 句段生成中英文字幕                                       |
| Windows NVIDIA 字幕 | whisper.cpp 1.9.2 + Whisper large-v3-turbo Q5 + DTW           | 使用 CUDA 识别并按词时间戳恢复播放器可读的短 Cue                      |
| 共享说话人分析      | sherpa-onnx FastClustering + pyannote segmentation + CAMPPlus | 两个 Windows 档都安装同一份小型 speaker runtime；VoxCPM2 不再重复携带 |

Video 与 Audio 使用同一字幕协议，但调用时机不同：Video 生成原字幕时不运行 Sherpa、
不写 speaker 标签；只有用户点击配音后，才对分离出的 vocals 运行 Sherpa，以挑选各
音色的干净参考段。Audio 在字幕生成后立即运行 Sherpa，把主 speaker 归属写入 Cue，
因此即使用户不使用配音，音频逐句视图也能显示说话人。Sherpa 只能给现有 Cue 做时间
归属，不能从同一时段恢复第二份重叠文本；Artifact 不伪造该能力。

`Paraformer-zh Q8` 只保留在 Demo。当前 GGUF 端口无标点、无可靠段边界与时间戳，
实测 20 分钟中文 CER 7.79%，不注册为用户可安装组件。未来只有完整运行时解决这些
边界后才重新评估。

详细数据与 SRT 质量问题见：

- `demos/subtitle-generation/docs/technology-selection.md`
- `demos/subtitle-generation/docs/youtube-benchmark-findings.md`

## 3. 中英字幕翻译

翻译不属于外部组件。正式链路通过“低智能”Selector 使用现有 Agent：

```text
VideoSubtitleService
  → GenerationTask
  → SubtitleTranslationTaskDefinition
  → TaskAgentSession
  → AgentProvider
  → Translation Artifact
```

TaskDefinition 按真实 Cue 边界分段，并提供前后 Cue 作为只读语境；模型只能返回目标
Cue 的 ID 与译文，不能修改时间轴。Bergamot、Hy-MT2 与 llama.cpp 已从字幕组件中
移除，避免安装一套质量不足且与用户现有模型重复的翻译运行时。完整协议见
`docs/superpowers/specs/2026-08-16-video-subtitle-translation-design.md`。

## 4. 用户实际看到的安装体验

设置页只显示一个 `视频/音频字幕组件` 和一个安装按钮。下表是内部自动选择结果，
不是用户选项：

| 内部配置                | 一次下载内容                                                                      |                                        下载量 |
| ----------------------- | --------------------------------------------------------------------------------- | --------------------------------------------: |
| Windows CPU 兼容配置    | FFmpeg、SenseVoice、FSMN-VAD、sherpa-onnx 与两个说话人模型                        | 约 399 MiB；安装后约 800 MiB；建议预留 1.5 GB |
| Windows NVIDIA 加速配置 | FFmpeg、Whisper CUDA、large-v3-turbo Q5、Silero VAD、sherpa-onnx 与两个说话人模型 | 约 1.31 GiB；安装后约 2.5 GB；建议预留 3.5 GB |

Windows 检测到 NVIDIA GPU 时选择 CUDA 配置，否则使用 CPU 兼容配置。两种配置使用
同一个组件 ID 和安装目录，因此同一时刻只保留一套。
底层仍按资源逐一下载和校验，但这些细节不暴露为多个按钮。

本次回退把字幕 Producer 提升到版本 5、安装格式提升到 4。外部组件保留
`2026.08.28` 路径身份，使旧 MOSS 档位在原目录中被识别为待清理的无效格式，而不是
因新建日期目录变成磁盘孤儿；清理后重新安装时只下载恢复后的 ASR 与共享 Sherpa 资源。

## 5. 当前完成边界

当前已经完成下载校验、硬件档位选择、媒体差异化 speaker 调用、Artifact 缓存、逐 Cue 翻译事件、
GenerationTask 恢复以及 Video/Audio Workbench UI。字幕组件负责 FFmpeg、ASR 与共享 Sherpa；
翻译所用 Connection、模型和思考力度由低智能 Provider Selector 独立决定。

当前正式包只声明 Windows x64。macOS 字幕支持在重新选定并验证可维护的 ASR 运行时前
不注册，避免保留已经撤回的 MOSS Metal 路径。
