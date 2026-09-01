import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  useWorkbenchConversationContribution,
  useWorkbenchConversationSnapshot,
} from '../../renderer/conversation/workbench-conversation-context';
import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { registerWorkbenchAnchorController } from '../../renderer/workbench/host/workbench-anchor-bridge';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { userMessageFromError } from '../../shared/ipc-error';
import { createVideoRendererActions } from './renderer-actions';
import {
  createVideoConversationContribution,
  createVideoFrameConversationLaunch,
} from './conversation/video-conversation-contribution';
import {
  createVideoConversationContext,
  shouldReleaseVideoConversationContext,
  type VideoConversationContext,
} from './conversation/video-conversation-context';
import { VideoExplanationIndex } from './explanations/video-explanation-index';
import { VideoExplanationMarkerOverlay } from './explanations/video-explanation-marker-overlay';
import { VideoExplanationPanel } from './explanations/video-explanation-panel';
import type { VideoExplanationView } from './explanations/shared';
import { videoExplanationVisibleAtTime } from './explanations/video-explanation-revision';
import { useVideoExplanations } from './explanations/use-video-explanations';
import {
  MediaDubbingAudioTrack,
  useMediaDubbingPlayback,
} from '../media-dubbing/use-media-dubbing-playback';
import { useMediaSubtitles } from '../media-subtitles/use-media-subtitles';
import { VideoPlaybackControls } from './video-playback-controls';
import { VideoLanguageControls } from './video-language-controls';
import { VideoFrameQuestionMenu } from './video-frame-question-menu';
import {
  cloneVideoViewState,
  createVideoGetDubbingSnapshotCommand,
  createVideoGetSubtitleSnapshotCommand,
  createVideoRetryDubbingCommand,
  createVideoRetrySubtitlesCommand,
  createVideoSaveViewStateCommand,
  createVideoSetSubtitleModeCommand,
  createVideoStartDubbingCommand,
  createVideoFrameRegionTarget,
  DEFAULT_VIDEO_VIEW_STATE,
  EMPTY_VIDEO_DUBBING_SNAPSHOT,
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  isVideoDubbingSnapshot,
  isVideoSubtitleCueFinalPayload,
  isVideoSubtitleSnapshot,
  isVideoSaveViewStateResult,
  isVideoFrameRegionTarget,
  isVideoWorkbenchPayload,
  type VideoSubtitleDisplayMode,
  type VideoSubtitleSnapshot,
  type VideoWorkbenchViewState,
  type VideoFrameRegionTarget,
  videoEventTypes,
  videoWorkbenchManifest,
} from './shared';

type VideoLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string };

const SAVE_DELAY_MS = 750;
const VIDEO_HAVE_METADATA = 1;
const VIDEO_METADATA_TIMEOUT_MS = 15_000;
const MIN_FRAME_SELECTION_SIZE = 8;

const VIDEO_DUBBING_PLAYBACK_PROTOCOL = Object.freeze({
  snapshotEventType: videoEventTypes.dubbingSnapshot,
  createGetSnapshotCommand: createVideoGetDubbingSnapshotCommand,
  createStartCommand: createVideoStartDubbingCommand,
  createRetryCommand: createVideoRetryDubbingCommand,
  isSnapshot: isVideoDubbingSnapshot,
});

const VIDEO_SUBTITLE_PROTOCOL = Object.freeze({
  snapshotEventType: videoEventTypes.subtitleSnapshot,
  cueFinalEventType: videoEventTypes.subtitleCueFinal,
  createGetSnapshotCommand: createVideoGetSubtitleSnapshotCommand,
  createSetModeCommand: createVideoSetSubtitleModeCommand,
  createRetryCommand: createVideoRetrySubtitlesCommand,
  isSetModeResult: isVideoSaveViewStateResult,
  isSnapshot: isVideoSubtitleSnapshot,
  isCueFinalPayload: isVideoSubtitleCueFinalPayload,
});

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface ScreenRectangle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface FrameSelectionGesture {
  readonly start: ScreenPoint;
  readonly replacesSelection: boolean;
}

