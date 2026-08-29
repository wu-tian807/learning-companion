import {
  advanceChunkSchedule,
  advanceSuffixStart,
  hasGeneratedCoverage,
  predictSuffixRendezvous,
} from "/src/rendezvous.mjs";

const elements = Object.fromEntries(
  [
    "loadState",
    "modelGrid",
    "referenceAudio",
    "revealButton",
    "simulationButton",
    "simulationDuration",
    "simulationRows",
    "simulationSpeed",
    "startupMode",
  ].map((id) => [id, document.getElementById(id)]),
);

let aggregate;
let animationFrame;
let simulationState = [];

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(value < 0.001 ? 3 : 1)}%`;
}

function caseById(report, id) {
  return report.cases.find((item) => item.id === id);
}

function audioRow(label, src, hint) {
  const row = document.createElement("div");
  row.className = "audio-row";
  row.innerHTML = `<div><strong>${label}</strong><small>${hint}</small></div>`;
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = src;
  row.append(audio);
  return row;
}

function longCheckpoints(modelId, longCase) {
  const details = document.createElement("details");
  details.className = "long-checkpoints";
  details.innerHTML = "<summary>抽听同一句四轮复现 + 最末段</summary>";
  const roundLength = Math.floor(longCase.segments.length / 4);
  const indexes = [
    0,
    roundLength,
    roundLength * 2,
    roundLength * 3,
    longCase.segments.length - 1,
  ];
  const labels = ["第 1 轮", "第 2 轮", "第 3 轮", "第 4 轮", "最末段"];
  indexes.forEach((index, checkpointIndex) => {
    const segment = longCase.segments[index];
    details.append(
      audioRow(
        `${labels[checkpointIndex]} · 第 ${segment.index} 段`,
        `/results/local/${modelId}/${segment.file}`,
        segment.text,
      ),
    );
  });
  return details;
}

function renderModels() {
  elements.modelGrid.replaceChildren();
  aggregate.models.forEach((report, candidateIndex) => {
    const {
      id,
      label,
      reference_mode: referenceMode,
      license_note: license,
    } = report.model;
    const zh = caseById(report, "zh-one-shot");
    const en = caseById(report, "en-one-shot");
    const long = caseById(report, "long-run-bilingual");
    const card = document.createElement("article");
    card.className = "model-result-card";
    card.innerHTML = `
      <div class="model-result-title">
        <div>
          <p class="eyebrow model-sensitive">${referenceMode}</p>
          <h3 data-candidate-label="候选 ${String.fromCharCode(65 + candidateIndex)}" data-model-label="${label}">候选 ${String.fromCharCode(65 + candidateIndex)}</h3>
        </div>
        <span class="rtf-badge model-sensitive">RTF ${report.schedulerEstimate.rtf.toFixed(3)}</span>
      </div>
      <dl class="compact-metrics model-sensitive">
        <div><dt>加载</dt><dd>${formatSeconds(report.modelLoadSeconds)}</dd></div>
        <div><dt>首块</dt><dd>${formatSeconds(report.schedulerEstimate.medianFirstChunkSeconds)}</dd></div>
        <div><dt>P90 RTF</dt><dd>${report.schedulerEstimate.p90Rtf.toFixed(3)}</dd></div>
        <div><dt>峰值显存</dt><dd>${formatBytes(report.peakCudaMemoryBytes)}</dd></div>
        <div><dt>模型文件</dt><dd>${formatBytes(report.modelAssetBytes)}</dd></div>
        <div><dt>长程静音</dt><dd>${formatRatio(long?.waveform.nearSilenceRatio)}</dd></div>
        <div><dt>长程削波</dt><dd>${formatRatio(long?.waveform.clippingRatio)}</dd></div>
      </dl>
      <p class="license-note model-sensitive">${license}</p>
    `;
    card.append(
      audioRow(
        "中文 one-shot",
        `/results/local/${id}/${zh.joinedFile}`,
        `${formatSeconds(zh.joinedSeconds)} 音频`,
      ),
      audioRow(
        "English one-shot",
        `/results/local/${id}/${en.joinedFile}`,
        `${formatSeconds(en.joinedSeconds)} audio`,
      ),
    );
    if (long) {
      card.append(
        audioRow(
          "长程中英交替",
          `/results/local/${id}/${long.joinedFile}`,
          `${long.segmentCount} 段 · ${formatSeconds(long.joinedSeconds)}`,
        ),
        longCheckpoints(id, long),
      );
    }
    elements.modelGrid.append(card);
  });
}

function createSimulationRows() {
  elements.simulationRows.replaceChildren();
  aggregate.models.forEach((report, candidateIndex) => {
    const row = document.createElement("article");
    row.className = "model-simulation-row";
    row.dataset.model = report.model.id;
    const timelineEstimate =
      report.timelineSimulation ?? report.schedulerEstimate;
    row.innerHTML = `
      <div class="simulation-label">
        <strong data-candidate-label="候选 ${String.fromCharCode(65 + candidateIndex)}" data-model-label="${report.model.label}">候选 ${String.fromCharCode(65 + candidateIndex)}</strong>
        <span class="model-sensitive">时间轴 RTF ${timelineEstimate.rtf.toFixed(3)}</span>
      </div>
      <div class="compare-timeline">
        <div class="compare-generated"></div>
        <div class="compare-played"></div>
        <div class="compare-playhead"></div>
      </div>
      <div class="simulation-status">等待模拟</div>
    `;
    elements.simulationRows.append(row);
  });
}

elements.revealButton.addEventListener("click", () => {
  const revealed = document.body.classList.toggle("results-revealed");
  for (const label of document.querySelectorAll("[data-model-label]")) {
    label.textContent = revealed
      ? label.dataset.modelLabel
      : label.dataset.candidateLabel;
  }
  elements.revealButton.textContent = revealed ? "返回盲听" : "揭晓模型";
});

function resetSimulation() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  const duration = Math.max(
    60,
    Number(elements.simulationDuration.value) * 60 || 1200,
  );
  const cold = elements.startupMode.value === "cold";
  simulationState = aggregate.models.map((report) => {
    const longCase = caseById(report, "long-run-bilingual");
    const measuredSchedule =
      report.timelineSimulation?.schedule ?? longCase?.segments ?? [];
    const schedule = [...measuredSchedule].reverse().map((segment) => ({
      generationSeconds: segment.generationSeconds,
      outputSeconds: segment.mediaCoverageSeconds ?? segment.outputSeconds,
    }));
    return {
      report,
      duration,
      playback: 0,
      suffixStart: duration,
      startupRemaining: cold ? report.modelLoadSeconds : 0,
      switched: false,
      schedule,
      scheduleIndex: 0,
      segmentWallRemaining: schedule[0]?.generationSeconds ?? 0,
    };
  });
  renderSimulation();
}

function renderSimulation() {
  for (const state of simulationState) {
    const row = elements.simulationRows.querySelector(
      `[data-model="${state.report.model.id}"]`,
    );
    if (!row) continue;
    const generated = row.querySelector(".compare-generated");
    const played = row.querySelector(".compare-played");
    const playhead = row.querySelector(".compare-playhead");
    const status = row.querySelector(".simulation-status");
    const playedPercent = (state.playback / state.duration) * 100;
    const suffixPercent = (state.suffixStart / state.duration) * 100;
    generated.style.left = `${suffixPercent}%`;
    generated.style.width = `${100 - suffixPercent}%`;
    played.style.width = `${playedPercent}%`;
    playhead.style.left = `${playedPercent}%`;

    const prediction = predictSuffixRendezvous({
      durationSeconds: state.duration,
      playbackSeconds: state.playback,
      generatedSuffixStartSeconds: state.suffixStart,
      playbackRate: 1,
      rtf: (state.report.timelineSimulation ?? state.report.schedulerEstimate)
        .rtf,
      startupSeconds: state.startupRemaining,
    });
    if (state.switched) {
      status.textContent = `已切换 · 连续后缀 ${formatSeconds(state.duration - state.playback)}`;
      status.dataset.state = "ready";
    } else if (state.startupRemaining > 0) {
      status.textContent = `冷启动剩余 ${formatSeconds(state.startupRemaining)}`;
      status.dataset.state = "loading";
    } else {
      status.textContent = prediction.reachableBeforeEnd
        ? `RTF 预测 ${formatSeconds(prediction.wallSecondsUntilSwitch)} 后相遇`
        : "本次播放前不可达";
      status.dataset.state = "generating";
    }
  }
}

function tick(timestamp) {
  const previous = tick.previous ?? timestamp;
  const wallDelta = Math.min((timestamp - previous) / 1000, 0.2);
  tick.previous = timestamp;
  const speed = Math.max(1, Number(elements.simulationSpeed.value) || 120);
  const simulated = wallDelta * speed;
  let active = false;

  for (const state of simulationState) {
    if (state.playback >= state.duration) continue;
    active = true;
    state.playback = Math.min(state.duration, state.playback + simulated);
    const startup = Math.min(state.startupRemaining, simulated);
    state.startupRemaining -= startup;
    const productive = simulated - startup;
    if (state.schedule.length > 0 && productive > 0) {
      const advanced = advanceChunkSchedule({
        generatedSuffixStartSeconds: state.suffixStart,
        wallSeconds: productive,
        schedule: state.schedule,
        scheduleIndex: state.scheduleIndex,
        segmentWallRemaining: state.segmentWallRemaining,
      });
      state.suffixStart = advanced.generatedSuffixStartSeconds;
      state.scheduleIndex = advanced.scheduleIndex;
      state.segmentWallRemaining = advanced.segmentWallRemaining;
    }
    if (state.schedule.length === 0 && productive > 0) {
      state.suffixStart = advanceSuffixStart({
        durationSeconds: state.duration,
        generatedSuffixStartSeconds: state.suffixStart,
        wallSeconds: productive,
        rtf: state.report.schedulerEstimate.rtf,
      });
    }
    state.switched ||= hasGeneratedCoverage({
      playbackSeconds: state.playback,
      generatedSuffixStartSeconds: state.suffixStart,
      durationSeconds: state.duration,
    });
  }

  renderSimulation();
  if (active) animationFrame = requestAnimationFrame(tick);
  else elements.simulationButton.disabled = false;
}

elements.simulationButton.addEventListener("click", () => {
  resetSimulation();
  tick.previous = undefined;
  elements.simulationButton.disabled = true;
  animationFrame = requestAnimationFrame(tick);
});

for (const input of [elements.simulationDuration, elements.startupMode]) {
  input.addEventListener("change", resetSimulation);
}

try {
  const response = await fetch("/results/local/aggregate.json", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  aggregate = await response.json();
  elements.referenceAudio.src = `/results/local/${aggregate.referenceFile}`;
  renderModels();
  createSimulationRows();
  resetSimulation();
  elements.loadState.textContent = `${aggregate.models.length} 个模型已完成`;
  elements.loadState.dataset.state = "ready";
} catch (error) {
  elements.loadState.textContent = "尚无本机结果";
  elements.modelGrid.innerHTML = `
    <article class="empty-result">
      <strong>赛马仍在运行或尚未开始</strong>
      <p>完成 <code>pnpm benchmark:overnight</code> 后刷新此页。详情：${String(error)}</p>
    </article>
  `;
  elements.simulationButton.disabled = true;
}
