# 字幕生成技术验证

这是一个与 Learning Companion 主应用解耦的 Windows 本地字幕 Demo。它只回答一件事：哪套离线转录方案能以足够低的首条字幕延迟和总耗时，为视频/音频 Workbench 生成可缓存字幕。

当前首选候选是 `whisper.cpp`：桌面端不需要 Python 环境，CPU 与 NVIDIA CUDA 使用相同的调用和输出协议，运行时可以像 LibreOffice 一样按需安装到外部组件目录。Demo 也实装了共享 `funasr-llama.cpp + FSMN-VAD` 运行时下的 `SenseVoiceSmall Q8` 与 `Paraformer-zh Q8`，用相同素材比较中文质量、耗时与 SRT 结构。`faster-whisper` 保留为性能对照，不作为默认桌面依赖。

## Demo 验证什么

- 任意音视频先由 FFmpeg 规范化成 16 kHz、单声道、16-bit PCM WAV。
- `whisper.cpp` 在识别出完整片段时立即写出 `cue.final` 事件，而不是等整段媒体结束。
- 最终同时生成 `media.transcript.v1` JSON、SRT、WebVTT 和原始 Whisper JSON。
- 报告首条 Cue 延迟、转录耗时、端到端耗时、实时倍率（RTF）和基础 CER/WER。
- 规范化音频按源文件哈希缓存，重复实验不会反复解码视频。

播放本身不依赖这个流程；未来主应用应先打开媒体，再在后台生成并逐步展示字幕。

## 快速验证

在本目录运行：

```powershell
pnpm test
pnpm fixtures
pnpm setup:cuda
pnpm validate:cuda
```

没有 NVIDIA CUDA 环境时使用：

```powershell
pnpm setup:cpu
pnpm validate:cpu
```

`base` 只是快速兼容基线，真实中文长视频质量不足。无 GPU 的质量档使用：

```powershell
pnpm setup:cpu:quality
pnpm validate:cpu:quality
```

脚本会把大文件放在本目录的 `.runtime/`、`.models/` 和 `.cache/`，这些目录不会进入 Git。合成测试语音放在 `.fixtures/`，本地结果放在 `results/local/`。

## 转录真实媒体

```powershell
node ./src/cli.mjs transcribe `
  --input "D:\path\to\lecture.mp4" `
  --backend cuda `
  --model large-v3-turbo-q5_0 `
  --language auto `
  --output ./output/lecture
```

默认启用 Silero VAD。若要建立不使用 VAD 的对照组，增加 `--no-vad`。CPU 实验建议从 `base` 模型开始；CUDA 实验默认使用 `large-v3-turbo-q5_0`。

## FunASR 中文 CPU 对照

安装 SenseVoiceSmall（约 257 MiB）或 Paraformer-zh（约 240 MiB）。两者共享约 14 MiB 的 CPU AVX2 运行时与 FSMN-VAD：

```powershell
pnpm setup:sensevoice
pnpm setup:paraformer
```

转录单个媒体：

```powershell
node ./src/funasr-cli.mjs transcribe `
  --engine sensevoice `
  --input "D:\path\to\lecture.mp4" `
  --output ./output/sensevoice-lecture

node ./src/funasr-cli.mjs transcribe `
  --engine paraformer `
  --input "D:\path\to\lecture.mp4" `
  --output ./output/paraformer-lecture
```

运行同一套中英文 YouTube 基准：

```powershell
node ./src/youtube-benchmark.mjs `
  --engine sensevoice `
  --durations 60,300,1200 `
  --repetitions 3
```

当前轻量运行时只给出 FSMN-VAD 段级时间。Demo 会按标点拆分文本，再在所属 VAD 区间内按字符长度分配 Cue 时间；该时间轴便于播放器验证，但不是词级对齐。运行时也不会逐 Cue 流出结果，所以首 Cue 要等整段转录完成。

Paraformer GGUF 的限制更明显：当前版本不输出标点、段文本边界或 CIF 时间戳。Demo 只能先按语音时长把全文近似分配到 VAD 段，再固定字数切分；生成的 SRT 只用于暴露问题，不属于可交付字幕。

## 输出

每次运行的输出目录包含：

- `transcript.json`：未来 Artifact 的候选协议 `media.transcript.v1`。
- `subtitles.srt` / `subtitles.vtt`：播放器可直接消费的字幕。
- `events.ndjson`：运行期间逐条出现的最终 Cue，可用来验证渐进展示。
- `benchmark.json`：机器、模型、耗时、RTF 和准确率数据。
- `whisper.json` / `whisper.stderr.log`：定位模型或运行时问题的原始证据。

合成语音只用于验证安装、协议和性能是否可重复，不能替代真实课程、口音、噪声、多人对话和背景音乐场景的质量验收。选型结论与真实素材验收门槛见 [技术选型记录](./docs/technology-selection.md)。

## YouTube 真实素材基准

准备两条只保存在本机的中英文教育视频音轨、人工字幕和时长切片：

```powershell
pnpm dataset:youtube
```

运行 CUDA 高质量档：

```powershell
node ./src/youtube-benchmark.mjs --engine whisper --backend cuda --model large-v3-turbo-q5_0 --threads 14 --repetitions 3 --cold-normalization
```

运行 CPU 基线：

```powershell
node ./src/youtube-benchmark.mjs --engine whisper --backend cpu --model base --threads 14 --repetitions 3 --cold-normalization
```

基准默认测试 1、3、5、10、20 分钟，使用人工字幕计算英文 WER 或中文 CER，并采集整机 CPU/RAM 与 NVIDIA GPU/VRAM。媒体、参考字幕和结果都在忽略目录中，不进入仓库。

本轮真实素材结果、SRT 问题与硬件建议见 [YouTube 基准结论](./docs/youtube-benchmark-findings.md)。

快速冒烟时可以限制视频和时长；正式报告仍应使用完整档位：

```powershell
node ./src/youtube-benchmark.mjs `
  --backend cuda `
  --model large-v3-turbo-q5_0 `
  --videos h0e2HAPTGF4 `
  --durations 60 `
  --repetitions 1 `
  --output ./results/youtube/smoke
```
