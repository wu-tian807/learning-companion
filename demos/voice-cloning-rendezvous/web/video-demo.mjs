import { resolveDubPlayback } from "../src/dub-playback-policy.mjs";

const elements = Object.fromEntries(
  [
    "activeTrackLabel",
    "cancelExperiment",
    "cueCount",
    "cueList",
    "errorMessage",
    "experienceSection",
    "experimentModelGrid",
    "modelSection",
    "pipelineState",
    "referencePreview",
    "referenceText",
    "runtimeState",
    "selectedFile",
    "setupProgressBar",
    "startExperiment",
    "subtitleOverlay",
    "subtitleSection",
    "trackButtons",
    "videoInput",
    "videoPlayer",
  ].map((id) => [id, document.getElementById(id)]),
);

const MODEL_ORDER = ["f5tts", "voxcpm15", "voxcpm2"];
const STATUS_LABELS = Object.freeze({
  queued: "等待 GPU",
  loading: "加载模型",
  probing: "测试最右端 RTF",
  generating: "后缀生成中",
  ready: "全部完成",
  failed: "未完成",
});
const PHASES = Object.freeze({
  uploaded: ["视频已上传", 8],
  starting: ["准备处理", 10],
  transcribing: ["识别字幕与语言", 22],
  "source-ready": ["原文字幕完成", 38],
  "separating-audio": ["分离人声与背景", 46],
  translating: ["生成反向译文", 56],
  "extracting-reference": ["从人声轨截取参考", 66],
  generating: ["三模型依次生成", 72],
  completed: ["实验完成", 100],
  cancelled: ["已取消", 0],
  failed: ["处理失败", 0],
  interrupted: ["任务中断", 0],
});
const RETRYABLE_PHASES = new Set(["failed", "cancelled", "interrupted"]);

let selectedFile;
let session;
let runtimeReady = false;
let targetCues = [];
let loadedTrackSessionId;
let localVideoUrl;
let pollingTimer;
let activeModel = "original";
let activeCueId;
let audioSyncPending = false;
const dubAudio = new Audio();
dubAudio.preload = "auto";
const backgroundAudio = new Audio();
backgroundAudio.preload = "auto";
let activeBackgroundFile;

function formatTime(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  const total = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSeconds(seconds) {
  return Number.isFinite(seconds) ? `${seconds.toFixed(2)} s` : "—";
}

function formatRtf(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function formatBytes(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : "—";
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = !message;
}

function updateStartButton() {
  const canResume = session?.id && RETRYABLE_PHASES.has(session.phase);
  elements.startExperiment.disabled =
    !runtimeReady || (!selectedFile && !canResume);
  elements.startExperiment.textContent =
    !selectedFile && canResume ? "继续任务" : "开始三模型实验";
}

function resetGeneratedView() {
  targetCues = [];
  loadedTrackSessionId = undefined;
  activeModel = "original";
  stopGeneratedAudio();
  activeBackgroundFile = undefined;
  backgroundAudio.removeAttribute("src");
  elements.modelSection.hidden = true;
  elements.subtitleSection.hidden = true;
  elements.experimentModelGrid.replaceChildren();
  elements.cueList.replaceChildren();
  elements.cueCount.textContent = "0 段";
  elements.referencePreview.removeAttribute("src");
  elements.referenceText.textContent = "字幕完成后显示自动选中的参考文本。";
  for (const button of elements.trackButtons.querySelectorAll("[data-model]")) {
    const original = button.dataset.model === "original";
    button.classList.toggle("is-active", original);
    button.disabled = !original;
  }
  elements.activeTrackLabel.textContent = "原声";
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

function uploadVideo(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/sessions");
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.setRequestHeader(
      "content-type",
      file.type || "application/octet-stream",
    );
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 8);
      elements.setupProgressBar.style.width = `${percent}%`;
      elements.pipelineState.textContent = `上传视频 ${Math.round((event.loaded / event.total) * 100)}%`;
    });
    request.addEventListener("load", () => {
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        rejectPromise(new Error(`上传响应无效：HTTP ${request.status}`));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        rejectPromise(new Error(payload.error ?? `HTTP ${request.status}`));
      } else {
        resolvePromise(payload);
      }
    });
    request.addEventListener("error", () =>
      rejectPromise(new Error("视频上传失败")),
    );
    request.send(file);
  });
}

async function loadRuntime() {
  try {
    const health = await responseJson(
      await fetch("/api/health", { cache: "no-store" }),
    );
    runtimeReady = health.ready;
    elements.runtimeState.textContent = health.ready
      ? "本机能力已就绪"
      : "本地组件不完整";
    elements.runtimeState.dataset.state = health.ready ? "ready" : "failed";
    updateStartButton();
    if (!health.ready) {
      const missing = Object.entries(health.checks)
        .filter(([, ready]) => !ready)
        .map(([name]) => name)
        .join("、");
      showError(`缺少本地能力：${missing}`);
    }
  } catch (error) {
    runtimeReady = false;
    elements.runtimeState.textContent = "无法连接 Demo 服务";
    elements.runtimeState.dataset.state = "failed";
    showError(error instanceof Error ? error.message : String(error));
  }
}

