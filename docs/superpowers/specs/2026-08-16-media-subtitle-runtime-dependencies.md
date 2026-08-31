# 媒体字幕外部依赖与模型总表

> 日期：2026-08-16
> 状态：已实现；2026-08-28 将字幕翻译迁移到 GenerationTask；2026-08-31 改用低智能档
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

产品只暴露一个字幕组件。安装前由 Main 自动检测 NVIDIA GPU，并选择一套互斥的
识别实现；用户不选择 CPU/GPU，也不会同时下载两套识别模型：

| 内部能力 | 运行时与模型 | 产品角色 |
| --- | --- | --- |
| 媒体解码 | FFmpeg 8.1.2 Essentials | 把音视频规范化为 16 kHz 单声道 PCM，并读取媒体信息 |
| CPU 字幕识别 | funasr-llama.cpp 0.1.9 + SenseVoiceSmall Q8 + FSMN-VAD | 无 NVIDIA GPU 时的中文句段级字幕主路径 |
| NVIDIA 字幕识别 | whisper.cpp CUDA + `large-v3-turbo-q5_0` + Silero VAD | 检测到 NVIDIA GPU 时的中英文高质量时间轴主路径 |

真实 20 分钟中文视频中，SenseVoiceSmall 约 41 秒、CER 4.09%；Whisper CUDA
约 31 秒、CER 2.58%；Whisper CPU `small-q5_1` 约 141 秒、CER 4.61%。因此
不再让 CPU 先运行 SenseVoice、再重复运行 Whisper。CPU 只安装并运行
SenseVoice；NVIDIA 只安装并运行 Whisper。SenseVoice 的时间轴来自 VAD 句段，
不提供词级时间戳；未来需要逐词高亮时再增加独立对齐能力。

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
| CPU 兼容配置 | FFmpeg、SenseVoice、FSMN-VAD | 约 354 MiB |
| NVIDIA 加速配置 | FFmpeg、Whisper CUDA、Whisper 模型、Silero VAD | 约 1.26 GiB |

检测到 NVIDIA GPU 时选择加速配置；检测失败、数据异常或没有 NVIDIA GPU 时使用
CPU 兼容配置。两种配置使用同一个组件 ID 和安装目录，因此同一时刻只保留一套。
底层仍按资源逐一下载和校验，但这些细节不暴露为多个按钮。

## 5. 当前完成边界

当前已经完成下载校验、硬件档位选择、字幕识别、Artifact 缓存、逐 Cue 翻译事件、
GenerationTask 恢复以及 Video Workbench UI。字幕组件仍只负责 FFmpeg 与 ASR；
翻译所用 Connection、模型和思考力度由低智能 Provider Selector 独立决定。

Video 与 Audio Workbench 均已接入这套能力；macOS 字幕运行时仍需独立验证和注册，
不能由 Windows 路径推断为已支持。
