import {
  advanceSuffixStart,
  hasGeneratedCoverage,
  predictSuffixRendezvous,
} from "/src/rendezvous.mjs";

const elements = Object.fromEntries(
  [
    "audioMode",
    "coverageMetric",
    "currentTime",
    "decisionCopy",
    "durationInput",
    "durationTime",
    "etaMetric",
    "generatedRange",
    "playedRange",
    "playbackRateInput",
    "playButton",
    "playhead",
    "predictionMarker",
    "resetButton",
    "rtfInput",
    "runningState",
    "seekInput",
    "simulationRateInput",
    "speedMetric",
    "stageMessage",
    "startButton",
    "startupInput",
    "suffixMetric",
    "switchMetric",
  ].map((id) => [id, document.getElementById(id)]),
);

const defaults = Object.freeze({
  durationSeconds: 1_200,
  playbackSeconds: 0,
  generatedSuffixStartSeconds: 1_200,
  playbackRate: 1,
  rtf: 0.56,
  startupSeconds: 5,
  startupRemainingSeconds: 5,
  simulationRate: 60,
  playing: false,
  generating: false,
});

let state = { ...defaults };
let previousFrame;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readPositive(input, fallback) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateParameters({ resetProgress = false } = {}) {
  const durationSeconds = readPositive(elements.durationInput, 20) * 60;
  state.durationSeconds = durationSeconds;
  state.rtf = readPositive(elements.rtfInput, defaults.rtf);
  state.playbackRate = readPositive(elements.playbackRateInput, 1);
  state.simulationRate = readPositive(elements.simulationRateInput, 60);
  state.startupSeconds = Math.max(
    0,
    Number.parseFloat(elements.startupInput.value) || 0,
  );

  if (resetProgress) {
    state.playbackSeconds = 0;
    state.generatedSuffixStartSeconds = durationSeconds;
    state.startupRemainingSeconds = state.startupSeconds;
    state.playing = false;
    state.generating = false;
  } else {
    state.playbackSeconds = clamp(state.playbackSeconds, 0, durationSeconds);
    state.generatedSuffixStartSeconds = clamp(
      state.generatedSuffixStartSeconds,
      0,
      durationSeconds,
    );
  }

  elements.seekInput.max = String(durationSeconds);
}

function getPrediction() {
  return predictSuffixRendezvous({
    durationSeconds: state.durationSeconds,
    playbackSeconds: state.playbackSeconds,
    generatedSuffixStartSeconds: state.generatedSuffixStartSeconds,
    playbackRate: state.playbackRate,
    rtf: state.rtf,
    startupSeconds:
      state.generatedSuffixStartSeconds === state.durationSeconds
        ? state.startupRemainingSeconds
        : 0,
  });
}

