// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_VIDEO_DUBBING_SNAPSHOT,
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
} from './shared';
import { VideoLanguageControls } from './video-language-controls';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('VideoLanguageControls', () => {
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
    document.querySelectorAll('[role="listbox"]').forEach((node) => node.remove());
  });

  it('opens settings directly when subtitle or dubbing components are missing', () => {
    const onOpenSettings = vi.fn();

    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={{
            ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
            phase: 'runtime-required',
          }}
          dubbingSnapshot={{
            ...EMPTY_VIDEO_DUBBING_SNAPSHOT,
            phase: 'runtime-required',
          }}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={vi.fn()}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={vi.fn()}
          onSelectDubbingEnabled={vi.fn()}
          onRetryDubbing={vi.fn()}
          onOpenSettings={onOpenSettings}
        />,
      ),
    );

    act(() => {
      [...container.querySelectorAll('button')].forEach((button) =>
        button.click(),
      );
    });

    expect(container.textContent).toContain('安装字幕');
    expect(container.textContent).toContain('安装配音');
    expect(container.textContent).not.toContain('重试配音');
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
  });

  it('keeps subtitle modes in a compact menu instead of four permanent buttons', async () => {
    const onSelectSubtitleMode = vi.fn();

    await act(async () =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={{
            ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
            phase: 'source-ready',
            source: {
              version: 1,
              kind: 'subtitle-source',
              sourceRevision: 'revision',
              language: 'en',
              origin: 'asr',
              engine: {
                id: 'whisper',
                version: '1',
                model: 'turbo',
                backend: 'cuda',
              },
              generatedTime: 100,
              cues: [],
            },
          }}
          dubbingSnapshot={EMPTY_VIDEO_DUBBING_SNAPSHOT}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={onSelectSubtitleMode}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={vi.fn()}
          onSelectDubbingEnabled={vi.fn()}
          onRetryDubbing={vi.fn()}
        />,
      ),
    );

    const selector = container.querySelector<HTMLButtonElement>(
      '[aria-label="字幕显示模式"]',
    );
    expect(container.textContent).toContain('字幕关闭');
    expect(selector?.textContent).toContain('关闭');
    expect(selector?.textContent).not.toContain('字幕');

    await act(async () => selector?.click());
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      '关闭',
      '原文',
      '译文',
      '双语',
    ]);
    const sourceOption = options.find(
      (option) => option.textContent === '原文',
    ) as HTMLButtonElement | undefined;
    await act(async () => sourceOption?.click());

    expect(onSelectSubtitleMode).toHaveBeenCalledWith('source');
  });

  it('only offers source subtitles when the detected language is unknown', async () => {
    await act(async () =>
      root.render(
        <VideoLanguageControls
          subtitleMode="source"
          subtitleSnapshot={{
            ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
            phase: 'unsupported-language',
            message: '未检测到明确的中文或英文。',
            source: {
              version: 1,
              kind: 'subtitle-source',
              sourceRevision: 'revision',
              language: 'unknown',
              origin: 'asr',
              engine: {
                id: 'whisper',
                version: '1',
                model: 'turbo',
                backend: 'cuda',
              },
              generatedTime: 100,
              cues: [],
            },
          }}
          dubbingSnapshot={EMPTY_VIDEO_DUBBING_SNAPSHOT}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={vi.fn()}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={vi.fn()}
          onSelectDubbingEnabled={vi.fn()}
          onRetryDubbing={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain('仅原文');
    const selector = container.querySelector<HTMLButtonElement>(
      '[aria-label="字幕显示模式"]',
    );
    await act(async () => selector?.click());
    expect(
      [...document.querySelectorAll('[role="option"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['关闭', '原文']);
  });

  it('shows the audio switch while dubbing is running', () => {
    const onSelectDubbingEnabled = vi.fn();
    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={EMPTY_VIDEO_SUBTITLE_SNAPSHOT}
          dubbingSnapshot={{
            ...EMPTY_VIDEO_DUBBING_SNAPSHOT,
            phase: 'cloning',
            completedPhrases: 3,
            totalPhrases: 12,
            previewAudioUrl: 'learning-content://resource/preview',
          }}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={vi.fn()}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={vi.fn()}
          onSelectDubbingEnabled={onSelectDubbingEnabled}
          onRetryDubbing={vi.fn()}
        />,
      ),
    );

    expect(container.textContent).toContain('原声配音');
    const buttons = [...container.querySelectorAll('button')];
    act(() => buttons.find((button) => button.textContent === '配音')?.click());
    expect(onSelectDubbingEnabled).toHaveBeenCalledWith(true);
  });

  it('keeps audio selection separate from start and interrupted-task continuation', () => {
    const onStartDubbing = vi.fn();
    const onSelectDubbingEnabled = vi.fn();
    const onRetryDubbing = vi.fn();

    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={EMPTY_VIDEO_SUBTITLE_SNAPSHOT}
          dubbingSnapshot={EMPTY_VIDEO_DUBBING_SNAPSHOT}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={vi.fn()}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={onStartDubbing}
          onSelectDubbingEnabled={onSelectDubbingEnabled}
          onRetryDubbing={onRetryDubbing}
        />,
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>('button:last-child')?.click());
    expect(onStartDubbing).toHaveBeenCalledOnce();

    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={EMPTY_VIDEO_SUBTITLE_SNAPSHOT}
          dubbingSnapshot={{
            ...EMPTY_VIDEO_DUBBING_SNAPSHOT,
            phase: 'interrupted',
            completedPhrases: 4,
            totalPhrases: 12,
            previewAudioUrl: 'learning-content://resource/preview',
          }}
          dubbingEnabled={false}
          dubbingPlaybackActive={false}
          onSelectSubtitleMode={vi.fn()}
          onRetrySubtitles={vi.fn()}
          onStartDubbing={onStartDubbing}
          onSelectDubbingEnabled={onSelectDubbingEnabled}
          onRetryDubbing={onRetryDubbing}
        />,
      ),
    );
    expect(container.textContent).toContain('原声配音继续配音');
    const failedButtons = [...container.querySelectorAll('button')];
    act(() => failedButtons.find((button) => button.textContent === '配音')?.click());
    expect(onSelectDubbingEnabled).toHaveBeenCalledWith(true);
    act(() => failedButtons.at(-1)?.click());
    expect(onRetryDubbing).toHaveBeenCalledOnce();
  });
});
