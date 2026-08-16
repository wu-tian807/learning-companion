# 中英字幕翻译技术验证

这是与 Learning Companion 主应用解耦的本地翻译 Demo。它验证中英字幕在完成 ASR 与字幕切分后，能否使用小体积模型逐 Cue 翻译，并同时产出原文、译文和双语字幕。

当前快速档候选是 Firefox 使用的 `Bergamot WASM`。Demo 使用 Mozilla 当前正式发布的英译简中与中译英模型，模型和运行时仅保存在本目录的忽略目录中。

对照候选是 Argos 1.9 提供的 OPUS-MT 中英模型，以 CTranslate2 INT8 运行。它用于判断 Bergamot 的低安装复杂度是否值得较高的 WASM 内存开销。

高质量档候选是腾讯 `Hy-MT2-1.8B Q4_K_M`，通过 `llama.cpp` 运行。它逐 Cue 翻译，并仅将前后 Cue 作为上下文，既保留原字幕边界，又能逐 Cue 返回结果。当前结论与完整取舍见 [模型选型记录](./docs/model-selection.md)。

## 安装与冒烟

```powershell
pnpm install --ignore-workspace
pnpm setup:bergamot
pnpm smoke:bergamot
```

CTranslate2 对照需要一个仅供 Demo 使用的 Python 3.12 路径：

```powershell
$env:LC_PYTHON = 'D:\path\to\python.exe'
pnpm setup:ct2
pnpm benchmark:ct2 -- --durations 60 --repetitions 1
```

Hy-MT2 高质量档在 Windows 上可以选择 Vulkan（NVIDIA、AMD、Intel）或纯 CPU：

```powershell
pnpm setup:hymt2 -- -Backend vulkan
pnpm benchmark:hymt2 -- --input .\source.srt --output .\results\hymt2 --from en --to zh --backend vulkan --concurrency 2
```

## 运行现有 YouTube 字幕基准

它默认复用 `demos/subtitle-generation` 中 Whisper CUDA 生成的 1、5、20 分钟中英文字幕：

```powershell
pnpm benchmark:youtube
```

快速验证：

```powershell
node ./src/youtube-benchmark.mjs --durations 60 --repetitions 1
```

每个结果目录包含：

- `input.srt`：未经处理的输入字幕。
- `source.srt`：合并过短语义片段后的翻译源字幕。
- `translated.srt`：保持同一时间轴的译文字幕。
- `bilingual.srt`：原文与译文双行字幕。
- `translation.json`：候选的结构化翻译 Artifact。
- `events.ndjson`：逐条翻译完成的相对时间，可验证 Cue 级流式展示。
- `benchmark.json`：冷启动、暖单条延迟、整批耗时、吞吐与内存。

`.downloads/`、`.models/`、`.runtime/`、`node_modules/` 与 `results/` 不进入 Git。
