# 中英字幕本地翻译模型选型记录

更新时间：2026-08-16

## 结论

当前建议保留两个产品档位，而不是强行让一个模型同时承担低门槛与高质量：

- **默认快速档：Mozilla Bergamot。** 双向模型与 WASM 运行时约 120 MiB；纯 CPU 翻译 20 分钟字幕约 7–8.5 秒。译文偶有直译和不自然表达，但整体明显优于 Argos，适合自动预处理。
- **可选高质量档：Hy-MT2-1.8B Q4。** 模型与 Vulkan 运行时约 1.15 GiB；本机 GPU 翻译 20 分钟字幕约 13–17 秒，译文自然度、术语和信息完整度明显更好。它应像 LibreOffice 一样按需安装，不应成为首启必装组件。
- **不建议产品化：Argos OPUS-MT 1.9。** 它最快、内存最低，但实测出现乱码、漏译和明显不自然的中英表达。保留为性能下界即可。

如果首版只能集成一个方案，选择 Bergamot。若允许“快速 / 高质量”两档，则将 Hy-MT2 作为用户主动安装的高质量组件。

## 验证条件

- 机器：Intel Core i7-14700KF，32 GiB RAM，NVIDIA RTX 4090 D。
- 快速档与 Argos 均运行在 CPU；Hy-MT2 分别验证 Vulkan GPU 与 CPU。
- 吞吐输入来自同一批 1、5、20 分钟 Whisper 字幕；20 分钟数字使用实际完整翻译，不是线性外推。
- 质量对照使用 YouTube 人工字幕的前 60 秒，避免把 ASR 错字误判成翻译错误。
- 每条字幕先经过相同的短片段合并规则；时间轴和原 Cue 映射被保留。

## 性能结果

| 引擎 | 设备 | 方向 | 20 分钟整批 | 首批/首 Cue（含冷加载） | 进程峰值工作集 | 本次 Demo 安装体积 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| CTranslate2 + Argos OPUS-MT INT8 | CPU | 英→中 | 约 3.0 秒 | 约 0.20 秒 | 约 123 MiB | 约 285 MiB，且未计 Python 本体 |
| CTranslate2 + Argos OPUS-MT INT8 | CPU | 中→英 | 约 2.4 秒 | 约 0.25 秒 | 约 125 MiB | 同上 |
| Bergamot WASM | CPU | 英→中 | 约 8.5 秒 | 约 0.42 秒 | 约 640 MiB | 约 120 MiB |
| Bergamot WASM | CPU | 中→英 | 约 7.2 秒 | 约 0.58 秒 | 约 836 MiB | 约 120 MiB |
| Hy-MT2-1.8B Q4 + llama.cpp | Vulkan GPU | 英→中 | 约 17.0 秒 | 约 1.53 秒 | 约 3.48 GiB | 约 1.15 GiB |
| Hy-MT2-1.8B Q4 + llama.cpp | Vulkan GPU | 中→英 | 约 13.3 秒 | 约 1.71 秒 | 约 2.88 GiB | 约 1.15 GiB |
| Hy-MT2-1.8B Q4 + llama.cpp | CPU | 英→中 | 约 120.7 秒 | 约 2.35 秒 | 约 4.08 GiB | 约 1.10 GiB |

说明：

- “整批”不含模型冷加载；首条时间包含加载。Hy-MT2 冷加载约 1.4–1.6 秒。
- Hy-MT2 的 Windows Vulkan 进程工作集会包含映射与驱动相关内存；`nvidia-smi` 不报告该 Vulkan 进程，因此当前没有独立、可信的显存峰值数字。
- 两个方向的准备后 Cue 数不同，不能仅凭整批秒数反推单句模型速度。
- Bergamot WASM 内存偏高，但翻译结束后销毁独立进程即可回收，不应常驻播放器进程。

原始结果保存在忽略目录：

