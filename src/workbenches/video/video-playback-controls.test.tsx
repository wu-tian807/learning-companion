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
          fullscreen={false}
          trailingControls={<span data-testid="language-controls">字幕</span>}
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
        '进入全屏',
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
    const progressRow = container.querySelector(
      '[data-video-progress-row="true"]',
    );
    const actionRow = container.querySelector(
      '[data-video-action-row="true"]',
    );
    const secondaryControls = container.querySelector(
      '[data-video-secondary-controls="true"]',
    );
    const volumeSlider = container.querySelector(
      '[data-video-volume-slider="true"]',
    );

    expect(progressRow?.contains(progress)).toBe(true);
    expect(progressRow?.contains(secondaryControls)).toBe(false);
    expect(actionRow?.contains(secondaryControls)).toBe(true);
    expect(secondaryControls?.textContent).toBe('字幕');
    expect(volumeSlider?.className).toContain('w-0');
    expect(volumeSlider?.className).toContain('group-hover/volume:w-16');
    expect(volumeSlider?.className).toContain('group-focus-within/volume:w-16');
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

  it('renders completed dubbing as a suffix that grows from right to left', () => {
    act(() =>
      root.render(
        <VideoPlaybackControls
          ready
          playing={false}
          currentTime={0}
          duration={100}
          volume={1}
          muted={false}
          playbackRate={1}
          fullscreen={false}
          generatedSuffixStartSeconds={65}
          onTogglePlayback={vi.fn()}
          onSeek={vi.fn()}
          onToggleMuted={vi.fn()}
          onVolumeChange={vi.fn()}
          onPlaybackRateChange={vi.fn()}
          onToggleFullscreen={vi.fn()}
        />,
      ),
    );

    const suffix = container.querySelector<HTMLElement>(
      '[aria-label="配音已生成区间"]',
    );
    const completed = suffix?.querySelector<HTMLElement>('[style]');
    expect(suffix?.className).toContain('inset-x-3');
    expect(completed?.style.width).toBe('35%');
  });

  it('shows the real fullscreen state and keeps the exit action visible', () => {
    const props = {
      ready: true,
      playing: false,
      currentTime: 0,
      duration: 60,
      volume: 1,
      muted: false,
      playbackRate: 1,
      onTogglePlayback: vi.fn(),
      onSeek: vi.fn(),
      onToggleMuted: vi.fn(),
      onVolumeChange: vi.fn(),
      onPlaybackRateChange: vi.fn(),
      onToggleFullscreen: vi.fn(),
    } as const;

    act(() =>
      root.render(<VideoPlaybackControls {...props} fullscreen={false} />),
    );

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="进入全屏"]',
    );
    expect(enterButton?.textContent).toBe('全屏');
    expect(enterButton?.getAttribute('aria-pressed')).toBe('false');

    act(() => root.render(<VideoPlaybackControls {...props} fullscreen />));

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="退出全屏"]',
    );
    expect(exitButton?.textContent).toBe('退出');
    expect(exitButton?.getAttribute('aria-pressed')).toBe('true');
    expect(exitButton?.className).toContain('bg-indigo-400/20');
  });
});
