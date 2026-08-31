import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import type { MediaDubbingSnapshot } from './contracts';
import {
  isMediaDubbingPlaybackAvailable,
  resolveMediaDubbingPlayback,
  type MediaDubbingPlaybackSource,
} from './media-dubbing-playback';

interface DesiredAudioState {
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
}

export interface MediaDubbingPlaybackProtocol {
  readonly snapshotEventType: string;
  readonly createGetSnapshotCommand: () => WorkbenchCommand;
  readonly createStartCommand: () => WorkbenchCommand;
  readonly createRetryCommand: () => WorkbenchCommand;
  readonly isSnapshot: (value: unknown) => value is MediaDubbingSnapshot;
}

export interface UseMediaDubbingPlaybackInput {
  readonly resetKey: string;
  readonly initialSnapshot: MediaDubbingSnapshot;
  readonly currentTime: number;
  readonly duration: number;
  readonly desiredAudioState: DesiredAudioState;
  readonly mediaRef: RefObject<HTMLMediaElement | null>;
  readonly suppressMediaVolumeEventRef: RefObject<boolean>;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly subscribeEvent?: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  readonly reportError: (error: unknown, fallback: string) => void;
  readonly protocol: MediaDubbingPlaybackProtocol;
  readonly mediaLabel: '视频' | '音频';
}

export interface MediaDubbingPlaybackController {
  readonly snapshot: MediaDubbingSnapshot;
  readonly enabled: boolean;
  readonly playbackActive: boolean;
  readonly generatedSuffixStartSeconds?: number;
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly audioUrl?: string;
  readonly onAudioCanPlay: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onAudioError: () => void;
  readonly start: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly selectEnabled: (enabled: boolean) => void;
  readonly isPlaybackActive: () => boolean;
}

function synchronizeMediaTime(
  media: HTMLMediaElement,
  seconds: number,
): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  try {
    media.currentTime = seconds;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
      throw error;
    }
  }
}

function showsGeneratedSuffix(snapshot: MediaDubbingSnapshot): boolean {
  return (
    snapshot.phase === 'preparing-runtime' ||
    snapshot.phase === 'separating' ||
    snapshot.phase === 'cloning' ||
    snapshot.phase === 'mixing' ||
    snapshot.phase === 'interrupted' ||
    snapshot.phase === 'failed' ||
    snapshot.phase === 'ready'
  );
}