function render() {
  const prediction = getPrediction();
  const duration = state.durationSeconds;
  const playedPercent = (state.playbackSeconds / duration) * 100;
  const suffixStartPercent =
    (state.generatedSuffixStartSeconds / duration) * 100;
  const predictionPercent = (prediction.switchAtSeconds / duration) * 100;
  const hasCoverage = hasGeneratedCoverage({
    playbackSeconds: state.playbackSeconds,
    generatedSuffixStartSeconds: state.generatedSuffixStartSeconds,
    durationSeconds: duration,
  });

  elements.playedRange.style.width = `${playedPercent}%`;
  elements.playhead.style.left = `${playedPercent}%`;
  elements.generatedRange.style.left = `${suffixStartPercent}%`;
  elements.generatedRange.style.width = `${100 - suffixStartPercent}%`;
  elements.predictionMarker.style.left = `${predictionPercent}%`;
  elements.predictionMarker.hidden = !prediction.reachableBeforeEnd;
  elements.seekInput.value = String(state.playbackSeconds);

  elements.currentTime.textContent = formatTime(state.playbackSeconds);
  elements.durationTime.textContent = formatTime(duration);
  elements.etaMetric.textContent = prediction.reachableBeforeEnd
    ? formatTime(prediction.wallSecondsUntilSwitch)
    : "本次播放前不可达";
  elements.switchMetric.textContent = prediction.reachableBeforeEnd
    ? formatTime(prediction.switchAtSeconds)
    : "—";
  elements.suffixMetric.textContent = formatTime(
    prediction.continuousSuffixSeconds,
  );
  elements.speedMetric.textContent = `${prediction.generationRate.toFixed(2)}× 实时`;
  elements.coverageMetric.textContent = formatTime(
    duration - state.generatedSuffixStartSeconds,
  );

  elements.playButton.textContent = state.playing ? "❚❚" : "▶";
  elements.playButton.setAttribute(
    "aria-label",
    state.playing ? "暂停" : "播放",
  );
  elements.startButton.textContent = state.generating
    ? "生成模拟进行中"
    : "开始模拟";
  elements.startButton.disabled = state.generating;

  if (hasCoverage) {
    elements.audioMode.textContent = "克隆声连续播放";
    elements.audioMode.dataset.mode = "clone";
    elements.runningState.textContent = "已相遇";
    elements.stageMessage.textContent =
      "播放头已经进入真实生成范围，此后可连续使用克隆音轨。";
  } else if (state.generating && state.startupRemainingSeconds > 0) {
    elements.audioMode.textContent = "原声播放";
    elements.audioMode.dataset.mode = "original";
    elements.runningState.textContent = "模型冷启动";
    elements.stageMessage.textContent = `冷启动剩余 ${formatTime(state.startupRemainingSeconds)}，视频不等待。`;
  } else if (state.generating) {
    elements.audioMode.textContent = "原声播放";
    elements.audioMode.dataset.mode = "original";
    elements.runningState.textContent = "后缀生成中";
    elements.stageMessage.textContent =
      "白色条正从结尾向前增长，实际覆盖到播放头才会切换。";
  } else {
    elements.audioMode.textContent = "原声播放";
    elements.audioMode.dataset.mode = "original";
    elements.runningState.textContent = "等待开始";
    elements.stageMessage.textContent =
      "点击“开始模拟”，观察生成后缀如何追上播放头。";
  }
}

function tick(timestamp) {
  if (previousFrame === undefined) previousFrame = timestamp;
  const wallDelta = Math.min((timestamp - previousFrame) / 1_000, 0.2);
  previousFrame = timestamp;
  const simulatedWallDelta = wallDelta * state.simulationRate;

  if (state.generating) {
    const startupConsumed = Math.min(
      state.startupRemainingSeconds,
      simulatedWallDelta,
    );
    state.startupRemainingSeconds -= startupConsumed;
    const productiveWallSeconds = simulatedWallDelta - startupConsumed;
    if (productiveWallSeconds > 0) {
      state.generatedSuffixStartSeconds = advanceSuffixStart({
        durationSeconds: state.durationSeconds,
        generatedSuffixStartSeconds: state.generatedSuffixStartSeconds,
        wallSeconds: productiveWallSeconds,
        rtf: state.rtf,
      });
    }
    if (state.generatedSuffixStartSeconds === 0) state.generating = false;
  }

  if (state.playing) {
    state.playbackSeconds = clamp(
      state.playbackSeconds + simulatedWallDelta * state.playbackRate,
      0,
      state.durationSeconds,
    );
    if (state.playbackSeconds === state.durationSeconds) state.playing = false;
  }

  render();
  requestAnimationFrame(tick);
}

for (const input of [
  elements.durationInput,
  elements.rtfInput,
  elements.startupInput,
  elements.playbackRateInput,
  elements.simulationRateInput,
]) {
  input.addEventListener("change", () => {
    const durationChanged = input === elements.durationInput;
    updateParameters({ resetProgress: durationChanged });
    render();
  });
}

elements.seekInput.addEventListener("input", () => {
  state.playbackSeconds = Number.parseFloat(elements.seekInput.value);
  render();
});

elements.playButton.addEventListener("click", () => {
  if (state.playbackSeconds === state.durationSeconds)
    state.playbackSeconds = 0;
  state.playing = !state.playing;
  render();
});

elements.startButton.addEventListener("click", () => {
  updateParameters();
  state.generating = true;
  state.playing = true;
  render();
});

elements.resetButton.addEventListener("click", () => {
  updateParameters({ resetProgress: true });
  render();
});

updateParameters({ resetProgress: true });
render();
requestAnimationFrame(tick);
