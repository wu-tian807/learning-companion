import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { MediaPlaybackControls } from '../../renderer/components/MediaPlaybackControls';
import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  MediaDubbingAudioTrack,
  useMediaDubbingPlayback,
} from '../media-dubbing/use-media-dubbing-playback';
import { MediaLanguageControls } from '../media-subtitles/media-language-controls';
import { useMediaSubtitles } from '../media-subtitles/use-media-subtitles';
import { AudioTranscript } from './audio-transcript';
import { createAudioRendererActions } from './renderer-actions';
import {
  AUDIO_PLAYBACK_RATES,
  AUDIO_WORKBENCH_ID,
  audioEventTypes,
  audioWorkbenchManifest,
  cloneAudioViewState,
  createAudioGetDubbingSnapshotCommand,
  createAudioGetSubtitleSnapshotCommand,
  createAudioRetryDubbingCommand,
  createAudioRetrySubtitlesCommand,
  createAudioSaveViewStateCommand,
  createAudioSetSubtitleModeCommand,
  createAudioStartDubbingCommand,
  createAudioTimeRangeTarget,
  DEFAULT_AUDIO_VIEW_STATE,
  EMPTY_AUDIO_DUBBING_SNAPSHOT,
  EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
  isAudioDubbingSnapshot,
  isAudioSaveViewStateResult,
  isAudioSubtitleCueFinalPayload,
  isAudioSubtitleSnapshot,
  isAudioWorkbenchPayload,
  type AudioWorkbenchViewState,
} from './shared';

type AudioLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string };

const SAVE_DELAY_MS = 750;
const AUDIO_HAVE_METADATA = 1;
const AUDIO_METADATA_TIMEOUT_MS = 15_000;

const AUDIO_SUBTITLE_PROTOCOL = Object.freeze({
  snapshotEventType: audioEventTypes.subtitleSnapshot,
  cueFinalEventType: audioEventTypes.subtitleCueFinal,
  createGetSnapshotCommand: createAudioGetSubtitleSnapshotCommand,
  createSetModeCommand: createAudioSetSubtitleModeCommand,
  createRetryCommand: createAudioRetrySubtitlesCommand,
  isSetModeResult: isAudioSaveViewStateResult,
  isSnapshot: isAudioSubtitleSnapshot,
  isCueFinalPayload: isAudioSubtitleCueFinalPayload,
});

