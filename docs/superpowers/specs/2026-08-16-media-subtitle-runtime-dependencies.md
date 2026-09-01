# 媒体字幕外部依赖与模型总表

> 日期：2026-08-16
> 状态：已实现；2026-08-28 将字幕翻译迁移到 GenerationTask；2026-09-01 将说话人识别归入字幕组件
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

| 内部能力 | 运行时与模型 | 产品角色 |
| --- | --- | --- |
| 媒体解码 | FFmpeg 8.1.2 | 把音视频规范化为 16 kHz 单声道 PCM，并读取媒体信息 |
| Windows CPU 字幕与说话人 | funasr-llama.cpp 0.1.9 + SenseVoiceSmall Q8 + FSMN-VAD；sherpa-onnx FastClustering + pyannote segmentation + CAMPPlus | 先生成真实 VAD 句段，再离线把每个 Cue 归属到 speaker；不伪造重叠文本 |
| Windows NVIDIA 字幕与说话人 | MOSS Transcribe Diarize Q5 GGUF + transcribe.cpp CUDA | 联合生成中英文字幕、说话人和重叠说话内容 |
| Apple Silicon 字幕与说话人 | MOSS Transcribe Diarize Q5 GGUF + transcribe.cpp Metal | 与 NVIDIA 使用相同 Artifact 契约，不下载 Windows 或 CPU 模型 |

本机同源样例中，MOSS Q8 CUDA 在受控双人重叠音频上的 RTF 为 0.0379，三个重叠窗口
全部找回；真实中文课程样本 CER 为 2.37%。Q5 是正式安装档，用更小权重换取可接受的
精度与显存成本。MOSS CPU 已测得慢于实时，因此 CPU 不安装 MOSS；CPU 继续使用
SenseVoice，并把约 30 MB 的说话人模型提前放进字幕包。SenseVoice 的时间轴来自 VAD
句段，不提供词级时间戳，也不能从同一时段恢复两份重叠文本。

MOSS 按 180 秒窗口运行，并保留 20 秒交叠区用于跨窗去重与 speaker ID 续接，避免整部
长视频一次性占用显存。联合转写允许多个 Cue 在时间轴上重叠；CPU 后处理路径仍保持
一条转写文本，只给 Cue 标注主 speaker。两条路径都写入统一的 speaker-aware 字幕
Artifact，配音不再重复下载或运行说话人模型。

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

| 内部配置 | 一次下载内容 | 下载量 |
| --- | --- | ---: |
| Windows CPU 兼容配置 | FFmpeg、SenseVoice、FSMN-VAD、sherpa-onnx 与两个说话人模型 | 约 399 MiB；安装后约 800 MiB；建议预留 1.5 GB |
| Windows NVIDIA 加速配置 | FFmpeg、独立 Python、transcribe.cpp CUDA、所需 CUDA 运行库、MOSS Q5 | 约 1.5 GiB；安装后约 2.5 GB；建议预留 3.5 GB |
| macOS Apple Silicon 配置 | FFmpeg、独立 Python、transcribe.cpp Metal、MOSS Q5 | 约 713 MiB；安装后约 1.3 GB；建议预留 2.0 GB |

Apple Silicon 选择 Metal 配置；Windows 检测到 NVIDIA GPU 时选择 CUDA 配置，否则
使用 CPU 兼容配置。三种配置使用同一个组件 ID 和安装目录，因此同一时刻只保留一套。
底层仍按资源逐一下载和校验，但这些细节不暴露为多个按钮。

本次替换保留原组件版本目录并提升安装格式号。旧 Whisper 安装会显示为“安装异常”，
用户执行“清理异常安装”后再安装新档位；这样旧模型在原位置被完整删除，不会因新建
日期目录而成为应用不可见的磁盘孤儿。

## 5. 当前完成边界

当前已经完成下载校验、硬件档位选择、speaker-aware 字幕识别、Artifact 缓存、逐 Cue 翻译事件、
GenerationTask 恢复以及 Video Workbench UI。字幕组件仍只负责 FFmpeg 与 ASR；
翻译所用 Connection、模型和思考力度由低智能 Provider Selector 独立决定。

Video 与 Audio Workbench 均已接入这套能力。Windows CUDA 已完成真实重叠样例冒烟；
Apple Silicon 已注册固定 Metal 产物，但仍需在真实 macOS 设备上完成安装与长视频验证。
