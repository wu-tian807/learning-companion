# 视频/音频本地配音：最终选型与首版接入

> 更新日期：2026-08-30
> 当前范围：Windows x64 + NVIDIA GPU；Video/Audio 的可靠整轨生成、持久断点和
> 已完成后缀的即时预览；非重叠语音下的多说话人声色路由；Audio 中逐句显示
> 说话人参考并跟随当前播放位置。

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
  ├─ vocals.wav：离线说话人分段
  │      └─ 每个 speaker 选择一个稳定 one-shot 参考
  └─ background.wav：最终保留的背景轨
          ↓
VoxCPM2：按 phrase.speakerId 切换参考、从媒体结尾向前生成
          ↓
FFmpeg：逐段适配真实 Cue 时长并混合背景轨
          ↓
AssetArtifact
  ├─ 缓存完整配音音轨
  └─ 缓存与原文 Cue 一一对应的轻量 speaker track
          ↓
Audio：逐句显示 speaker / 参考窗口，并跟随当前播放位置
```

- **正式模型：VoxCPM2 官方 Python/CUDA 实现。** 当前盲听中，它的中英文 one-shot 清晰度、音色保持和跨语种表现最好。
- **备选模型：F5-TTS、VoxCPM1.5。** Demo 保留适配器和测试资料，但主程序不下载、不注册、不出现模型选择，避免第一版同时维护三套运行时。
- **人声分离：sherpa-onnx CUDA + UVR HQ4。** 该组合已在真实视频上验证，输出顺序明确为 background、vocals。
- **说话人区分：sherpa-onnx CPU + pyannote segmentation int8 + CAMPPlus 中英 embedding。** 只分析分离后的 16 kHz 单声道人声；假设同一时刻最多一人说话，不做重叠语音分离。
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

## 4. 说话人路由、配音计划与时间轴

- 说话人分析只在新建断点时运行一次；恢复任务直接读取带 SHA-256 身份校验的 `speaker-plan.json`，不重复做人声分离或聚类；
- sherpa-onnx 输出的原始 speaker 标签按首次出现顺序归一化成稳定的 `speaker-0001`、`speaker-0002`；聚类阈值取 0.7，优先避免把不同人合并，接受把同一人过度拆分成多个 profile 的较低风险；
- 每个字幕 Cue 按时间重叠最多的 speaker 归属。若 Cue 内第二个 speaker 同时达到 250 ms 和 Cue 时长 10%，仍按主 speaker 配音，但标记为不确定并禁止用作声色参考；没有有效重叠时归为 `speaker-unknown`；
- 每个 speaker 从分离后的纯人声中自动选择一个稳定 one-shot 参考，不让用户额外确认；参考窗口为连续 3–10 秒，跨 Cue 间隔不得超过 700 ms，并要求至少 2.5 秒目标 speaker 语音、至少 50% 覆盖率、其他 speaker 不超过 200 ms；
- 某个 speaker 找不到合格参考时显式使用 VoxCPM2 默认声线，绝不借用另一个 speaker 的参考；
- 相邻短译文可以合并，但只能沿真实 Cue 边界，speaker 必须相同、间隔不超过 700 ms、总时长不超过 8 秒；
- 每个 Phrase 持久保存 `speakerId`；Worker 按 `referencePaths[phrase.speakerId]` 路由。同一 VoxCPM2 模型进程完成所有 speaker 的生成，不因声色切换重载模型，也不增加 phrase 推理次数；
- 面向 Workbench 的 `speaker-track.voxcpm2` 是独立 JSON Artifact：只保留原文 Cue ID、归属状态和参考时间窗，不包含译文、工作区绝对路径或参考 WAV 路径；其 revision 绑定原文字幕 Artifact，并再次校验 Cue 数量和顺序；
- `speaker-plan.json` 仍是可恢复的内部 checkpoint。完整配音成功后，先提交 speaker track Artifact，再删除 checkpoint；若进程恰好在两步之间退出，恢复时会从 checkpoint 补交 Artifact；
- Audio 每条字幕显示稳定的 speaker 徽标，以及“参考 0:00–0:06”或“默认声线”。Cue 内可能发生说话人切换时显示不确定标记，但不会把该 Cue 当作参考；
- Audio 默认跟随播放头：Cue 内高亮当前句，间隙定位下一句，媒体结束后定位末句但不误高亮。用户滚轮、触摸、拖动滚动条或键盘浏览后暂停自动跟随，通过“定位当前句”或点击字幕恢复；
- 说话人轨道只在已经启动或恢复配音分析后出现。单纯打开 Audio 不会为了标签触发模型安装、下载或重型分析；未安装配音组件时整条流程不运行；
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
- 固定 revision 的 pyannote segmentation int8 与 CAMPPlus 中英 speaker embedding 模型；
- 固定版本的 `uv` 引导程序；
- 模型下载约 5.07 GB，其中说话人模型新增约 29.8 MB；所有资源都有固定大小和 SHA-256；
- 只有安装状态检查确认组件可用后，兼容的 Audio/Video Workbench 才会在后台预热；未安装、平台不支持或已经恢复完整配音 Artifact 时不准备 Python、不启动 Worker；
- 首次成功预热或生成时，在同一个 External Library 根目录准备隔离 Python 3.12、PyTorch CUDA、VoxCPM 与 sherpa-onnx 环境；缓存也全部留在该根目录；
- Windows 首次安装从阿里云 PyTorch cu128 镜像获取固定的 `torch 2.8.0+cu128` 与 `torchaudio 2.8.0+cu128`，减少国内网络访问官方 PyTorch wheel 源的等待；其他依赖来源不在本次调整范围；
- 固定资源下载与 Python/CUDA 环境准备共用一条单调进度：前者使用真实下载字节，后者按 `.staging` 环境、`.downloads/.setup` 缓存和受控临时目录的已写入文件大小估算；安装中的估算值封顶但不倒退，完成后再切换为可用状态；
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
├─ dubbing-phrase-planner.ts # speaker-aware Cue 合并、数字朗读
├─ dubbing-speaker-planner.ts # Cue 归属、稳定参考和持久路由计划
├─ dubbing-speaker-track.ts  # 可跨进程展示的轻量 Cue/profile 契约
├─ dubbing-speaker-track-artifact.ts # speaker track 的持久缓存边界
├─ voxcpm2-worker-sources.ts # UVR、diarization 与 VoxCPM2 受控 Worker
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

说话人分析另使用 sherpa-onnx 官方 56.9 秒四人中文样本验证：当前固定模型和阈值输出 4 个 speaker，本机集成测试总耗时约 3 秒。该分析在 CPU 上执行，不占用 VoxCPM2 的 GPU 模型驻留，并且断点恢复不会重复运行。

2026-08-29 又使用本机已安装的正式 VoxCPM2、UVR、FFmpeg 与 20.8 秒 MP4 重跑新链路：说话人分析、profile 路由、三段 CUDA 生成和最终 AAC 探测全部通过，集成测试总耗时约 33 秒。该结果同样只作为回归证据。

Demo 的 `.runtime` 与 `.models` 曾用于模型赛马，验证完成后已删除；保留源码、测试与评价标准，仓库内不保存大模型或 Python 环境。

## 8. 暂不实现

- 用户拖动后动态重排生成队列；
- 重叠说话的人声分离；
- Cue 内切换点的词级文字拆分；
- Video 中的可见 speaker 标签，以及不启动配音即可单独运行的“分析说话人”入口；
- 用户手工合并、拆分或指定 voice profile；
- 失败 Phrase 的逐段原人声回填；
- CPU、macOS、AMD/Intel GPU；
- F5-TTS / VoxCPM1.5 的产品 UI 选择。

这些能力都有明确扩展点，但不进入首版主链，避免实时调度与多运行时把当前可靠实现复杂化。