function screenRectangle(
  start: ScreenPoint,
  end: ScreenPoint,
): ScreenRectangle {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function createVideoFrameRegionFromClientPoints(
  video: Pick<
    HTMLVideoElement,
    'videoWidth' | 'videoHeight' | 'currentTime' | 'getBoundingClientRect'
  >,
  start: ScreenPoint,
  end: ScreenPoint,
): VideoFrameRegionTarget | undefined {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return undefined;
  const bounds = video.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const clampClient = (point: ScreenPoint) => ({
    x: clamp(point.x, bounds.left, bounds.right),
    y: clamp(point.y, bounds.top, bounds.bottom),
  });
  const boundedStart = clampClient(start);
  const boundedEnd = clampClient(end);
  const rectangle = screenRectangle(boundedStart, boundedEnd);
  const useWholeFrame =
    rectangle.width < MIN_FRAME_SELECTION_SIZE ||
    rectangle.height < MIN_FRAME_SELECTION_SIZE;

  return createVideoFrameRegionTarget({
    timeSeconds: Math.max(0, video.currentTime),
    x: useWholeFrame ? 0 : (rectangle.left - bounds.left) / bounds.width,
    y: useWholeFrame ? 0 : (rectangle.top - bounds.top) / bounds.height,
    width: useWholeFrame ? 1 : rectangle.width / bounds.width,
    height: useWholeFrame ? 1 : rectangle.height / bounds.height,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
  });
}

function formatVttTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function subtitleSpeakerPrefix(speakerId: string | undefined): string {
  const match = speakerId ? /^speaker-(\d{4})$/u.exec(speakerId) : null;
  return match ? `【说话人 ${Number(match[1])}】` : '';
}

export function createVideoSubtitleVtt(
  snapshot: VideoSubtitleSnapshot,
  mode: VideoSubtitleDisplayMode,
): string | undefined {
  if (mode === 'off' || !snapshot.source) return undefined;
  const translations = new Map(
    (snapshot.translation?.cues ?? snapshot.partialTranslations).map((cue) => [
      cue.sourceCueId,
      cue.text,
    ]),
  );
  const blocks = snapshot.source.cues.map((cue) => {
    const translation = translations.get(cue.id);
    const speakerPrefix = subtitleSpeakerPrefix(cue.speakerId);
    let text = `${speakerPrefix}${cue.text}`;

    if (mode === 'translated') {
      text = `${speakerPrefix}${
        translation ?? `〔原文 · 译文生成中〕${cue.text}`
      }`;
    } else if (mode === 'bilingual') {
      text = `${speakerPrefix}${cue.text}\n${translation ?? '〔正在翻译…〕'}`;
    }
    return `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}\n${text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mediaErrorMessage(
  error: Pick<MediaError, 'code'> | null,
): string {
  switch (error?.code) {
    case 1:
      return '视频载入已取消。';
    case 2:
      return '读取视频文件时连接被中断。';
    case 3:
      return '浏览器无法解码这个视频，可能是不支持的编码格式。';
    case 4:
      return '当前 Chromium 不支持这个视频容器或编码格式。';
    default:
      return '视频资源读取失败。';
  }
}

export function hasLoadedVideoMetadata(
  media: Pick<HTMLMediaElement, 'readyState'>,
): boolean {
  return media.readyState >= VIDEO_HAVE_METADATA;
}

function captureVideoState(video: HTMLVideoElement): VideoWorkbenchViewState {
  return {
    currentTime: Number.isFinite(video.currentTime)
      ? clamp(video.currentTime, 0, 1_000_000_000)
      : 0,
    volume: clamp(video.volume, 0, 1),
    muted: video.muted,
    playbackRate: clamp(video.playbackRate, 0.25, 4),
  };
}

export function VideoWorkbenchView({
  asset,
  bootstrap,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onOpenSettings,
  onError,
  subscribeEvent,
}: RendererWorkbenchViewProps) {
  const payload = isVideoWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const suppressVideoVolumeEventRef = useRef(false);
  const desiredAudioStateRef = useRef({
    volume: payload?.viewState.volume ?? 1,
    muted: payload?.viewState.muted ?? false,
  });
  const frameSelectionGestureRef = useRef<
    FrameSelectionGesture | undefined
  >(undefined);
  const selectedConversationContextRef = useRef<
    VideoConversationContext | undefined
  >(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const latestViewStateRef = useRef<VideoWorkbenchViewState>(
    payload?.viewState ?? cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
  );
  const [loadState, setLoadState] = useState<VideoLoadState>({
    kind: 'loading',
  });
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState<string>();
  const [draftSelection, setDraftSelection] = useState<ScreenRectangle>();
  const [frameQuestionMenuOpen, setFrameQuestionMenuOpen] = useState(false);
  const [selectedConversationContext, setSelectedConversationContext] =
    useState<VideoConversationContext>();
  const [currentTime, setCurrentTime] = useState(
    payload?.viewState.currentTime ?? 0,
  );
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(payload?.viewState.volume ?? 1);
  const [muted, setMuted] = useState(payload?.viewState.muted ?? false);
  const [playbackRate, setPlaybackRate] = useState(
    payload?.viewState.playbackRate ?? 1,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = userMessageFromError(error, fallback);

      if (message) {
        console.error(message, error);
        onError(message);
      }
    },
    [onError],
  );
  const subtitles = useMediaSubtitles({
    resetKey: bootstrap.sessionId,
    initialMode: payload?.subtitleState.displayMode ?? 'off',
    initialSnapshot: payload?.subtitleSnapshot ?? EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
    executeCommand,
    subscribeEvent,
    reportError,
    protocol: VIDEO_SUBTITLE_PROTOCOL,
    mediaLabel: '视频',
  });
  const dubbing = useMediaDubbingPlayback({
    resetKey: `${bootstrap.sessionId}:${payload?.sourceRevision ?? 'invalid'}`,
    initialSnapshot: payload?.dubbingSnapshot ?? EMPTY_VIDEO_DUBBING_SNAPSHOT,
    currentTime,
    duration,
    desiredAudioState: { volume, muted, playbackRate },
    mediaRef: videoRef,
    suppressMediaVolumeEventRef: suppressVideoVolumeEventRef,
    executeCommand,
    subscribeEvent,
    reportError,
    protocol: VIDEO_DUBBING_PLAYBACK_PROTOCOL,
    mediaLabel: '视频',
  });
  const isDubbingPlaybackActive = dubbing.isPlaybackActive;

  useEffect(() => {
    const syncFullscreenState = () => {
      setFullscreen(document.fullscreenElement === playerRef.current);
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  const sourceRevision = payload?.sourceRevision ?? '';
  const conversationOwnerId = `${videoWorkbenchManifest.id}:${bootstrap.sessionId}:${sourceRevision}.conversation`;
  const commitConversationContext = useCallback(
    (context: VideoConversationContext) => {
      selectedConversationContextRef.current = context;
      setSelectedConversationContext(context);
    },
    [],
  );
  const releaseConversationContext = useCallback(
    (released: VideoConversationContext | undefined) => {
      const current = selectedConversationContextRef.current;
      if (!shouldReleaseVideoConversationContext(current, released)) {
        return;
      }
      selectedConversationContextRef.current = undefined;
      frameSelectionGestureRef.current = undefined;
      setFrameQuestionMenuOpen(false);
      setSelectedConversationContext(undefined);
      setDraftSelection(undefined);
    },
    [],
  );
  const revealExplanationTarget = useCallback(
    (explanation: VideoExplanationView) => {
      const video = videoRef.current;
      if (!video || !hasLoadedVideoMetadata(video)) {
        reportError(new Error('视频尚未就绪'), '暂时无法定位这条视频标注。');
        return false;
      }
      video.pause();
      const targetTime = Math.min(
        explanation.target.anchorPayload.timeSeconds,
        Number.isFinite(video.duration)
          ? Math.max(0, video.duration)
          : explanation.target.anchorPayload.timeSeconds,
      );
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      releaseConversationContext(undefined);
      return true;
    },
    [releaseConversationContext, reportError],
  );
  useEffect(() => {
    if (loadState.kind !== 'ready') return;
    return registerWorkbenchAnchorController(
      `${conversationOwnerId}.anchors`,
      asset.id,
      {
        sourceRevision,
        reveal(target) {
          if (!isVideoFrameRegionTarget(target)) return false;
          const video = videoRef.current;
          if (!video || !hasLoadedVideoMetadata(video)) {
            throw new Error('视频尚未就绪');
          }
          video.pause();
          const targetTime = Math.min(
            target.anchorPayload.timeSeconds,
            Number.isFinite(video.duration)
              ? Math.max(0, video.duration)
              : target.anchorPayload.timeSeconds,
          );
          video.currentTime = targetTime;
          setCurrentTime(targetTime);
          commitConversationContext(
            createVideoConversationContext(target, sourceRevision),
          );
          return true;
        },
      },
    );
  }, [
    asset.id,
    commitConversationContext,
    conversationOwnerId,
    loadState.kind,
    sourceRevision,
  ]);
  const conversationContribution = useMemo(
    () =>
      createVideoConversationContribution({
        sourceRevision,
        onContextReleased: releaseConversationContext,
      }),
    [
      releaseConversationContext,
      sourceRevision,
    ],
  );
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    asset.id,
    conversationContribution,
    loadState.kind === 'ready',
  );
  const conversationSnapshot =
    useWorkbenchConversationSnapshot(conversationRuntime);
  const conversationBusy = conversationSnapshot.busy;

  const {
    items: explanations,
    ordered: orderedExplanations,
    active: activeExplanation,
    indexOpen: explanationIndexOpen,
    markersVisible: explanationMarkersVisible,
    markers: visibleExplanationMarkers,
    runtimeByTaskId: explanationRuntimeByTaskId,
    retry: retryExplanation,
    remove: deleteExplanation,
    reveal: revealExplanation,
    toggleIndex: toggleExplanationIndex,
    toggleMarkers: toggleExplanationMarkers,
    closeIndex: closeExplanationIndex,
    closeActive: closeActiveExplanation,
  } = useVideoExplanations({
    enabled: payload !== undefined,
    projectId: asset.projectId,
    assetId: asset.id,
    sourceRevision,
    currentTime,
    reportError,
    revealTarget: revealExplanationTarget,
  });

  useEffect(() => {
    if (!frameQuestionMenuOpen || !selectedConversationContext) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-video-frame-surface="true"]')
      ) {
        return;
      }
      releaseConversationContext(selectedConversationContext);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        releaseConversationContext(selectedConversationContext);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [
    frameQuestionMenuOpen,
    releaseConversationContext,
    selectedConversationContext,
  ]);

  const persistViewState = useCallback(
    async (state: VideoWorkbenchViewState) => {
      try {
        const result = await executeCommand(
          createVideoSaveViewStateCommand(state),
        );
        if (!isVideoSaveViewStateResult(result.payload)) {
          throw new Error('Video Workbench 视图状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法保存视频播放位置。');
      }
    },
    [executeCommand, reportError],
  );

  useEffect(() => {
    if (!payload) return;
    desiredAudioStateRef.current = {
      volume: payload.viewState.volume,
      muted: payload.viewState.muted,
    };
  }, [payload]);

  const subtitleVtt = useMemo(
    () => createVideoSubtitleVtt(subtitles.snapshot, subtitles.mode),
    [subtitles.mode, subtitles.snapshot],
  );
  useEffect(() => {
    if (!subtitleVtt) {
      setSubtitleTrackUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([subtitleVtt], { type: 'text/vtt' }),
    );
    setSubtitleTrackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitleVtt]);

  const captureAndScheduleSave = useCallback(
    (immediate = false) => {
      const video = videoRef.current;

      if (!video) {
        return;
      }
      const state = {
        ...captureVideoState(video),
        ...desiredAudioStateRef.current,
      };
      latestViewStateRef.current = state;

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      if (immediate) {
        void persistViewState(state);
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = undefined;
          void persistViewState(latestViewStateRef.current);
        }, SAVE_DELAY_MS);
      }
    },
    [persistViewState],
  );

  useEffect(() => {
    const video = videoRef.current;

    if (!payload || !video) {
      return;
    }

    setLoadState({ kind: 'loading' });
    latestViewStateRef.current = cloneVideoViewState(payload.viewState);

    let metadataTimeoutId: number | undefined;
    const clearMetadataTimeout = () => {
      if (metadataTimeoutId !== undefined) {
        window.clearTimeout(metadataTimeoutId);
        metadataTimeoutId = undefined;
      }
    };
    const onLoadedMetadata = () => {
      clearMetadataTimeout();
      const { viewState } = payload;
      video.volume = viewState.volume;
      video.muted = viewState.muted;
      desiredAudioStateRef.current = {
        volume: viewState.volume,
        muted: viewState.muted,
      };
      video.playbackRate = viewState.playbackRate;

      if (Number.isFinite(video.duration) && video.duration > 0) {
        const nearEnd = viewState.currentTime >= video.duration - 0.25;
        video.currentTime = nearEnd
          ? 0
          : Math.min(viewState.currentTime, video.duration);
      }
      setCurrentTime(video.currentTime);
      setDuration(
        Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0,
      );
      setPlaying(!video.paused && !video.ended);
      setVolume(video.volume);
      setMuted(video.muted);
      setPlaybackRate(video.playbackRate);
      setLoadState({ kind: 'ready' });
    };
    const onErrorEvent = () => {
      clearMetadataTimeout();
      setLoadState({
        kind: 'failed',
        message: mediaErrorMessage(video.error),
      });
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      captureAndScheduleSave(false);
    };
    const onDurationChange = () => {
      setDuration(
        Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0,
      );
    };
    const onPlay = () => {
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
    };
    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      captureAndScheduleSave(true);
    };
    const onMediaSettingChange = (event: Event) => {
      if (
        event.type === 'volumechange' &&
        (suppressVideoVolumeEventRef.current || isDubbingPlaybackActive())
      ) {
        return;
      }
      if (event.type === 'volumechange') {
        desiredAudioStateRef.current = {
          volume: video.volume,
          muted: video.muted,
        };
        setVolume(video.volume);
        setMuted(video.muted);
      }
      setPlaybackRate(video.playbackRate);
      captureAndScheduleSave(true);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onErrorEvent);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ratechange', onMediaSettingChange);
    video.addEventListener('volumechange', onMediaSettingChange);

    metadataTimeoutId = window.setTimeout(() => {
      if (video.error) {
        onErrorEvent();
      } else if (hasLoadedVideoMetadata(video)) {
        onLoadedMetadata();
      } else {
        setLoadState({
          kind: 'failed',
          message: '读取视频元数据超时，请刷新后重试。',
        });
      }
    }, VIDEO_METADATA_TIMEOUT_MS);

    // Media events can fire while React is committing the element, before this
    // passive effect subscribes. Reconcile the native state after subscribing.
    if (video.error) {
      onErrorEvent();
    } else if (hasLoadedVideoMetadata(video)) {
      onLoadedMetadata();
    }

    return () => {
      clearMetadataTimeout();
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onErrorEvent);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ratechange', onMediaSettingChange);
      video.removeEventListener('volumechange', onMediaSettingChange);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const finalState = {
        ...captureVideoState(video),
        ...desiredAudioStateRef.current,
      };
      latestViewStateRef.current = finalState;
      void persistViewState(finalState);
      video.pause();
      // `src` belongs to React. Removing it here breaks StrictMode's
      // setup-cleanup-setup replay because the DOM node itself is retained.
    };
  }, [
    captureAndScheduleSave,
    isDubbingPlaybackActive,
    payload,
    persistViewState,
  ]);

  const ready = loadState.kind === 'ready';
  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch (error) {
      reportError(error, '无法切换视频播放状态。');
    }
  }, [reportError]);
  const seekVideo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    video.currentTime = clamp(seconds, 0, video.duration);
    setCurrentTime(video.currentTime);
  }, []);
  const toggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !desiredAudioStateRef.current.muted;
    desiredAudioStateRef.current = {
      ...desiredAudioStateRef.current,
      muted: next,
    };
    setMuted(next);
    if (isDubbingPlaybackActive()) {
      captureAndScheduleSave(true);
    } else {
      video.muted = next;
    }
  }, [captureAndScheduleSave, isDubbingPlaybackActive]);
  const changeVolume = useCallback(
    (nextVolume: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = clamp(nextVolume, 0, 1);
      const nextMuted = next > 0 ? false : desiredAudioStateRef.current.muted;
      desiredAudioStateRef.current = { volume: next, muted: nextMuted };
      setVolume(next);
      setMuted(nextMuted);
      if (isDubbingPlaybackActive()) {
        captureAndScheduleSave(true);
      } else {
        video.volume = next;
        if (next > 0 && video.muted) video.muted = false;
      }
    },
    [captureAndScheduleSave, isDubbingPlaybackActive],
  );
  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
  }, []);
  const toggleFullscreen = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (document.fullscreenElement === player) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
      }
    } catch (error) {
      reportError(error, '无法切换视频全屏状态。');
    }
  }, [reportError]);
  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示视频。');
    }
  }, [onReveal, reportError]);
  const submitSelectedFrameQuestion = useCallback((question: string) => {
    const context = selectedConversationContextRef.current;
    if (!context || conversationBusy) return;
    setFrameQuestionMenuOpen(false);
    conversationRuntime.open({
      ownerId: conversationOwnerId,
      context,
      question,
      submit: true,
    });
  }, [conversationBusy, conversationOwnerId, conversationRuntime]);
  const openSelectedFrameQuestion = useCallback(() => {
    const context = selectedConversationContextRef.current;
    if (!context || conversationBusy) return;
    setFrameQuestionMenuOpen(false);
    conversationRuntime.open({
      ownerId: conversationOwnerId,
      ...createVideoFrameConversationLaunch(context),
    });
  }, [conversationBusy, conversationOwnerId, conversationRuntime]);
  const rendererActions = useMemo(
    () =>
      createVideoRendererActions({
        ready,
        explanationCount: explanations.length,
        indexOpen: explanationIndexOpen,
        markersVisible: explanationMarkersVisible,
        onToggleIndex: toggleExplanationIndex,
        onToggleMarkers: toggleExplanationMarkers,
        onReveal: reveal,
      }),
    [
      explanationIndexOpen,
      explanationMarkersVisible,
      explanations.length,
      ready,
      reveal,
      toggleExplanationIndex,
      toggleExplanationMarkers,
    ],
  );
  useWorkbenchContributions(videoWorkbenchManifest.id, rendererActions);

  const openFrameQuestionMenu = useCallback(
    (target: VideoFrameRegionTarget) => {
      const context = createVideoConversationContext(target, sourceRevision);
      commitConversationContext(context);
      setFrameQuestionMenuOpen(true);
    },
    [commitConversationContext, sourceRevision],
  );
  const beginFrameSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary || !ready) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, input, select, textarea, a, [role="button"], [data-video-frame-question-menu="true"]',
        )
      ) {
        return;
      }
      const video = videoRef.current;
      if (!video || !hasLoadedVideoMetadata(video)) return;
      const replacesSelection =
        selectedConversationContextRef.current !== undefined;
      event.preventDefault();
      event.stopPropagation();
      releaseConversationContext(undefined);
      video.pause();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      frameSelectionGestureRef.current = {
        start: point,
        replacesSelection,
      };
      const bounds = video.getBoundingClientRect();
      setDraftSelection({
        left: clamp(point.x, bounds.left, bounds.right) - bounds.left,
        top: clamp(point.y, bounds.top, bounds.bottom) - bounds.top,
        width: 0,
        height: 0,
      });
    },
    [ready, releaseConversationContext],
  );
  const updateFrameSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = frameSelectionGestureRef.current?.start;
      const video = videoRef.current;
      if (!start || !video) return;
      event.preventDefault();
      const bounds = video.getBoundingClientRect();
      const boundedStart = {
        x: clamp(start.x, bounds.left, bounds.right),
        y: clamp(start.y, bounds.top, bounds.bottom),
      };
      const boundedEnd = {
        x: clamp(event.clientX, bounds.left, bounds.right),
        y: clamp(event.clientY, bounds.top, bounds.bottom),
      };
      const rectangle = screenRectangle(boundedStart, boundedEnd);
      setDraftSelection({
        left: rectangle.left - bounds.left,
        top: rectangle.top - bounds.top,
        width: rectangle.width,
        height: rectangle.height,
      });
    },
    [],
  );
  const finishFrameSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = frameSelectionGestureRef.current;
      const start = gesture?.start;
      const video = videoRef.current;
      if (!gesture || !start || !video) return;
      event.preventDefault();
      event.stopPropagation();
      frameSelectionGestureRef.current = undefined;
      setDraftSelection(undefined);
      const target = createVideoFrameRegionFromClientPoints(video, start, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!target) return;
      const rectangle = screenRectangle(start, {
        x: event.clientX,
        y: event.clientY,
      });
      if (
        rectangle.width < MIN_FRAME_SELECTION_SIZE ||
        rectangle.height < MIN_FRAME_SELECTION_SIZE
      ) {
        if (!gesture.replacesSelection) {
          openFrameQuestionMenu(target);
        }
        return;
      }
      openFrameQuestionMenu(target);
    },
    [openFrameQuestionMenu],
  );
  const cancelFrameSelection = useCallback(() => {
    frameSelectionGestureRef.current = undefined;
    setDraftSelection(undefined);
  }, []);
  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">Video Workbench 数据无效</p>
      </div>
    );
  }

  return (
    <div
      ref={playerRef}
      tabIndex={0}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0d1116]"
    >
      {explanationIndexOpen && (
        <VideoExplanationIndex
          explanations={orderedExplanations}
          activeExplanationId={activeExplanation?.id}
          onActivate={revealExplanation}
          onDelete={(explanation) => void deleteExplanation(explanation)}
          onClose={closeExplanationIndex}
        />
      )}

      <div
        data-video-stage="true"
        className="relative flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_50%_45%,rgba(68,78,101,0.16),transparent_58%),#0d1116] p-3"
      >
        <div
          data-video-frame-surface="true"
          className="relative inline-flex max-h-full max-w-full overflow-hidden rounded-md bg-black shadow-[0_20px_60px_rgba(0,0,0,0.42)]"
          onContextMenuCapture={(event) => event.preventDefault()}
          onPointerDownCapture={beginFrameSelection}
          onPointerMoveCapture={updateFrameSelection}
          onPointerUpCapture={finishFrameSelection}
          onPointerCancelCapture={cancelFrameSelection}
        >
          <video
            ref={videoRef}
            aria-label="视频播放器"
            className="block max-h-full max-w-full bg-black"
            src={payload.contentUrl}
            playsInline
            preload="metadata"
          >
            {subtitleTrackUrl && (
              <track
                key={subtitleTrackUrl}
                kind="subtitles"
                src={subtitleTrackUrl}
                srcLang={subtitles.snapshot.source?.language ?? 'und'}
                label="Learning Companion 字幕"
                default
              />
            )}
          </video>
          <MediaDubbingAudioTrack controller={dubbing} mediaLabel="视频" />
          <VideoExplanationMarkerOverlay
            visible={explanationMarkersVisible}
            markers={visibleExplanationMarkers}
            selectedTarget={
              activeExplanation &&
              videoExplanationVisibleAtTime(activeExplanation, currentTime)
                ? activeExplanation.target
                : undefined
            }
            onActivate={revealExplanation}
          />
          {selectedConversationContext && (
            <div
              aria-label="已选择的视频画面区域"
              className="pointer-events-none absolute border-2 border-indigo-300 bg-indigo-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
              style={{
                left: `${selectedConversationContext.target.anchorPayload.x * 100}%`,
                top: `${selectedConversationContext.target.anchorPayload.y * 100}%`,
                width: `${selectedConversationContext.target.anchorPayload.width * 100}%`,
                height: `${selectedConversationContext.target.anchorPayload.height * 100}%`,
              }}
            />
          )}
          {draftSelection && (
            <div
              aria-label="正在框选视频画面区域"
              className="pointer-events-none absolute border-2 border-indigo-200 bg-indigo-300/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]"
              style={{
                left: draftSelection.left,
                top: draftSelection.top,
                width: draftSelection.width,
                height: draftSelection.height,
              }}
            />
          )}
          {frameQuestionMenuOpen && selectedConversationContext && (
            <div
              className="pointer-events-none absolute right-2 left-2 z-50 flex justify-center"
              style={{
                top: `${selectedConversationContext.target.anchorPayload.y * 100}%`,
                transform:
                  selectedConversationContext.target.anchorPayload.y >= 0.12
                    ? 'translateY(calc(-100% - 8px))'
                    : 'translateY(8px)',
              }}
            >
              <VideoFrameQuestionMenu
                disabled={conversationBusy}
                onQuestion={submitSelectedFrameQuestion}
                onFreeQuestion={openSelectedFrameQuestion}
                onClose={() =>
                  releaseConversationContext(selectedConversationContext)
                }
              />
            </div>
          )}
        </div>

        {loadState.kind === 'loading' && (
          <div
            data-video-stage-overlay="loading"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0d1116]/68"
          >
            <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
              <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
              正在读取视频信息…
            </div>
          </div>
        )}

        {loadState.kind === 'failed' && (
          <div
            data-video-stage-overlay="failed"
            className="absolute inset-0 grid place-items-center bg-[#0d1116]/92 p-8 text-center"
          >
            <div>
              <p className="text-sm font-medium text-slate-200">
                无法播放这个视频
              </p>
              <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                {loadState.message}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
                >
                  刷新
                </button>
                <button
                  type="button"
                  onClick={onRelink}
                  className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
                >
                  重新定位
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        data-video-control-dock="true"
        className="shrink-0 border-t border-white/[0.08] bg-[#151a21] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]"
      >
        <VideoPlaybackControls
          ready={ready}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          muted={muted}
          playbackRate={playbackRate}
          fullscreen={fullscreen}
          generatedSuffixStartSeconds={dubbing.generatedSuffixStartSeconds}
          trailingControls={
            <VideoLanguageControls
              subtitleMode={subtitles.mode}
              subtitleSnapshot={subtitles.snapshot}
              dubbingSnapshot={dubbing.snapshot}
              dubbingEnabled={dubbing.enabled}
              dubbingPlaybackActive={dubbing.playbackActive}
              onSelectSubtitleMode={(mode) => void subtitles.selectMode(mode)}
              onRetrySubtitles={() => void subtitles.retry()}
              onStartDubbing={() => void dubbing.start()}
              onSelectDubbingEnabled={dubbing.selectEnabled}
              onRetryDubbing={() => void dubbing.retry()}
              onOpenSettings={onOpenSettings}
            />
          }
          onTogglePlayback={() => void togglePlayback()}
          onSeek={seekVideo}
          onToggleMuted={toggleMuted}
          onVolumeChange={changeVolume}
          onPlaybackRateChange={changePlaybackRate}
          onToggleFullscreen={() => void toggleFullscreen()}
        />
      </div>

      {activeExplanation && (
        <VideoExplanationPanel
          explanation={activeExplanation}
          runtime={
            activeExplanation.kind === 'task'
              ? explanationRuntimeByTaskId[activeExplanation.id]
              : undefined
          }
          onClose={closeActiveExplanation}
          onRetry={() => void retryExplanation(activeExplanation)}
          onDelete={() => void deleteExplanation(activeExplanation)}
          onContinueQuestion={
            activeExplanation.status === 'completed'
              ? () => {
                  closeActiveExplanation();
                  conversationRuntime.open({
                    ownerId: conversationOwnerId,
                    ...createVideoFrameConversationLaunch(
                      createVideoConversationContext(
                        activeExplanation.target,
                        activeExplanation.sourceRevision,
                      ),
                      activeExplanation.conversationId,
                    ),
                    fallbackToNewConversation: true,
                  });
                }
              : undefined
          }
          continueQuestionDisabled={conversationBusy}
        />
      )}
    </div>
  );
}

const videoRendererWorkbenchModule: RendererWorkbenchModule<
  typeof videoWorkbenchManifest.id
> = {
  manifest: videoWorkbenchManifest,
  View: VideoWorkbenchView,
};

export default videoRendererWorkbenchModule;
