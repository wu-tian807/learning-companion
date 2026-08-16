# 媒体字幕外部依赖与模型总表

> 日期：2026-08-16
> 状态：外部依赖基础设施已实现，字幕执行链待接入
> 范围：Video 与 Audio 共用的媒体解码、原文字幕识别和中英字幕翻译依赖。

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

| 内部能力 | 运行时与模型 | 产品角色 |
| --- | --- | --- |
| 快速翻译 | Mozilla Bergamot 英中、中英双向模型 | 默认本地快速翻译；适合尽快提供双语字幕 |
| 高质量翻译 | Hy-MT2 1.8B Q4_K_M；CPU 包带 llama.cpp CPU，NVIDIA 包带 Vulkan Runtime | 提高术语、完整性和自然度；是否使用由任务决定，不再要求用户另装组件 |

翻译只消费稳定的原文 Cue，不负责生成时间轴。原文、译文与双语视图的完整协议见
`docs/superpowers/specs/2026-08-16-video-subtitle-translation-design.md`。

## 4. 用户实际看到的安装体验

设置页只显示一个 `视频/音频字幕组件` 和一个安装按钮。下表是内部自动选择结果，
不是用户选项：

| 内部配置 | 一次下载内容 | 下载量 |
| --- | --- | ---: |
| CPU 兼容配置 | FFmpeg、SenseVoice、Bergamot、Hy-MT2 + llama.cpp CPU | 约 1.50 GiB |
| NVIDIA 加速配置 | FFmpeg、Whisper CUDA、Bergamot、Hy-MT2 + llama.cpp Vulkan | 约 2.43 GiB |

检测到 NVIDIA GPU 时选择加速配置；检测失败、数据异常或没有 NVIDIA GPU 时使用
CPU 兼容配置。两种配置使用同一个组件 ID 和安装目录，因此同一时刻只保留一套。
底层仍按资源逐一下载和校验，但这些细节不暴露为多个按钮。

## 5. 本轮完成边界

本轮只完成：

1. 多来源 Bundle 的下载、累计进度、大小与 SHA-256 校验；
2. ZIP、GZip 与普通文件的安全安装和原子提交；
3. 一个媒体字幕组件、两套自动匹配硬件且互斥的内部资源配置；
4. Workbench 侧运行时路径解析，供后续媒体任务调用。

本轮不声称字幕已经能在主应用中生成。下一步仍需实现后台媒体作业、Artifact 缓存、
逐 Cue 事件、语言路由、取消与错误恢复，再接入 Video/Audio UI。
