import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import { createAudioRendererActions } from './renderer-actions';
import {
  AUDIO_PLAYBACK_RATES,
  AUDIO_WORKBENCH_ID,
  audioWorkbenchManifest,
  cloneAudioViewState,
  createAudioSaveViewStateCommand,
  createAudioTimeRangeTarget,
  DEFAULT_AUDIO_VIEW_STATE,
  isAudioSaveViewStateResult,
  isAudioWorkbenchPayload,
  type AudioWorkbenchViewState,
} from './shared';

type AudioLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly duration: number }
  | { readonly kind: 'failed'; readonly message: string };

const SAVE_DELAY_MS = 750;
const AUDIO_HAVE_METADATA = 1;
const AUDIO_METADATA_TIMEOUT_MS = 15_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function audioErrorMessage(
  error: Pick<MediaError, 'code'> | null,
): string {
  switch (error?.code) {
    case 1:
      return '音频载入已取消。';
    case 2:
      return '读取音频文件时连接被中断。';
    case 3:
      return '浏览器无法解码这个音频，可能是不支持的编码格式。';
    case 4:
      return '当前 Chromium 不支持这个音频容器或编码格式。';
    default:
      return '音频资源读取失败。';
  }
}

export function hasLoadedAudioMetadata(
  media: Pick<HTMLMediaElement, 'readyState'>,
): boolean {
  return media.readyState >= AUDIO_HAVE_METADATA;
}

function captureAudioState(
  audio: HTMLAudioElement,
): AudioWorkbenchViewState {
  return {
    currentTime: Number.isFinite(audio.currentTime)
      ? clamp(audio.currentTime, 0, 1_000_000_000)
      : 0,
    volume: clamp(audio.volume, 0, 1),
    muted: audio.muted,
    playbackRate: clamp(audio.playbackRate, 0.25, 4),
  };
}

function AudioDocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="size-12 text-indigo-200/70"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 14v20" />
      <path d="M23 10v28" />
      <path d="M29 17v14" />
      <path d="M35 20v8" />
      <path d="M11 20v8" />
    </svg>
  );
}

