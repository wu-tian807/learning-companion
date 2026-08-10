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
  createVideoSaveViewStateCommand,
  createVideoTimeRangeTarget,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStateResult,
  isVideoWorkbenchPayload,
  type VideoWorkbenchViewState,
  videoWorkbenchManifest,
} from './shared';

type VideoLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string };

const SAVE_DELAY_MS = 750;
const VIDEO_HAVE_METADATA = 1;
const VIDEO_METADATA_TIMEOUT_MS = 15_000;

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
  onError,
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
        />
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