export function useMediaDubbingPlayback({
  resetKey,
  initialSnapshot,
  currentTime,
  duration,
  desiredAudioState,
  mediaRef,
  suppressMediaVolumeEventRef,
  executeCommand,
  subscribeEvent,
  reportError,
  protocol,
  mediaLabel,
}: UseMediaDubbingPlaybackInput): MediaDubbingPlaybackController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackActiveRef = useRef(false);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const playbackSourceRef = useRef<MediaDubbingPlaybackSource>({
    kind: 'original',
  });
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [enabled, setEnabled] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const playbackSource = useMemo(
    () => resolveMediaDubbingPlayback(snapshot, enabled, currentTime * 1_000),
    [currentTime, enabled, snapshot],
  );
  const audioUrl =
    playbackSource.kind === 'original' ? undefined : playbackSource.audioUrl;
  const playbackActive = playbackSource.kind !== 'original' && audioReady;
  const generatedSuffixStartSeconds = showsGeneratedSuffix(snapshot)
    ? snapshot.durationMs > 0
      ? snapshot.readySuffixStartMs / 1_000
      : duration
    : undefined;

  useEffect(() => {
    setSnapshot(initialSnapshot);
    setEnabled(false);
  }, [initialSnapshot, resetKey]);

  useEffect(() => {
    playbackActiveRef.current = playbackActive;
    audioUrlRef.current = audioUrl;
    playbackSourceRef.current = playbackSource;
  }, [audioUrl, playbackActive, playbackSource]);

  useEffect(() => {
    setAudioReady(false);
  }, [audioUrl]);

  useEffect(() => {
    if (
      snapshot.phase === 'idle' ||
      snapshot.phase === 'runtime-required' ||
      snapshot.phase === 'unsupported'
    ) {
      setEnabled(false);
    }
  }, [snapshot.phase]);

  useEffect(() => {
    if (!subscribeEvent) {
      throw new Error(`${mediaLabel} Workbench 缺少异步事件通道`);
    }
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = subscribeEvent((event) => {
      if (
        event.type === protocol.snapshotEventType &&
        protocol.isSnapshot(event.payload)
      ) {
        receivedEvent = true;
        setSnapshot(event.payload);
      }
    });

    void executeCommand(protocol.createGetSnapshotCommand())
      .then((result) => {
        if (disposed || receivedEvent) return;
        if (!protocol.isSnapshot(result.payload)) {
          throw new Error(`${mediaLabel} Workbench 配音状态响应无效`);
        }
        setSnapshot(result.payload);
      })
      .catch((error: unknown) => {
        if (!disposed) reportError(error, '无法同步配音状态。');
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    executeCommand,
    mediaLabel,
    protocol,
    reportError,
    resetKey,
    subscribeEvent,
  ]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const synchronize = () => {
      const audio = audioRef.current;
      if (
        playbackActiveRef.current &&
        audioUrlRef.current &&
        audio &&
        Math.abs(audio.currentTime - media.currentTime) > 0.2
      ) {
        synchronizeMediaTime(audio, media.currentTime);
      }
    };
    const play = () => {
      const audio = audioRef.current;
      if (!playbackActiveRef.current || !audioUrlRef.current || !audio) return;
      synchronizeMediaTime(audio, media.currentTime);
      void audio.play().catch(() => undefined);
    };
    const pause = () => audioRef.current?.pause();
    const updateRate = () => {
      if (audioRef.current) {
        audioRef.current.playbackRate = media.playbackRate;
      }
    };

    media.addEventListener('timeupdate', synchronize);
    media.addEventListener('seeked', synchronize);
    media.addEventListener('play', play);
    media.addEventListener('pause', pause);
    media.addEventListener('ended', pause);
    media.addEventListener('ratechange', updateRate);
    return () => {
      media.removeEventListener('timeupdate', synchronize);
      media.removeEventListener('seeked', synchronize);
      media.removeEventListener('play', play);
      media.removeEventListener('pause', pause);
      media.removeEventListener('ended', pause);
      media.removeEventListener('ratechange', updateRate);
      audioRef.current?.pause();
    };
  }, [mediaRef, resetKey]);

  useEffect(() => {
    const media = mediaRef.current;
    const audio = audioRef.current;
    if (!media || !audio) return;
    suppressMediaVolumeEventRef.current = true;
    media.volume = desiredAudioState.volume;
    media.muted = playbackActive ? true : desiredAudioState.muted;
    audio.volume = desiredAudioState.volume;
    audio.muted = desiredAudioState.muted;
    audio.playbackRate = desiredAudioState.playbackRate;
    synchronizeMediaTime(audio, media.currentTime);
    if (playbackActive && !media.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
    const releaseSuppression = window.setTimeout(() => {
      suppressMediaVolumeEventRef.current = false;
    }, 0);
    return () => {
      window.clearTimeout(releaseSuppression);
      suppressMediaVolumeEventRef.current = false;
    };
  }, [
    desiredAudioState.muted,
    desiredAudioState.playbackRate,
    desiredAudioState.volume,
    playbackActive,
    mediaRef,
    suppressMediaVolumeEventRef,
  ]);

  const onAudioCanPlay = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      if (
        audioUrlRef.current &&
        event.currentTarget.getAttribute('src') === audioUrlRef.current
      ) {
        setAudioReady(true);
      }
    },
    [],
  );
  const onAudioError = useCallback(() => {
    setAudioReady(false);
    if (playbackSourceRef.current.kind === 'final') {
      setEnabled(false);
      reportError(
        new Error('生成的配音音轨无法读取'),
        '无法播放生成的配音。',
      );
    }
  }, [reportError]);
  const start = useCallback(async () => {
    setEnabled(true);
    try {
      await executeCommand(protocol.createStartCommand());
    } catch (error) {
      setEnabled(false);
      reportError(error, `无法开始生成${mediaLabel}配音。`);
    }
  }, [executeCommand, mediaLabel, protocol, reportError]);
  const retry = useCallback(async () => {
    setEnabled(true);
    try {
      await executeCommand(protocol.createRetryCommand());
    } catch (error) {
      setEnabled(false);
      reportError(error, `无法继续生成${mediaLabel}配音。`);
    }
  }, [executeCommand, mediaLabel, protocol, reportError]);
  const selectEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (!nextEnabled || isMediaDubbingPlaybackAvailable(snapshot)) {
        setEnabled(nextEnabled);
      }
    },
    [snapshot],
  );
  const isPlaybackActive = useCallback(
    () => playbackActiveRef.current,
    [],
  );

  return {
    snapshot,
    enabled,
    playbackActive,
    generatedSuffixStartSeconds,
    audioRef,
    audioUrl,
    onAudioCanPlay,
    onAudioError,
    start,
    retry,
    selectEnabled,
    isPlaybackActive,
  };
}

export function MediaDubbingAudioTrack({
  controller,
  mediaLabel,
}: {
  readonly controller: MediaDubbingPlaybackController;
  readonly mediaLabel: '视频' | '音频';
}) {
  return (
    <audio
      ref={controller.audioRef}
      aria-label={`${mediaLabel}译制配音`}
      src={controller.audioUrl}
      preload="metadata"
      className="hidden"
      onCanPlay={controller.onAudioCanPlay}
      onError={controller.onAudioError}
    />
  );
}