- `results/youtube/bergamot-full-3x/report.md`
- `results/youtube/ct2-full-3x/report.md`
- `results/youtube/hymt2-cue-vulkan-gpu-metrics/en-zh/1200s/benchmark.json`
- `results/youtube/hymt2-cue-vulkan/zh-en/1200s/benchmark.json`
- `results/youtube/hymt2-cue-cpu/en-zh/1200s/benchmark.json`

## 质量对照

人工字幕样本中的代表性差异：

| 原文 | Bergamot | Argos OPUS-MT | Hy-MT2 |
| --- | --- | --- | --- |
| `OK.` | `好的。` | 出现乱码 `摆` | `好的。` |
| “万物皆可 AI…被割韭菜…视频耗时半年…” | 信息基本保留，但将“割韭菜”直译为 `being cut` | 漏掉“视频耗时半年、面向零基础”等信息 | 翻为 `being tricked`，并保留视频制作与受众信息 |
| “清华姚班…所有 AI 课程满分、年级第一” | 句法混乱，人物身份关系不清 | 将“姚班”音译为 `Yao Ben`，部分句子生硬 | 正确识别 `Yao Class at Tsinghua University`，信息更完整 |

Hy-MT2 不是完美的，例如“一知半解”仍会出现略生硬的表达；但它的结果已经接近可直接阅读的教学字幕。Bergamot 更像“可理解的机器翻译”，Argos 则存在不可接受的稳定性问题。

## 一个重要的调用结论

不要让 Hy-MT2 一次生成整批 Cue 的结构化结果。验证中使用标记符和 JSON Schema 时，长序列都出现过：

- 合并或漏掉最后几个 Cue；
- 为满足数组长度而返回空字符串；
- 长时间连续批处理后生成损坏 JSON。

稳定方案是：**一个 Cue 一次请求，前一 Cue 与后一 Cue 仅作为背景信息，并发 2–4 路。** 这样既保留字幕时间边界，又能利用局部上下文；每个完成结果可以立即发出 `translation.cue.final`，无需等待整段视频完成。

## ASR 与翻译的边界

当前中文 ASR 样本中存在 `一知半解 → 慢解`、`生成式 AI → 生成是 AI`、`姚班 → 摇班` 等错误。任何翻译模型都会忠实放大这些错误。因此正式流水线应是：

1. ASR 生成带时间轴的原字幕；
2. 合并过短片段，补全标点，并允许后续加入专名纠错；
3. 生成译文轨与双语轨；
4. 以源字幕内容哈希、语言对、模型版本和预处理版本作为缓存键；
5. 播放器只读缓存，不在播放主线程里加载翻译模型。

最终 Artifact 至少保留 `sourceText`、`translatedText`、时间范围与 `sourceCueIds`，从同一份数据即可导出原文 SRT、译文 SRT 和双语 SRT。

## 下一轮需要补的验证

- 增加课程、访谈、影视对白、技术专名与中英混说等至少 5 类素材，做人工盲评。
- 在 8 GiB / 16 GiB 普通电脑及无独显设备上复测 Bergamot；Hy-MT2 CPU 只作为后台慢速质量档。
- 验证 macOS ARM64 上的 llama.cpp Metal 包装与内存。
- 确认字幕编辑后只重算受影响的 Cue，而不是重跑整段视频。

## 上游来源

- [Mozilla Translations](https://github.com/mozilla/translations)：Firefox 客户端翻译模型与训练/发布仓库，MPL-2.0。
- [Bergamot Translator WASM](https://github.com/browsermt/bergamot-translator/tree/main/wasm)：浏览器与 JavaScript 推理运行时。
- [Argos Translate](https://github.com/argosopentech/argos-translate)：离线翻译封装；本次模型包注明原始 OPUS 模型为 CC-BY 4.0。
- [CTranslate2 性能建议](https://opennmt.net/CTranslate2/performance.html)：INT8、批处理与 CPU/GPU 推理建议。
- [Tencent Hy-MT2](https://github.com/Tencent-Hunyuan/Hy-MT2)：Apache-2.0；官方提供 1.8B GGUF，并将视频字幕翻译列为目标场景。
