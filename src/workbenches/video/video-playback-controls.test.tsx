// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatVideoTime,
  VideoPlaybackControls,
} from './video-playback-controls';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('VideoPlaybackControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('formats finite and long media times without leaking invalid numbers', () => {
    expect(formatVideoTime(126.9)).toBe('2:06');
    expect(formatVideoTime(3_726)).toBe('1:02:06');
    expect(formatVideoTime(Number.NaN)).toBe('0:00');
  });

  it('exposes playback operations from the detached control dock', () => {
    const onTogglePlayback = vi.fn();
    const onSeek = vi.fn();
    const onToggleMuted = vi.fn();
    const onVolumeChange = vi.fn();
    const onPlaybackRateChange = vi.fn();
    const onToggleFullscreen = vi.fn();

    act(() =>
      root.render(
        <VideoPlaybackControls
          ready
          playing={false}
          currentTime={12}
          duration={60}
          volume={0.8}
          muted={false}
          playbackRate={1}
          onTogglePlayback={onTogglePlayback}
          onSeek={onSeek}
          onToggleMuted={onToggleMuted}
          onVolumeChange={onVolumeChange}
          onPlaybackRateChange={onPlaybackRateChange}
          onToggleFullscreen={onToggleFullscreen}
        />,
      ),
    );

    act(() => {
      for (const label of [
        '播放视频',
        '静音',
        '播放速度 1 倍，点击切换',
        '切换全屏',
      ]) {
        container
          .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
          ?.click();
      }
    });

    const progress = container.querySelector<HTMLInputElement>(
      '[aria-label="视频播放进度"]',
    );
    const volume = container.querySelector<HTMLInputElement>(
      '[aria-label="视频音量"]',
    );
    act(() => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      if (progress) {
        setInputValue?.call(progress, '24');
        progress.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (volume) {
        setInputValue?.call(volume, '0.4');
        volume.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(onToggleMuted).toHaveBeenCalledOnce();
    expect(onPlaybackRateChange).toHaveBeenCalledWith(1.25);
    expect(onToggleFullscreen).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(24);
    expect(onVolumeChange).toHaveBeenCalledWith(0.4);
  });

});
