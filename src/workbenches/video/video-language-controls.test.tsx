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

const sourceTrack = {
  version: 1 as const,
  kind: 'subtitle-source' as const,
  sourceRevision: 'revision',
  language: 'en' as const,
  origin: 'asr' as const,
  engine: {
    id: 'whisper',
    version: '1',
    model: 'turbo',
    backend: 'cuda',
  },
  generatedTime: 100,
  cues: [],
};

const readySubtitleSnapshot = {
  ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  phase: 'ready' as const,
  source: sourceTrack,
  translation: {
    version: 1 as const,
    kind: 'subtitle-translation' as const,
    sourceTrackRevision: 'revision',
    sourceLanguage: 'en' as const,
    targetLanguage: 'zh-Hans' as const,
    profile: 'quality' as const,
    engine: { id: 'codex', version: '1', model: 'gpt', backend: 'agent' },
    generatedTime: 200,
    cues: [],
  },
};

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
    document
      .querySelectorAll('[role="listbox"]')
      .forEach((node) => node.remove());
  });

  it('opens subtitle settings but keeps dubbing disabled with every missing prerequisite', () => {
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
    expect(container.textContent).toContain('配音');
    expect(container.textContent).not.toContain('安装配音');
    const dubbingButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '配音',
    );
    expect(dubbingButton?.disabled).toBe(true);
    expect(dubbingButton?.parentElement?.title).toContain('字幕组件尚未安装');
    expect(dubbingButton?.parentElement?.title).toContain(
      'VoxCPM2 视频/音频配音组件尚未安装',
    );
    expect(onOpenSettings).toHaveBeenCalledOnce();

    const providerMessage =
      '“低智能”翻译连接未通过验证。请在设置中完成登录，或配置有效的 API Key。';
    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="translated"
          subtitleSnapshot={{
            ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
            phase: 'provider-required',
            source: sourceTrack,
            message: providerMessage,
          }}
          dubbingSnapshot={EMPTY_VIDEO_DUBBING_SNAPSHOT}
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
    const configureButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '配置翻译 AI',
    );
    act(() => configureButton?.click());
    expect(configureButton?.title).toBe(providerMessage);
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    const blockedDubbingButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '配音',
    );
    expect(blockedDubbingButton?.disabled).toBe(true);
    expect(blockedDubbingButton?.parentElement?.title).toBe(providerMessage);
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
            source: sourceTrack,
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

  it('shows active subtitle generation instead of looking stuck in preparation', () => {
    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="source"
          subtitleSnapshot={{
            ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
            phase: 'transcribing',
            message: '正在生成原文字幕…',
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

    expect(container.textContent).toContain('字幕生成中');
    expect(container.querySelector('button')?.title).toContain('生成原文字幕');
    expect(container.querySelector('[aria-label="字幕显示模式"]')).toBeNull();
    expect(container.textContent).not.toContain('字幕准备中');
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
          subtitleSnapshot={readySubtitleSnapshot}
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
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '配音')
        ?.click(),
    );
    expect(onStartDubbing).toHaveBeenCalledOnce();

    act(() =>
      root.render(
        <VideoLanguageControls
          subtitleMode="off"
          subtitleSnapshot={readySubtitleSnapshot}
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
    act(() =>
      failedButtons.find((button) => button.textContent === '配音')?.click(),
    );
    expect(onSelectDubbingEnabled).toHaveBeenCalledWith(true);
    act(() => failedButtons.at(-1)?.click());
    expect(onRetryDubbing).toHaveBeenCalledOnce();
  });
});
