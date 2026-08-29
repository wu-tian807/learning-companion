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
} from '../../../shared/workbench/protocol';
import {
  createVideoGetDubbingSnapshotCommand,
  createVideoRetryDubbingCommand,
  createVideoStartDubbingCommand,
  isVideoDubbingSnapshot,
  type VideoDubbingSnapshot,
  videoEventTypes,
} from '../shared';
import {
  isVideoDubbingPlaybackAvailable,
  resolveVideoDubbingPlayback,
  type VideoDubbingPlaybackSource,
} from './video-dubbing-playback';

interface DesiredAudioState {
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
}

export interface UseVideoDubbingPlaybackInput {
  readonly resetKey: string;
  readonly initialSnapshot: VideoDubbingSnapshot;
  readonly currentTime: number;
  readonly duration: number;
  readonly desiredAudioState: DesiredAudioState;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly suppressVideoVolumeEventRef: RefObject<boolean>;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly subscribeEvent?: (
    listener: (event: WorkbenchEvent) => void,
  ) => () => void;
  readonly reportError: (error: unknown, fallback: string) => void;
}

export interface VideoDubbingPlaybackController {
  readonly snapshot: VideoDubbingSnapshot;
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

function showsGeneratedSuffix(snapshot: VideoDubbingSnapshot): boolean {
  return (
    snapshot.phase === 'awaiting-translation' ||
    snapshot.phase === 'preparing-runtime' ||
    snapshot.phase === 'separating' ||
    snapshot.phase === 'cloning' ||
    snapshot.phase === 'mixing' ||
    snapshot.phase === 'interrupted' ||
    snapshot.phase === 'failed' ||
    snapshot.phase === 'ready'
  );
}

export function useVideoDubbingPlayback({
  resetKey,
  initialSnapshot,
  currentTime,
  duration,
  desiredAudioState,
  videoRef,
  suppressVideoVolumeEventRef,
  executeCommand,
  subscribeEvent,
  reportError,
}: UseVideoDubbingPlaybackInput): VideoDubbingPlaybackController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackActiveRef = useRef(false);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const playbackSourceRef = useRef<VideoDubbingPlaybackSource>({
    kind: 'original',
  });
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [enabled, setEnabled] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const playbackSource = useMemo(
    () => resolveVideoDubbingPlayback(snapshot, enabled, currentTime * 1_000),
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
      throw new Error('Video Workbench 缺少异步事件通道');
    }
    let disposed = false;
    let receivedEvent = false;
    const unsubscribe = subscribeEvent((event) => {
      if (
        event.type === videoEventTypes.dubbingSnapshot &&
        isVideoDubbingSnapshot(event.payload)
      ) {
        receivedEvent = true;
        setSnapshot(event.payload);
      }
    });

    void executeCommand(createVideoGetDubbingSnapshotCommand())
      .then((result) => {
        if (disposed || receivedEvent) return;
        if (!isVideoDubbingSnapshot(result.payload)) {
          throw new Error('Video Workbench 配音状态响应无效');
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
  }, [executeCommand, reportError, resetKey, subscribeEvent]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const synchronize = () => {
      const audio = audioRef.current;
      if (
        playbackActiveRef.current &&
        audioUrlRef.current &&
        audio &&
        Math.abs(audio.currentTime - video.currentTime) > 0.2
      ) {
        synchronizeMediaTime(audio, video.currentTime);
      }
    };
    const play = () => {
      const audio = audioRef.current;
      if (!playbackActiveRef.current || !audioUrlRef.current || !audio) return;
      synchronizeMediaTime(audio, video.currentTime);
      void audio.play().catch(() => undefined);
    };
    const pause = () => audioRef.current?.pause();
    const updateRate = () => {
      if (audioRef.current) {
        audioRef.current.playbackRate = video.playbackRate;
      }
    };

    video.addEventListener('timeupdate', synchronize);
    video.addEventListener('seeked', synchronize);
    video.addEventListener('play', play);
    video.addEventListener('pause', pause);
    video.addEventListener('ended', pause);
    video.addEventListener('ratechange', updateRate);
    return () => {
      video.removeEventListener('timeupdate', synchronize);
      video.removeEventListener('seeked', synchronize);
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('ended', pause);
      video.removeEventListener('ratechange', updateRate);
      audioRef.current?.pause();
    };
  }, [resetKey, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    suppressVideoVolumeEventRef.current = true;
    video.volume = desiredAudioState.volume;
    video.muted = playbackActive ? true : desiredAudioState.muted;
    audio.volume = desiredAudioState.volume;
    audio.muted = desiredAudioState.muted;
    audio.playbackRate = desiredAudioState.playbackRate;
    synchronizeMediaTime(audio, video.currentTime);
    if (playbackActive && !video.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
    const releaseSuppression = window.setTimeout(() => {
      suppressVideoVolumeEventRef.current = false;
    }, 0);
    return () => {
      window.clearTimeout(releaseSuppression);
      suppressVideoVolumeEventRef.current = false;
    };
  }, [
    desiredAudioState.muted,
    desiredAudioState.playbackRate,
    desiredAudioState.volume,
    playbackActive,
    suppressVideoVolumeEventRef,
    videoRef,
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
      await executeCommand(createVideoStartDubbingCommand());
    } catch (error) {
      setEnabled(false);
      reportError(error, '无法开始生成视频配音。');
    }
  }, [executeCommand, reportError]);
  const retry = useCallback(async () => {
    setEnabled(true);
    try {
      await executeCommand(createVideoRetryDubbingCommand());
    } catch (error) {
      setEnabled(false);
      reportError(error, '无法继续生成视频配音。');
    }
  }, [executeCommand, reportError]);
  const selectEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (!nextEnabled || isVideoDubbingPlaybackAvailable(snapshot)) {
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

export function VideoDubbingAudioTrack({
  controller,
}: {
  readonly controller: VideoDubbingPlaybackController;
}) {
  return (
    <audio
      ref={controller.audioRef}
      aria-label="视频译制配音"
      src={controller.audioUrl}
      preload="metadata"
      className="hidden"
      onCanPlay={controller.onAudioCanPlay}
      onError={controller.onAudioError}
    />
  );
}
