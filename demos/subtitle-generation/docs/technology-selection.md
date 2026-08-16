# 字幕技术选型记录

## 当前结论

桌面端默认候选仍采用 `whisper.cpp`，原因不是假定它一定比所有方案更快，而是它在本项目约束下形成了更好的首版基线。`SenseVoiceSmall` 已完成同素材实测，适合作为无 GPU 的极速中文候选，但不能替代默认中英文引擎：

| 维度 | whisper.cpp | faster-whisper |
| --- | --- | --- |
| Windows 分发 | 原生压缩包，可按需安装 | 需要 Python/CTranslate2 及 GPU 动态库组合 |
| CPU / CUDA 调用 | 同一 CLI 与模型协议 | 同一 Python API，但部署环境不同 |
| 渐进片段 | CLI segment callback 可直接观察 | Python generator 可直接观察 |
| VAD | 原生接入 Silero VAD | 原生接入 Silero VAD |
| 主应用复杂度 | 较低 | 较高 |
| 适合角色 | 默认桌面后端 | 可选高吞吐后端或性能对照 |

该结论只确定“先验证谁”，不等于已经通过产品质量验收。

## 本机首轮实测

开发机为 Intel Core i7-14700KF、NVIDIA RTX 4090 D、Windows。下表使用固定的 Windows 合成语音，只能比较链路与相对性能，不能代表真实课程质量。

| 后端与模型 | 样例 | VAD | 首 Cue | RTF | CER / WER |
| --- | --- | --- | ---: | ---: | ---: |
| CPU + base | 中文 20.05 秒 | 开 | 1.147 秒 | 0.058 | CER 2.74% |
| CUDA + large-v3-turbo-q5_0 | 中文 20.05 秒 | 开 | 1.378 秒 | 0.074 | CER 0% |
| CPU + base | 英文 80.67 秒 | 开 | 1.437 秒 | 0.044 | WER 1.64% |
| CUDA + large-v3-turbo-q5_0 | 英文 80.67 秒 | 开 | 1.447 秒 | 0.029 | WER 0% |
| CPU + base | 英文 80.67 秒 | 关 | 1.204 秒 | 0.039 | WER 0% |
| CUDA + large-v3-turbo-q5_0 | 英文 80.67 秒 | 关 | 1.359 秒 | 0.029 | WER 0% |

80 秒样例不是结束后一次性返回：CUDA 大模型分别在约 1.45、1.87、2.24 秒追加三批 Cue，证明 CLI 的 segment callback 可以承担渐进字幕事件。

VAD 的影响与语言和素材有关。英文连续语音中关闭 VAD 更快且让 CPU `base` 的 WER 降为 0%；中文短样例中关闭 VAD 却让 `base` 输出大量繁体/错字，CER 上升到 39.73%。因此 Demo 保留默认开启和显式关闭两条路径，产品默认值必须由真实中文课程集决定。

## YouTube 人工字幕基准

真实长视频验证推翻了“CPU `base` 可以作为中文默认档”的假设：它在中文 20 分钟样本上的 CER 达到 31.90%，并产生大量繁体字、同音错字和过长 Cue。量化 `small-q5_1` 将同一样本 CER 降到 4.61%，但预计处理 60 分钟中文需要约 7 分钟。CUDA `large-v3-turbo-q5_0` 的中文 CER 为 2.26%–4.81%，预计 60 分钟约 94 秒。

完整中英文 1/5/20 分钟数据、人工字幕排除区间和 SRT 时间轴问题见 [YouTube 基准结论](./youtube-benchmark-findings.md)。

## SenseVoiceSmall 实测

使用官方 `funasr-llama.cpp v0.1.9` Windows AVX2 运行时、`sensevoice-small-q8.gguf` 与 FSMN-VAD，在同一台 i7-14700KF 上运行。中文每档三次取中位数；英文为单次方向性验证。

| 语言 | 时长 | 转录耗时 | RTF | CER / WER | 对比结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 中文 | 1 分钟 | 2.10 秒 | 0.035 | CER 4.47% | 极快，但仍误识别 GPT、姚班等术语 |
| 中文 | 5 分钟 | 11.15 秒 | 0.037 | CER 6.94% | 快于 Whisper CPU 质量档，质量略好 |
| 中文 | 20 分钟 | 41.00 秒 | 0.034 | CER 4.09% | 不如 Whisper CUDA 的 31.13 秒 / 2.58% |
| 英文 | 20 分钟 | 42.35 秒 | 0.035 | WER 19.02% | 明显不如 Whisper CUDA 的 3.50% |