const AUDIO_DUBBING_PLAYBACK_PROTOCOL = Object.freeze({
  snapshotEventType: audioEventTypes.dubbingSnapshot,
  createGetSnapshotCommand: createAudioGetDubbingSnapshotCommand,
  createStartCommand: createAudioStartDubbingCommand,
  createRetryCommand: createAudioRetryDubbingCommand,
  isSnapshot: isAudioDubbingSnapshot,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function captureAudioState(audio: HTMLAudioElement): AudioWorkbenchViewState {
  return {
    currentTime: Number.isFinite(audio.currentTime)
      ? clamp(audio.currentTime, 0, 1_000_000_000)
      : 0,
    volume: clamp(audio.volume, 0, 1),
    muted: audio.muted,
    playbackRate: clamp(audio.playbackRate, 0.25, 4),
  };
}

export function AudioWorkbenchView({
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
  const payload = isAudioWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const audioRef = useRef<HTMLAudioElement>(null);
  const suppressAudioVolumeEventRef = useRef(false);
  const desiredAudioStateRef = useRef({
    volume: payload?.viewState.volume ?? 1,
    muted: payload?.viewState.muted ?? false,
  });
  const saveTimerRef = useRef<number | undefined>(undefined);
  const latestViewStateRef = useRef<AudioWorkbenchViewState>(
    payload?.viewState ?? cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
  );
  const [loadState, setLoadState] = useState<AudioLoadState>({
    kind: 'loading',
  });
  const [currentTime, setCurrentTime] = useState(
    payload?.viewState.currentTime ?? 0,
  );
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(payload?.viewState.volume ?? 1);
  const [muted, setMuted] = useState(payload?.viewState.muted ?? false);
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
  const subtitles = useMediaSubtitles({
    resetKey: bootstrap.sessionId,
    initialMode: payload?.subtitleState.displayMode ?? 'source',
    initialSnapshot: payload?.subtitleSnapshot ?? EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
    executeCommand,
    subscribeEvent,
    reportError,
    protocol: AUDIO_SUBTITLE_PROTOCOL,
    mediaLabel: '音频',
  });
  const dubbing = useMediaDubbingPlayback({
    resetKey: bootstrap.sessionId,
    initialSnapshot: payload?.dubbingSnapshot ?? EMPTY_AUDIO_DUBBING_SNAPSHOT,
    currentTime,
    duration,
    desiredAudioState: { volume, muted, playbackRate },
    mediaRef: audioRef,
    suppressMediaVolumeEventRef: suppressAudioVolumeEventRef,
    executeCommand,
    subscribeEvent,
    reportError,
    protocol: AUDIO_DUBBING_PLAYBACK_PROTOCOL,
    mediaLabel: '音频',
  });

  const persistViewState = useCallback(
    async (state: AudioWorkbenchViewState) => {
      try {
        const result = await executeCommand(createAudioSaveViewStateCommand(state));
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
      if (!audio) return;
      const state = {
        ...captureAudioState(audio),
        ...desiredAudioStateRef.current,
      };
      latestViewStateRef.current = state;
      setCurrentTime(state.currentTime);
      setPlaybackRateState(state.playbackRate);

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (immediate) {
        saveTimerRef.current = undefined;
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
    if (!payload || !audio) return;

    setLoadState({ kind: 'loading' });
    latestViewStateRef.current = cloneAudioViewState(payload.viewState);
    desiredAudioStateRef.current = {
      volume: payload.viewState.volume,
      muted: payload.viewState.muted,
    };
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
        audio.currentTime =
          viewState.currentTime >= audio.duration - 0.25
            ? 0
            : Math.min(viewState.currentTime, audio.duration);
      }
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0);
      setPlaying(!audio.paused && !audio.ended);
      setVolume(viewState.volume);
      setMuted(viewState.muted);
      setPlaybackRateState(viewState.playbackRate);
      setLoadState({ kind: 'ready' });
    };
    const onErrorEvent = () => {
      clearMetadataTimeout();
      setLoadState({ kind: 'failed', message: audioErrorMessage(audio.error) });
    };
    const onTimeUpdate = () => captureAndScheduleSave(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onSeeked = () => captureAndScheduleSave(true);
    const onRateChange = () => {
      setPlaybackRateState(audio.playbackRate);
      captureAndScheduleSave(true);
    };
    const onVolumeChange = () => {
      if (suppressAudioVolumeEventRef.current) return;
      desiredAudioStateRef.current = {
        volume: audio.volume,
        muted: audio.muted,
      };
      setVolume(audio.volume);
      setMuted(audio.muted);
      captureAndScheduleSave(true);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onErrorEvent);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ratechange', onRateChange);
    audio.addEventListener('volumechange', onVolumeChange);
    metadataTimeoutId = window.setTimeout(() => {
      if (audio.error) onErrorEvent();
      else if (hasLoadedAudioMetadata(audio)) onLoadedMetadata();
      else {
        setLoadState({
          kind: 'failed',
          message: '读取音频元数据超时，请刷新后重试。',
        });
      }
    }, AUDIO_METADATA_TIMEOUT_MS);
    if (audio.error) onErrorEvent();
    else if (hasLoadedAudioMetadata(audio)) onLoadedMetadata();

    return () => {
      clearMetadataTimeout();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onErrorEvent);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ratechange', onRateChange);
      audio.removeEventListener('volumechange', onVolumeChange);
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const finalState = {
        ...captureAudioState(audio),
        ...desiredAudioStateRef.current,
      };
      void persistViewState(finalState);
      audio.pause();
    };
  }, [captureAndScheduleSave, payload, persistViewState]);

  const ready = loadState.kind === 'ready';
  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch (error) {
      reportError(error, '无法切换音频播放状态。');
    }
  }, [reportError]);
  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = clamp(seconds, 0, Number.isFinite(audio.duration) ? audio.duration : seconds);
    setCurrentTime(audio.currentTime);
  }, []);
  const toggleMuted = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !desiredAudioStateRef.current.muted;
    desiredAudioStateRef.current = {
      ...desiredAudioStateRef.current,
      muted: next,
    };
    setMuted(next);
    if (!dubbing.isPlaybackActive()) audio.muted = next;
    captureAndScheduleSave(true);
  }, [captureAndScheduleSave, dubbing]);
  const changeVolume = useCallback((nextVolume: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const normalized = clamp(nextVolume, 0, 1);
    desiredAudioStateRef.current = { volume: normalized, muted: false };
    setVolume(normalized);
    setMuted(false);
    audio.volume = normalized;
    if (!dubbing.isPlaybackActive()) audio.muted = false;
    captureAndScheduleSave(true);
  }, [captureAndScheduleSave, dubbing]);
  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (
      !audio ||
      !AUDIO_PLAYBACK_RATES.includes(rate as (typeof AUDIO_PLAYBACK_RATES)[number])
    ) return;
    audio.playbackRate = rate;
    setPlaybackRateState(rate);
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
        onPlaybackRate: setPlaybackRate,
        onReveal: reveal,
      }),
    [playbackRate, ready, reveal, setPlaybackRate, togglePlayback],
  );
  useWorkbenchContributions(AUDIO_WORKBENCH_ID, rendererActions);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const seconds = audioRef.current?.currentTime ?? currentTime;
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        { focus: createAudioTimeRangeTarget(seconds), inputs: [] },
      );
    },
    [bootstrap.sessionId, currentTime, runtime],
  );

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">Audio Workbench 数据无效</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#11151a]"
      onContextMenuCapture={openContextMenu}
    >
      <audio
        ref={audioRef}
        aria-label="音频播放器"
        src={payload.contentUrl}
        preload="metadata"
        className="hidden"
      />
      <MediaDubbingAudioTrack controller={dubbing} mediaLabel="音频" />

      <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_50%_20%,rgba(129,140,248,0.07),transparent_45%),#11151a]">
        <AudioTranscript
          snapshot={subtitles.snapshot}
          mode={subtitles.mode}
          currentTime={currentTime}
          onSeek={seek}
        />
      </div>

      <div className="shrink-0 border-t border-white/[0.08] bg-[#151a21] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]">
        <MediaPlaybackControls
          mediaLabel="音频"
          ready={ready}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          muted={muted}
          playbackRate={playbackRate}
          generatedSuffixStartSeconds={dubbing.generatedSuffixStartSeconds}
          trailingControls={
            <MediaLanguageControls
              mediaLabel="音频"
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
          onSeek={seek}
          onToggleMuted={toggleMuted}
          onVolumeChange={changeVolume}
          onPlaybackRateChange={setPlaybackRate}
        />
      </div>

      {loadState.kind === 'loading' && (
        <div className="pointer-events-none absolute inset-0 bottom-20 grid place-items-center bg-[#11151a]/68">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在读取音频信息…
          </div>
        </div>
      )}

      {loadState.kind === 'failed' && (
        <div className="absolute inset-0 bottom-20 grid place-items-center bg-[#11151a]/94 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">无法播放这个音频</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
              {loadState.message}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" onClick={onRefresh} className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300">
                刷新
              </button>
              <button type="button" onClick={onRelink} className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300">
                重新定位
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const audioRendererWorkbenchModule: RendererWorkbenchModule<
  typeof audioWorkbenchManifest.id
> = {
  manifest: audioWorkbenchManifest,
  View: AudioWorkbenchView,
};

export default audioRendererWorkbenchModule;
