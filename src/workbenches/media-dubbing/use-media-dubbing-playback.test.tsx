// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import type { MediaDubbingSnapshot } from './contracts';
import { isMediaDubbingSnapshot } from './contracts';
import {
  useMediaDubbingPlayback,
  MediaDubbingAudioTrack,
  type MediaDubbingPlaybackProtocol,
} from './use-media-dubbing-playback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const previewSnapshot: MediaDubbingSnapshot = {
  phase: 'cloning',
  completedPhrases: 3,
  totalPhrases: 8,
  completedDurationMs: 8_000,
  durationMs: 20_000,
  readySuffixStartMs: 12_000,
  previewAudioUrl: 'learning-content://resource/preview',
};

function snapshotResult(
  snapshot: MediaDubbingSnapshot,
): WorkbenchCommandResult {
  return {
    payload: snapshot as unknown as WorkbenchCommandResult['payload'],
  };
}

interface HarnessProps {
  readonly snapshot: MediaDubbingSnapshot;
  readonly currentTime: number;
  readonly volume?: number;
  readonly muted?: boolean;
  readonly playbackRate?: number;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly reportError: (error: unknown, fallback: string) => void;
}

const protocol: MediaDubbingPlaybackProtocol = {
  snapshotEventType: 'media:dubbing-snapshot',
  createGetSnapshotCommand: () => ({ type: 'media:get-dubbing-snapshot' }),
  createStartCommand: () => ({ type: 'media:start-dubbing' }),
  createRetryCommand: () => ({ type: 'media:retry-dubbing' }),
  isSnapshot: isMediaDubbingSnapshot,
};

function Harness({
  snapshot,
  currentTime,
  volume = 0.75,
  muted = false,
  playbackRate = 1,
  executeCommand,
  reportError,
}: HarnessProps) {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const suppressVolumeEventRef = useRef(false);
  const controller = useMediaDubbingPlayback({
    resetKey: 'session:revision',
    initialSnapshot: snapshot,
    currentTime,
    duration: 20,
    desiredAudioState: { volume, muted, playbackRate },
    mediaRef,
    suppressMediaVolumeEventRef: suppressVolumeEventRef,
    executeCommand,
    subscribeEvent: () => () => undefined,
    reportError,
    protocol,
    mediaLabel: '视频',
  });

  return (
    <>
      <video ref={mediaRef} aria-label="视频" />
      <MediaDubbingAudioTrack controller={controller} mediaLabel="视频" />
      <button type="button" onClick={() => controller.selectEnabled(true)}>
        开启配音
      </button>
      <output data-active={String(controller.playbackActive)}>
        {controller.enabled ? '配音' : '原声'}
      </output>
    </>
  );
}

describe('useMediaDubbingPlayback', () => {
  let container: HTMLDivElement;
  let root: Root;
  let executeCommand = vi.fn<HarnessProps['executeCommand']>();
  let reportError = vi.fn<HarnessProps['reportError']>();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    executeCommand = vi.fn(async () => snapshotResult(previewSnapshot));
    reportError = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderHarness(
    props: Partial<HarnessProps> & Pick<HarnessProps, 'snapshot' | 'currentTime'>,
  ) {
    await act(async () => {
      root.render(
        <Harness
          {...props}
          executeCommand={props.executeCommand ?? executeCommand}
          reportError={props.reportError ?? reportError}
        />,
      );
    });
  }

  async function enableDubbing() {
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('synchronizes the generated track with play, seek, pause, rate, and volume', async () => {
    await renderHarness({ snapshot: previewSnapshot, currentTime: 13 });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    if (!video) return;
    video.currentTime = 13;

    await enableDubbing();
    const audio = container.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe(previewSnapshot.previewAudioUrl);
    if (!audio) return;
    await act(async () => audio.dispatchEvent(new Event('canplay')));

    expect(video.muted).toBe(true);
    expect(audio.volume).toBe(0.75);
    expect(audio.currentTime).toBe(13);

    Object.defineProperty(video, 'paused', {
      configurable: true,
      get: () => false,
    });
    video.currentTime = 15;
    audio.currentTime = 0;
    video.dispatchEvent(new Event('play'));
    expect(audio.currentTime).toBe(15);
    expect(audio.play).toHaveBeenCalled();

    video.currentTime = 17;
    audio.currentTime = 3;
    video.dispatchEvent(new Event('seeked'));
    expect(audio.currentTime).toBe(17);

    video.playbackRate = 1.5;
    video.dispatchEvent(new Event('ratechange'));
    expect(audio.playbackRate).toBe(1.5);

    video.dispatchEvent(new Event('pause'));
    expect(audio.pause).toHaveBeenCalled();

    await renderHarness({
      snapshot: previewSnapshot,
      currentTime: 17,
      volume: 0.4,
      muted: true,
      playbackRate: 1.25,
    });
    expect(audio.volume).toBe(0.4);
    expect(audio.muted).toBe(true);
    expect(audio.playbackRate).toBe(1.25);
  });

  it('keeps original audio before the durable suffix and switches at its boundary', async () => {
    await renderHarness({ snapshot: previewSnapshot, currentTime: 11 });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    await enableDubbing();

    expect(container.querySelector('audio')?.getAttribute('src')).toBeNull();
    expect(video?.muted).toBe(false);

    await renderHarness({ snapshot: previewSnapshot, currentTime: 12 });
    const audio = container.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe(previewSnapshot.previewAudioUrl);
    if (!audio) return;
    await act(async () => audio.dispatchEvent(new Event('canplay')));
    expect(video?.muted).toBe(true);

    await renderHarness({ snapshot: previewSnapshot, currentTime: 11 });
    expect(container.querySelector('audio')?.getAttribute('src')).toBeNull();
    expect(video?.muted).toBe(false);
  });

  it('falls back to original audio and reports an unreadable final track', async () => {
    const readySnapshot: MediaDubbingSnapshot = {
      ...previewSnapshot,
      phase: 'ready',
      completedPhrases: 8,
      completedDurationMs: 20_000,
      readySuffixStartMs: 0,
      previewAudioUrl: undefined,
      audioUrl: 'learning-content://resource/final',
    };
    executeCommand.mockResolvedValue(snapshotResult(readySnapshot));
    await renderHarness({ snapshot: readySnapshot, currentTime: 4 });
    await enableDubbing();
    const audio = container.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe(readySnapshot.audioUrl);
    if (!audio) return;
    await act(async () => audio.dispatchEvent(new Event('canplay')));
    expect(container.querySelector('video')?.muted).toBe(true);

    await act(async () => audio.dispatchEvent(new Event('error')));

    expect(container.querySelector('output')?.textContent).toBe('原声');
    expect(container.querySelector('video')?.muted).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      '无法播放生成的配音。',
    );
  });
});