function setVideoSource(source) {
  if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
  localVideoUrl =
    source instanceof File ? URL.createObjectURL(source) : undefined;
  elements.videoPlayer.src = localVideoUrl ?? source;
  elements.experienceSection.hidden = false;
}

function phaseProgress(manifest) {
  const [label, base] = PHASES[manifest.phase] ?? [manifest.phase, 0];
  if (
    manifest.phase === "translating" &&
    manifest.subtitleProgress?.total > 0
  ) {
    const ratio =
      manifest.subtitleProgress.completed / manifest.subtitleProgress.total;
    return [
      `${label} ${manifest.subtitleProgress.completed}/${manifest.subtitleProgress.total}`,
      38 + ratio * 22,
    ];
  }
  if (manifest.phase === "generating") {
    const models = Object.values(manifest.models ?? {});
    const completed = models.reduce(
      (sum, model) => sum + (model.completedCues ?? 0),
      0,
    );
    const total = models.reduce(
      (sum, model) => sum + (model.totalCues ?? 0),
      0,
    );
    return [
      total > 0 ? `${label} ${completed}/${total} 段` : label,
      total > 0 ? 62 + (completed / total) * 38 : base,
    ];
  }
  return [label, base];
}

function renderPipeline() {
  const [label, progress] = phaseProgress(session);
  elements.pipelineState.textContent = session.message
    ? `${label} · ${session.message}`
    : label;
  elements.setupProgressBar.style.width = `${progress}%`;
  const active = ![
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "uploaded",
  ].includes(session.phase);
  elements.cancelExperiment.hidden = !active;
  if (session.phase === "failed" || session.phase === "interrupted") {
    showError(session.message ?? "处理失败");
  }
  updateStartButton();
}

function modelCard(model) {
  const card = document.createElement("article");
  card.className = "model-result-card adaptive-model-card";
  card.dataset.model = model.id;
  const durationMs = session.video.durationMs ?? 1;
  const suffixStart = model.continuousSuffixStartMs ?? durationMs;
  const suffixPercent = Math.max(
    0,
    Math.min(100, (suffixStart / durationMs) * 100),
  );
  const predicted = model.prediction?.reachableBeforeEnd
    ? formatTime(model.prediction.switchAtMs)
    : "本次播放前不可达";
  const title = document.createElement("div");
  title.className = "model-result-title";
  title.innerHTML = `
    <div>
      <p class="eyebrow">${model.strategy?.label ?? "等待最右端探针"}</p>
      <h3>${model.label}</h3>
    </div>
    <span class="state-chip" data-state="${model.status === "ready" ? "ready" : ""}">${STATUS_LABELS[model.status] ?? model.status}</span>
  `;
  const timeline = document.createElement("div");
  timeline.className = "adaptive-timeline";
  timeline.innerHTML = `
    <div class="adaptive-generated" style="left:${suffixPercent}%;width:${100 - suffixPercent}%"></div>
    <div class="adaptive-probe-marker" title="最右端真实探针"></div>
  `;
  const metrics = document.createElement("dl");
  metrics.className = "compact-metrics adaptive-metrics";
  metrics.innerHTML = `
    <div><dt>模型加载</dt><dd>${formatSeconds(model.loadSeconds)}</dd></div>
    <div><dt>探针 RTF</dt><dd>${formatRtf(model.probe?.timelineRtf)}</dd></div>
    <div><dt>滚动 RTF</dt><dd>${formatRtf(model.rollingTimelineRtf)}</dd></div>
    <div><dt>预测切换</dt><dd>${predicted}</dd></div>
    <div><dt>真实后缀</dt><dd>${formatTime(durationMs - suffixStart)}</dd></div>
    <div><dt>峰值显存</dt><dd>${formatBytes(model.peakCudaMemoryBytes)}</dd></div>
  `;
  const copy = document.createElement("p");
  copy.className = "strategy-copy";
  copy.textContent =
    model.message ??
    model.strategy?.explanation ??
    "先生成最右端字幕 Cue，完成后才会得到该模型的本机 RTF。";
  const probe = document.createElement("p");
  probe.className = "probe-copy";
  probe.textContent = model.probe
    ? `探针：生成 ${formatSeconds(model.probe.generationSeconds)} / 时间轴 ${formatSeconds((targetCues.find(({ id }) => id === model.probe.cueId)?.endMs - targetCues.find(({ id }) => id === model.probe.cueId)?.startMs) / 1_000)} · 首块 ${formatSeconds(model.probe.firstChunkSeconds)}`
    : "探针尚未完成";
  card.append(title, timeline, metrics, copy, probe);
  return card;
}

