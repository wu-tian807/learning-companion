import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import { createVideoRendererActions } from './renderer-actions';
import {
  cloneVideoViewState,
  createVideoRetrySubtitlesCommand,
  createVideoSaveViewStateCommand,
  createVideoSetSubtitleModeCommand,
  createVideoTimeRangeTarget,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSubtitleCueFinalPayload,
  isVideoSubtitleSnapshot,
  isVideoSaveViewStateResult,
  isVideoWorkbenchPayload,
  type VideoSubtitleDisplayMode,
  type VideoSubtitleSnapshot,
  type VideoWorkbenchViewState,
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

function formatVttTime(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
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
    let text = cue.text;

    if (mode === 'translated') {
      text = translation ?? `〔原文 · 译文生成中〕${cue.text}`;
    } else if (mode === 'bilingual') {
      text = `${cue.text}\n${translation ?? '〔正在翻译…〕'}`;
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

function captureVideoState(
  video: HTMLVideoElement,
): VideoWorkbenchViewState {
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
  bootstrap,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onOpenSettings,
  onError,
  subscribeEvent,
}: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const payload = isVideoWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const latestViewStateRef = useRef<VideoWorkbenchViewState>(
    payload?.viewState ??
      cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
  );
  const [loadState, setLoadState] = useState<VideoLoadState>({
    kind: 'loading',
  });
  const [currentTime, setCurrentTime] = useState(
    payload?.viewState.currentTime ?? 0,
  );
  const [subtitleMode, setSubtitleMode] = useState<VideoSubtitleDisplayMode>(
    payload?.subtitleState.displayMode ?? 'off',
  );
  const [subtitleSnapshot, setSubtitleSnapshot] =
    useState<VideoSubtitleSnapshot>(
      payload?.subtitleSnapshot ?? {
        phase: 'idle',
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      },
    );
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState<string>();

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
    setSubtitleMode(payload.subtitleState.displayMode);
    setSubtitleSnapshot(payload.subtitleSnapshot);
  }, [payload]);

  useEffect(() => {
    if (!subscribeEvent) {
      throw new Error('Video Workbench 缺少异步事件通道');
    }
    return subscribeEvent((event) => {
      if (
        event.type === videoEventTypes.subtitleSnapshot &&
        isVideoSubtitleSnapshot(event.payload)
      ) {
        setSubtitleSnapshot(event.payload);
        return;
      }
      if (
        event.type === videoEventTypes.subtitleCueFinal &&
        isVideoSubtitleCueFinalPayload(event.payload)
      ) {
        const payload = event.payload;
        setSubtitleSnapshot((current) => {
          const translations = new Map(
            current.partialTranslations.map((cue) => [cue.sourceCueId, cue]),
          );
          translations.set(payload.cue.sourceCueId, payload.cue);
          const ordered = current.source?.cues.flatMap((cue) => {
            const translation = translations.get(cue.id);
            return translation ? [translation] : [];
          }) ?? [...translations.values()];
          return {
            ...current,
            phase: 'translating',
            partialTranslations: ordered,
            completedCues: payload.completedCues,
            totalCues: payload.totalCues,
          };
        });
      }
    });
  }, [subscribeEvent]);

  const subtitleVtt = useMemo(
    () => createVideoSubtitleVtt(subtitleSnapshot, subtitleMode),
    [subtitleMode, subtitleSnapshot],
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
      const state = captureVideoState(video);
      latestViewStateRef.current = state;
      setCurrentTime(state.currentTime);

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
      video.playbackRate = viewState.playbackRate;

      if (Number.isFinite(video.duration) && video.duration > 0) {
        const nearEnd = viewState.currentTime >= video.duration - 0.25;
        video.currentTime = nearEnd
          ? 0
          : Math.min(viewState.currentTime, video.duration);
      }
      setCurrentTime(video.currentTime);
      setLoadState({ kind: 'ready' });
    };
    const onErrorEvent = () => {
      clearMetadataTimeout();
      setLoadState({
        kind: 'failed',
        message: mediaErrorMessage(video.error),
      });
    };
    const onTimeUpdate = () => captureAndScheduleSave(false);
    const onSettingChange = () => captureAndScheduleSave(true);

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onErrorEvent);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSettingChange);
    video.addEventListener('ratechange', onSettingChange);
    video.addEventListener('volumechange', onSettingChange);

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
      video.removeEventListener('seeked', onSettingChange);
      video.removeEventListener('ratechange', onSettingChange);
      video.removeEventListener('volumechange', onSettingChange);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const finalState = captureVideoState(video);
      latestViewStateRef.current = finalState;
      void persistViewState(finalState);
      video.pause();
      // `src` belongs to React. Removing it here breaks StrictMode's
      // setup-cleanup-setup replay because the DOM node itself is retained.
    };
  }, [captureAndScheduleSave, payload, persistViewState]);

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
  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示视频。');
    }
  }, [onReveal, reportError]);
  const rendererActions = useMemo(
    () =>
      createVideoRendererActions({
        ready,
        onTogglePlayback: togglePlayback,
        onReveal: reveal,
      }),
    [ready, reveal, togglePlayback],
  );
  useWorkbenchContributions(videoWorkbenchManifest.id, rendererActions);

  const selectSubtitleMode = useCallback(
    async (mode: VideoSubtitleDisplayMode) => {
      setSubtitleMode(mode);
      try {
        const result = await executeCommand(
          createVideoSetSubtitleModeCommand(mode),
        );
        if (!isVideoSaveViewStateResult(result.payload)) {
          throw new Error('Video Workbench 字幕状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法切换字幕模式。');
      }
    },
    [executeCommand, reportError],
  );
  const retrySubtitles = useCallback(async () => {
    try {
      await executeCommand(createVideoRetrySubtitlesCommand());
    } catch (error) {
      reportError(error, '无法重新处理字幕。');
    }
  }, [executeCommand, reportError]);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const video = videoRef.current;
      const seconds = video
        ? captureVideoState(video).currentTime
        : currentTime;

      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        {
          focus: createVideoTimeRangeTarget(seconds),
          inputs: [],
        },
      );
    },
    [bootstrap.sessionId, currentTime, runtime],
  );
  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Video Workbench 数据无效
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0d1116]"
      onContextMenuCapture={openContextMenu}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_50%_45%,rgba(68,78,101,0.16),transparent_58%),#0d1116] p-3">
        <video
          ref={videoRef}
          aria-label="视频播放器"
          className="max-h-full max-w-full rounded-md bg-black shadow-[0_20px_60px_rgba(0,0,0,0.42)]"
          src={payload.contentUrl}
          controls
          playsInline
          preload="metadata"
        >
          {subtitleTrackUrl && (
            <track
              key={subtitleTrackUrl}
              kind="subtitles"
              src={subtitleTrackUrl}
              srcLang={subtitleSnapshot.source?.language ?? 'und'}
              label="Learning Companion 字幕"
              default
            />
          )}
        </video>
      </div>

      <div className="absolute bottom-14 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[#151a21]/90 p-1.5 shadow-xl backdrop-blur-md">
        {(['off', 'source', 'translated', 'bilingual'] as const).map((mode) => {
          const label = {
            off: '关闭',
            source: '原文',
            translated: '译文',
            bilingual: '双语',
          }[mode];
          const disabled =
            mode !== 'off' &&
            (!subtitleSnapshot.source ||
              ((mode === 'translated' || mode === 'bilingual') &&
                subtitleSnapshot.source.language === 'unknown'));
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => void selectSubtitleMode(mode)}
              className={`ui-control rounded-lg px-2.5 py-1.5 text-[11px] ${
                subtitleMode === mode
                  ? 'bg-indigo-400/20 text-indigo-100'
                  : 'text-slate-400'
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {label}
            </button>
          );
        })}
        <span className="ml-1 border-l border-white/10 pl-2 text-[10px] text-slate-500">
          {subtitleSnapshot.phase === 'transcribing' ||
          subtitleSnapshot.phase === 'queued'
            ? '正在准备字幕…'
            : subtitleSnapshot.phase === 'translating'
              ? `翻译 ${subtitleSnapshot.completedCues}/${subtitleSnapshot.totalCues}`
              : subtitleSnapshot.phase === 'ready'
                ? '翻译完成'
                : subtitleSnapshot.phase === 'source-ready'
                  ? '原文可用'
                  : subtitleSnapshot.phase === 'unsupported-language'
                    ? '仅支持中英互译'
                    : subtitleSnapshot.phase === 'runtime-required'
                      ? '需要字幕组件'
                      : subtitleSnapshot.phase === 'failed'
                        ? '字幕处理失败'
                        : '字幕未准备'}
        </span>
        {subtitleSnapshot.phase === 'runtime-required' && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="ui-control rounded-lg px-2 py-1 text-[10px] text-indigo-200"
          >
            设置
          </button>
        )}
        {subtitleSnapshot.phase === 'failed' && (
          <button
            type="button"
            onClick={() => void retrySubtitles()}
            className="ui-control rounded-lg px-2 py-1 text-[10px] text-rose-200"
          >
            重试
          </button>
        )}
      </div>

      {loadState.kind === 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0d1116]/68">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在读取视频信息…
          </div>
        </div>
      )}

      {loadState.kind === 'failed' && (
        <div className="absolute inset-0 grid place-items-center bg-[#0d1116]/92 p-8 text-center">
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
  );
}

const videoRendererWorkbenchModule: RendererWorkbenchModule<
  typeof videoWorkbenchManifest.id
> = {
  manifest: videoWorkbenchManifest,
  View: VideoWorkbenchView,
};

export default videoRendererWorkbenchModule;