SenseVoiceSmall 的优势是完全不占 GPU，CPU 上预计处理 60 分钟约 2 分钟；模型输出三轮逐字一致，耗时也稳定。缺点是当前裸运行时把完整文本一次性返回，不提供词级时间戳。FSMN-VAD 能给出语音段边界，Demo 据此生成可读 SRT，但句内时间只是按字符比例估算。因此它适合“导入后快速生成中文全文草稿”，还不适合成为高质量、渐进字幕的唯一后端。

## Paraformer-zh Q8 实测

Paraformer 使用相同的 `funasr-llama.cpp` CPU AVX2 运行时和 FSMN-VAD，仅增加约 226 MiB 模型。中文每档同样运行三次；三次 1 分钟文本哈希完全一致。

| 中文时长 | 转录耗时 | RTF | CER | SenseVoiceSmall CER |
| --- | ---: | ---: | ---: | ---: |
| 1 分钟 | 2.00 秒 | 0.033 | 5.15% | 4.47% |
| 5 分钟 | 10.04 秒 | 0.033 | 11.22% | 6.94% |
| 20 分钟 | 39.91 秒 | 0.033 | 7.79% | 4.09% |

它识别对了 SenseVoice 失败的“姚班”“万物皆可 AI”，但仍把 GPT 识别成 GBT，并把“1956”写成“一九五六”。整体 CER 明显更差。更重要的是，当前 GGUF CLI 只在整段结束后返回一行无标点全文；虽然原始 Paraformer 架构具备 CIF 对齐能力，轻量端口尚未暴露时间戳。由全文硬切得到的 SRT 会在词中间换 Cue，不能进入产品。

因此当前不安装 Paraformer 作为默认档。未来只有在完整 FunASR 管线的时间戳、标点或热词能力成为明确需求时，才重新验证对应 ONNX/Python 运行时；不能把原始模型能力自动算到当前 GGUF 端口头上。

## 实际安装体积

| 档位 | 解压后运行时 | 模型 | VAD | 合计（不含下载缓存） |
| --- | ---: | ---: | ---: | ---: |
| CPU + base | 19.9 MiB | 141.1 MiB | 0.8 MiB | 约 162 MiB |
| CPU + small-q5_1 | 19.9 MiB | 181.2 MiB | 0.8 MiB | 约 202 MiB |
| CUDA 12.4 + large-v3-turbo-q5_0 | 1127.4 MiB | 547.4 MiB | 0.8 MiB | 约 1.68 GiB |
| CPU AVX2 + SenseVoiceSmall Q8 | 12.6 MiB | 242.4 MiB | 1.6 MiB | 约 257 MiB |
| CPU AVX2 + Paraformer-zh Q8 | 12.6 MiB | 226.0 MiB | 1.6 MiB | 约 240 MiB |
| 两个 FunASR 模型同时安装 | 12.6 MiB | 468.4 MiB | 1.6 MiB | 约 483 MiB |

CUDA 压缩包本身约 640 MiB，正式安装工作流应在校验和解压成功后删除下载缓存。高质量 CUDA 档不适合无提示地首次自动安装，应由硬件探测后推荐并清楚显示体积；CPU 档可以作为低门槛基线。

## 建议运行档位

- NVIDIA 设备：`whisper.cpp CUDA 12.4 + large-v3-turbo-q5_0`。
- 无兼容 GPU：`whisper.cpp CPU + small-q5_1` 作为默认质量档；`base` 只作为用户明确选择的快速、低质量兼容档，不用于中文默认生成。
- 无兼容 GPU 且强调速度：可提供 `SenseVoiceSmall Q8` 中文快速档，但 UI 必须说明它不是渐进/词级对齐模式，英文仍回退到 Whisper。
- `Paraformer-zh Q8` 当前只保留实验档，不进入自动选择；文本、标点与时间轴均未达到默认后端门槛。
- 长音视频：保留 VAD 开关；当前 Demo 默认开启用于暴露该路径，但主应用在真实课程集完成前不应把 VAD 策略写死。