function renderModels() {
  if (!session.models || Object.keys(session.models).length === 0) return;
  elements.modelSection.hidden = false;
  elements.experimentModelGrid.replaceChildren(
    ...MODEL_ORDER.flatMap((id) => {
      const model = session.models[id];
      return model ? [modelCard(model)] : [];
    }),
  );
  for (const button of elements.trackButtons.querySelectorAll("[data-model]")) {
    if (button.dataset.model === "original") continue;
    const model = session.models[button.dataset.model];
    button.disabled =
      !model || Object.keys(model.audioFiles ?? {}).length === 0;
  }
}

async function ensureTracks() {
  if (!session.tracks?.targetCuesFile || loadedTrackSessionId === session.id)
    return;
  const payload = await responseJson(
    await fetch(
      `/api/sessions/${session.id}/files/${session.tracks.targetCuesFile}`,
      { cache: "no-store" },
    ),
  );
  targetCues = payload.cues;
  loadedTrackSessionId = session.id;
  elements.subtitleSection.hidden = false;
  const direction =
    payload.directionLabel ?? session.translation?.directionLabel;
  elements.cueCount.textContent = direction
    ? `${direction} · ${targetCues.length} 段`
    : `${targetCues.length} 段`;
  const visible = targetCues.slice(0, 80).map((cue) => {
    const row = document.createElement("article");
    row.className = "cue-row";
    const time = document.createElement("span");
    time.textContent = `${formatTime(cue.startMs)}–${formatTime(cue.endMs)}`;
    const copy = document.createElement("div");
    const source = document.createElement("p");
    source.textContent = cue.sourceText;
    const target = document.createElement("strong");
    target.textContent = cue.text;
    copy.append(source, target);
    row.append(time, copy);
    return row;
  });
  elements.cueList.replaceChildren(...visible);
}

function renderReference() {
  if (!session.reference) return;
  elements.referencePreview.src = `/api/sessions/${session.id}/files/${session.reference.file}`;
  elements.referenceText.textContent = `${formatTime(session.reference.startMs)}–${formatTime(session.reference.endMs)} · ${session.reference.text}`;
}

async function refreshSession() {
  if (!session?.id) return;
  session = await responseJson(
    await fetch(`/api/sessions/${session.id}`, { cache: "no-store" }),
  );
  renderPipeline();
  await ensureTracks();
  renderReference();
  renderModels();
  if (
    ["completed", "failed", "cancelled", "interrupted"].includes(session.phase)
  ) {
    clearTimeout(pollingTimer);
    pollingTimer = undefined;
  } else {
    pollingTimer = setTimeout(
      () => void refreshSession().catch(handleError),
      750,
    );
  }
}

function handleError(error) {
  showError(error instanceof Error ? error.message : String(error));
}

function startPolling() {
  clearTimeout(pollingTimer);
  pollingTimer = setTimeout(
    () => void refreshSession().catch(handleError),
    250,
  );
}

function currentCue(milliseconds) {
  return targetCues.find(
    ({ startMs, endMs }) => milliseconds >= startMs && milliseconds < endMs,
  );
}

function activeModelState() {
  return activeModel === "original"
    ? undefined
    : session?.models?.[activeModel];
}

function stopDubAudio() {
  dubAudio.pause();
  activeCueId = undefined;
}

function stopBackgroundAudio() {
  backgroundAudio.pause();
}

function stopGeneratedAudio() {
  stopDubAudio();
  stopBackgroundAudio();
}

async function syncBackgroundAudio(player, file) {
  const expectedSource = `/api/sessions/${session.id}/files/${file}`;
  if (activeBackgroundFile !== file) {
    activeBackgroundFile = file;
    backgroundAudio.src = expectedSource;
    backgroundAudio.currentTime = player.currentTime;
  } else if (
    Math.abs(backgroundAudio.currentTime - player.currentTime) > 0.18
  ) {
    backgroundAudio.currentTime = player.currentTime;
  }
  backgroundAudio.volume = player.volume;
  backgroundAudio.playbackRate = player.playbackRate;
  if (player.paused) {
    backgroundAudio.pause();
    return true;
  }
  try {
    if (backgroundAudio.paused) await backgroundAudio.play();
    return true;
  } catch {
    return false;
  }
}