export function AudioWorkbenchView({
  asset,
  bootstrap,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onSelectionChange,
  onError,
}: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const payload = isAudioWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const audioRef = useRef<HTMLAudioElement>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const latestViewStateRef = useRef<AudioWorkbenchViewState>(
    payload?.viewState ??
      cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
  );
  const [loadState, setLoadState] = useState<AudioLoadState>({
    kind: 'loading',
  });
  const [currentTime, setCurrentTime] = useState(
    payload?.viewState.currentTime ?? 0,
  );
  const [playbackRate, setPlaybackRateState] = useState(
    payload?.viewState.playbackRate ?? 1,
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
    async (state: AudioWorkbenchViewState) => {
      try {
        const result = await executeCommand(
          createAudioSaveViewStateCommand(state),
        );
        if (!isAudioSaveViewStateResult(result.payload)) {
          throw new Error('Audio Workbench 视图状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法保存音频播放位置。');
      }
    },
    [executeCommand, reportError],
  );

  const captureAndScheduleSave = useCallback(
    (immediate = false) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }
      const state = captureAudioState(audio);
      latestViewStateRef.current = state;
      setCurrentTime(state.currentTime);
      setPlaybackRateState(state.playbackRate);

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
    const audio = audioRef.current;

    if (!payload || !audio) {
      return;
    }

    setLoadState({ kind: 'loading' });
    latestViewStateRef.current = cloneAudioViewState(payload.viewState);
    setPlaybackRateState(payload.viewState.playbackRate);

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
      audio.volume = viewState.volume;
      audio.muted = viewState.muted;
      audio.playbackRate = viewState.playbackRate;

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const nearEnd = viewState.currentTime >= audio.duration - 0.25;
        audio.currentTime = nearEnd
          ? 0
          : Math.min(viewState.currentTime, audio.duration);
      }
      setCurrentTime(audio.currentTime);
      setPlaybackRateState(audio.playbackRate);
      setLoadState({
        kind: 'ready',
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    };
    const onErrorEvent = () => {
      clearMetadataTimeout();
      setLoadState({
        kind: 'failed',
        message: audioErrorMessage(audio.error),
      });
    };
    const onTimeUpdate = () => captureAndScheduleSave(false);
    const onSettingChange = () => captureAndScheduleSave(true);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onErrorEvent);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('seeked', onSettingChange);
    audio.addEventListener('ratechange', onSettingChange);
    audio.addEventListener('volumechange', onSettingChange);

    metadataTimeoutId = window.setTimeout(() => {
      if (audio.error) {
        onErrorEvent();
      } else if (hasLoadedAudioMetadata(audio)) {
        onLoadedMetadata();
      } else {
        setLoadState({
          kind: 'failed',
          message: '读取音频元数据超时，请刷新后重试。',
        });
      }
    }, AUDIO_METADATA_TIMEOUT_MS);

    if (audio.error) {
      onErrorEvent();
    } else if (hasLoadedAudioMetadata(audio)) {
      onLoadedMetadata();
    }

    return () => {
      clearMetadataTimeout();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onErrorEvent);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('seeked', onSettingChange);
      audio.removeEventListener('ratechange', onSettingChange);
      audio.removeEventListener('volumechange', onSettingChange);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const finalState = captureAudioState(audio);
      latestViewStateRef.current = finalState;
      void persistViewState(finalState);
      audio.pause();
    };
  }, [captureAndScheduleSave, payload, persistViewState]);

  const duration =
    loadState.kind === 'ready' ? loadState.duration : undefined;
  const ready = loadState.kind === 'ready';
  const markCurrentTime = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !hasLoadedAudioMetadata(audio)) {
      return;
    }
    const seconds = captureAudioState(audio).currentTime;
    onSelectionChange({
      text: `音频时间 ${formatTime(seconds)}`,
      target: createAudioTimeRangeTarget(seconds),
    });
  }, [onSelectionChange]);
  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (error) {
      reportError(error, '无法切换音频播放状态。');
    }
  }, [reportError]);
  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;

    if (!audio || !AUDIO_PLAYBACK_RATES.includes(
      rate as (typeof AUDIO_PLAYBACK_RATES)[number],
    )) {
      return;
    }

    audio.playbackRate = rate;
    captureAndScheduleSave(true);
  }, [captureAndScheduleSave]);
  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示音频。');
    }
  }, [onReveal, reportError]);
  const rendererActions = useMemo(
    () =>
      createAudioRendererActions({
        ready,
        playbackRate,
        onTogglePlayback: togglePlayback,
        onMarkCurrentTime: markCurrentTime,
        onPlaybackRate: setPlaybackRate,
        onReveal: reveal,
      }),
    [
      markCurrentTime,
      playbackRate,
      ready,
      reveal,
      setPlaybackRate,
      togglePlayback,
    ],
  );
  useWorkbenchContributions(AUDIO_WORKBENCH_ID, rendererActions);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const audio = audioRef.current;
      const seconds = audio
        ? captureAudioState(audio).currentTime
        : currentTime;

      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        { target: createAudioTimeRangeTarget(seconds) },
      );
    },
    [bootstrap.sessionId, currentTime, runtime],
  );
  const handlePlaybackRateChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setPlaybackRate(Number(event.target.value));
    },
    [setPlaybackRate],
  );
  const typeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      'audio/mpeg': 'MP3',
      'audio/wav': 'WAV',
      'audio/mp4': 'M4A',
      'audio/aac': 'AAC',
      'audio/flac': 'FLAC',
      'audio/ogg': 'Ogg / Opus',
      'audio/webm': 'WebM Audio',
    };
    return labels[bootstrap.mediaType] ?? bootstrap.mediaType;
  }, [bootstrap.mediaType]);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Audio Workbench 数据无效
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#11151a]"
      onContextMenuCapture={openContextMenu}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_50%_42%,rgba(129,140,248,0.09),transparent_50%),#11151a] p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-[24px] border border-indigo-200/[0.08] bg-indigo-200/[0.045] shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
            <AudioDocumentIcon />
          </div>
          <h3 className="mt-5 truncate text-sm font-medium text-slate-300">
            {asset.name}
          </h3>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            音频转写、章节和逐句学习内容将在这里显示
          </p>
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.07] bg-[#191e24] px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <audio
            ref={audioRef}
            aria-label="音频播放器"
            className="h-10 min-w-0 flex-1"
            src={payload.contentUrl}
            controls
            preload="metadata"
          />
          <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-500">
            倍速
            <select
              aria-label="音频播放速度"
              value={playbackRate}
              disabled={!ready}
              onChange={handlePlaybackRateChange}
              className="ui-control h-8 rounded-lg border border-white/[0.08] bg-[#242a32] px-2 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {AUDIO_PLAYBACK_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mx-auto mt-1.5 flex max-w-3xl items-center justify-between gap-3">
          <span className="text-[10px] tabular-nums text-slate-600">
            {formatTime(currentTime)}
            {duration !== undefined ? ` / ${formatTime(duration)}` : ''}
            {' · '}
            {typeLabel}
          </span>
          <button
            type="button"
            disabled={!ready}
            onClick={markCurrentTime}
            className="ui-control rounded-lg border border-white/[0.08] px-2.5 py-1 text-[10px] text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            标记当前时间
          </button>
        </div>
      </div>

      {loadState.kind === 'loading' && (
        <div className="pointer-events-none absolute inset-0 bottom-24 grid place-items-center bg-[#11151a]/68">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在读取音频信息…
          </div>
        </div>
      )}

      {loadState.kind === 'failed' && (
        <div className="absolute inset-0 bottom-24 grid place-items-center bg-[#11151a]/94 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">
              无法播放这个音频
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

const audioRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: audioWorkbenchManifest,
  View: AudioWorkbenchView,
};

export default audioRendererWorkbenchModule;