## 动态选择策略

可以采用不同情况选择不同引擎，但首版应按任务开始前可验证的条件路由，而不是让多个模型同时跑完后“投票”：

| 条件 | 默认选择 | 理由 |
| --- | --- | --- |
| NVIDIA CUDA 可用，强调质量 | Whisper CUDA `large-v3-turbo-q5_0` | 当前中英文 CER/WER、词级时间能力和首 Cue 综合最好 |
| 无 GPU，中文，强调快速预处理 | SenseVoiceSmall Q8 | 20 分钟约 41 秒，明显快于 Whisper CPU 质量档 |
| 无 GPU，英文 | Whisper CPU | SenseVoice 英文 WER 过高，Paraformer-zh 不适用 |
| 用户明确要求精确时间轴 | Whisper；或未来验证完整 FunASR 后再开放 | 当前两个 FunASR GGUF 端口都没有词级时间戳 |
| 领域热词/术语表成为强需求 | 暂不自动选择 | 需单独验证支持热词的完整 Paraformer/SeACo 管线 |

当前 CLI 没有可跨模型比较的可靠置信度，因此不做“某一 Cue 看起来不确定就自动换模型”。缓存键应包含源文件哈希、引擎、模型和参数；切换策略时可以重建字幕 Artifact，但不影响媒体立即播放。Paraformer Q8 暂时只作为实验对照，不出现在普通用户的自动选项中。

## 必须记录的验收指标

| 指标 | 含义 | 首版目标 |
| --- | --- | --- |
| 首条 Cue 延迟 | 启动识别到第一条可展示字幕 | 越低越好；先用实测建立硬门槛 |
| RTF | 转录耗时 / 媒体时长 | `< 1` 才能追上播放，后台预处理期望明显低于 1 |
| 端到端耗时 | 规范化 + 模型执行 + 产物落盘 | 识别真实用户等待成本 |
| CER / WER | 中文字符错误率 / 英文词错误率 | 合成语音只做回归；真实课程集另设门槛 |
| 峰值 VRAM / RAM | 与 Electron、视频解码并存时的资源压力 | 需在目标 8 GB GPU 和 CPU 设备补测 |
| 缓存命中 | 已处理 Asset 是否直接复用字幕 Artifact | 命中时不应重新运行模型 |

## 进入主应用前仍需完成

1. 至少准备中文课程、英文课程、背景音乐、人声较弱、多人交谈五类真实短样本。
2. 在 NVIDIA 8 GB、仅 CPU 和当前开发机上分别测冷启动、热启动和并发播放。
3. 对比 `base`、`large-v3-turbo-q5_0` 以及 VAD 开关，不以单一机器单一素材决定产品默认值。
4. 将最终 JSON 作为 `media.transcript.v1` Artifact 注册到 Video/Audio Workbench；逐条 Cue 走任务进度事件，最终产物走 Artifact 缓存。
5. 播放、字幕转录、人声分离必须是并发通道，字幕或分离失败不能阻止媒体打开。

## 上游依据

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)：Windows、CUDA、VAD、CLI 和模型格式。
- [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/tree/master/examples/cli)：输出 JSON/SRT/VTT 以及片段回调参数。
- [whisper.cpp models](https://github.com/ggml-org/whisper.cpp/tree/master/models)：模型尺寸与下载方式。
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)：生成器、VAD、word timestamp 与官方基准。
- [SenseVoice](https://github.com/QwenAudio/SenseVoice)：模型能力与官方运行时发布。
- [FunASR llama.cpp runtime](https://github.com/modelscope/FunASR/tree/main/runtime/llama.cpp)：单文件 Windows 运行时、FSMN-VAD 与 GGUF 模型说明。
- [Paraformer-zh GGUF](https://huggingface.co/FunAudioLLM/Paraformer-GGUF)：Q8/F16 模型、运行方式与当前轻量端口边界。
- [Paraformer llama.cpp implementation](https://github.com/modelscope/FunASR/tree/main/runtime/llama.cpp/paraformer)：CIF 架构验证与时间戳 roadmap。