async function syncDubAudio() {
  const player = elements.videoPlayer;
  const positionMs = player.currentTime * 1_000;
  const subtitleCue = currentCue(positionMs);
  const model = activeModelState();
  const route = resolveDubPlayback({
    cues: targetCues,
    audioFiles: model?.audioFiles,
    positionMs,
    generatedRegionStartMs: model?.continuousSuffixStartMs,
    backgroundAvailable: Boolean(session?.separation?.backgroundFile),
  });
  elements.subtitleOverlay.hidden = !subtitleCue;
  if (subtitleCue) {
    elements.subtitleOverlay.textContent = `${subtitleCue.text}\n${subtitleCue.sourceText}`;
  }
  if (route.mode === "original") {
    player.muted = false;
    stopGeneratedAudio();
    return;
  }

  const backgroundReady = await syncBackgroundAudio(
    player,
    session.separation.backgroundFile,
  );
  if (!backgroundReady) {
    player.muted = false;
    stopGeneratedAudio();
    return;
  }
  player.muted = true;
  if (route.mode === "background") {
    stopDubAudio();
    return;
  }

  const { cue, file } = route;
  const desired = Math.max(0, player.currentTime - cue.startMs / 1_000);
  const expectedSource = `/api/sessions/${session.id}/files/${file}`;
  if (activeCueId !== cue.id) {
    activeCueId = cue.id;
    dubAudio.src = expectedSource;
    dubAudio.currentTime = desired;
  } else if (Math.abs(dubAudio.currentTime - desired) > 0.18) {
    dubAudio.currentTime = desired;
  }
  dubAudio.volume = player.volume;
  dubAudio.playbackRate = player.playbackRate;
  if (player.paused) {
    dubAudio.pause();
    return;
  }
  try {
    if (dubAudio.paused) await dubAudio.play();
  } catch {
    stopDubAudio();
  }
}

function audioLoop() {
  if (!audioSyncPending) {
    audioSyncPending = true;
    void syncDubAudio().finally(() => {
      audioSyncPending = false;
    });
  }
  requestAnimationFrame(audioLoop);
}

elements.videoInput.addEventListener("change", () => {
  selectedFile = elements.videoInput.files?.[0];
  elements.selectedFile.textContent = selectedFile
    ? `${selectedFile.name} · ${(selectedFile.size / 1024 ** 2).toFixed(1)} MB`
    : "尚未选择视频";
  if (selectedFile) setVideoSource(selectedFile);
  void loadRuntime();
});

elements.startExperiment.addEventListener("click", async () => {
  const canResume = session?.id && RETRYABLE_PHASES.has(session.phase);
  if (!selectedFile && !canResume) return;
  elements.startExperiment.disabled = true;
  showError("");
  try {
    if (selectedFile) {
      session = await uploadVideo(selectedFile);
      resetGeneratedView();
      localStorage.setItem("voice-demo-session-id", session.id);
    }
    await responseJson(
      await fetch(`/api/sessions/${session.id}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    session.phase = "starting";
    renderPipeline();
    startPolling();
  } catch (error) {
    handleError(error);
    updateStartButton();
  }
});

elements.cancelExperiment.addEventListener("click", async () => {
  if (!session?.id) return;
  await responseJson(
    await fetch(`/api/sessions/${session.id}/cancel`, {
      method: "POST",
    }),
  );
  elements.pipelineState.textContent = "正在取消…";
});

elements.trackButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model]");
  if (!button || button.disabled) return;
  activeModel = button.dataset.model;
  stopGeneratedAudio();
  if (activeModel === "original") elements.videoPlayer.muted = false;
  for (const item of elements.trackButtons.querySelectorAll("[data-model]")) {
    item.classList.toggle("is-active", item === button);
  }
  elements.activeTrackLabel.textContent = button.textContent;
});

elements.videoPlayer.addEventListener("pause", stopGeneratedAudio);
elements.videoPlayer.addEventListener("seeking", stopGeneratedAudio);
elements.videoPlayer.addEventListener("ended", stopGeneratedAudio);
elements.videoPlayer.addEventListener("volumechange", () => {
  dubAudio.volume = elements.videoPlayer.volume;
  backgroundAudio.volume = elements.videoPlayer.volume;
});

async function restoreSession() {
  const id =
    new URL(window.location.href).searchParams.get("session") ??
    localStorage.getItem("voice-demo-session-id");
  if (!id) return;
  try {
    session = await responseJson(
      await fetch(`/api/sessions/${id}`, { cache: "no-store" }),
    );
    resetGeneratedView();
    setVideoSource(`/api/sessions/${id}/files/${session.video.file}`);
    elements.selectedFile.textContent = `${session.video.originalName} · 已恢复实验`;
    renderPipeline();
    await ensureTracks();
    renderReference();
    renderModels();
    updateStartButton();
    if (
      !["completed", "failed", "cancelled", "interrupted"].includes(
        session.phase,
      )
    ) {
      startPolling();
    }
  } catch {
    localStorage.removeItem("voice-demo-session-id");
  }
}

await loadRuntime();
await restoreSession();
requestAnimationFrame(audioLoop);
