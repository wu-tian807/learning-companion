// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AudioTranscript,
  resolveAudioTranscriptPosition,
  resolveAudioTranscriptRows,
} from './audio-transcript';
import type { AudioSpeakerTrack, AudioSubtitleSnapshot } from './shared';

function snapshot(): AudioSubtitleSnapshot {
  return {
    phase: 'translating',
    source: {
      version: 1,
      kind: 'subtitle-source',
      sourceRevision: 'source-revision',
      language: 'en',
      origin: 'asr',
      engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
      generatedTime: 100,
      cues: [
        {
          id: 'cue-1',
          startMs: 0,
          endMs: 1_000,
          text: 'Hello.',
          sourceCueIds: ['raw-1'],
        },
        {
          id: 'cue-2',
          startMs: 1_000,
          endMs: 2_000,
          text: 'Welcome.',
          sourceCueIds: ['raw-2'],
        },
      ],
    },
    partialTranslations: [{ sourceCueId: 'cue-1', text: '你好。' }],
    completedCues: 1,
    totalCues: 2,
  };
}

function speakerTrack(): AudioSpeakerTrack {
  return {
    version: 1,
    kind: 'dubbing-speaker-track',
    sourceTrackRevision: 'source-track-revision',
    cues: [
      { sourceCueId: 'cue-1', speakerId: 'speaker-0001', status: 'stable' },
      {
        sourceCueId: 'cue-2',
        speakerId: 'speaker-0001',
        status: 'uncertain',
      },
    ],
    profiles: [
      {
        speakerId: 'speaker-0001',
        mode: 'reference',
        referenceStartMs: 0,
        referenceEndMs: 6_000,
      },
    ],
  };
}

describe('AudioTranscript', () => {
  it('keeps cue timing and exposes partial translations without inventing rows', () => {
    expect(resolveAudioTranscriptRows(snapshot())).toEqual([
      {
        id: 'cue-1',
        startSeconds: 0,
        endSeconds: 1,
        sourceText: 'Hello.',
        translatedText: '你好。',
      },
      {
        id: 'cue-2',
        startSeconds: 1,
        endSeconds: 2,
        sourceText: 'Welcome.',
        translatedText: undefined,
      },
    ]);
  });

  it('renders bilingual progress and marks the cue at the real playback time', () => {
    const markup = renderToStaticMarkup(
      <AudioTranscript
        snapshot={snapshot()}
        mode="bilingual"
        currentTime={1.2}
        onSeek={vi.fn()}
      />,
    );

    expect(markup).toContain('Hello.');
    expect(markup).toContain('你好。');
    expect(markup).toContain('Welcome.');
    expect(markup).toContain('正在翻译…');
    expect(markup).toContain('aria-current="true"');
  });

  it('projects a stable per-speaker reference and marks uncertain cue ownership', () => {
    const rows = resolveAudioTranscriptRows(snapshot(), speakerTrack());
    expect(rows.map(({ speaker }) => speaker)).toEqual([
      {
        id: 'speaker-0001',
        label: '说话人 1',
        status: 'stable',
        referenceMode: 'reference',
        referenceStartSeconds: 0,
        referenceEndSeconds: 6,
      },
      {
        id: 'speaker-0001',
        label: '说话人 1',
        status: 'uncertain',
        referenceMode: 'reference',
        referenceStartSeconds: 0,
        referenceEndSeconds: 6,
      },
    ]);

    const markup = renderToStaticMarkup(
      <AudioTranscript
        snapshot={snapshot()}
        mode="source"
        currentTime={1.2}
        speakerTrack={speakerTrack()}
        onSeek={vi.fn()}
      />,
    );
    expect(markup).toContain('说话人 1');
    expect(markup).toContain('参考 0:00–0:06');
    expect(markup).toContain('说话人 1 ?');
    expect(markup).toContain('不会用作声色参考候选');
  });

  it('locates the active cue, the next cue in a gap and the last cue after the track', () => {
    const rows = [
      {
        id: 'cue-1',
        startSeconds: 1,
        endSeconds: 2,
        sourceText: 'One',
      },
      {
        id: 'cue-2',
        startSeconds: 4,
        endSeconds: 5,
        sourceText: 'Two',
      },
    ];
    expect(resolveAudioTranscriptPosition(rows, 1.5)).toEqual({
      activeRowId: 'cue-1',
      locateRowId: 'cue-1',
    });
    expect(resolveAudioTranscriptPosition(rows, 3)).toEqual({
      locateRowId: 'cue-2',
    });
    expect(resolveAudioTranscriptPosition(rows, 6)).toEqual({
      locateRowId: 'cue-2',
    });
  });

  it('does not expose transcript text while subtitles are off', () => {
    const markup = renderToStaticMarkup(
      <AudioTranscript
        snapshot={snapshot()}
        mode="off"
        currentTime={0}
        onSeek={vi.fn()}
      />,
    );

    expect(markup).toContain('字幕已关闭');
    expect(markup).not.toContain('Hello.');
  });

  it('explains why translation is unavailable without hiding source cues', () => {
    const unsupportedSnapshot: AudioSubtitleSnapshot = {
      ...snapshot(),
      phase: 'unsupported-language',
      source: {
        ...snapshot().source!,
        language: 'unknown',
      },
      message: '未检测到明确的中文或英文，本次只显示原文。',
    };
    const markup = renderToStaticMarkup(
      <AudioTranscript
        snapshot={unsupportedSnapshot}
        mode="source"
        currentTime={0}
        onSeek={vi.fn()}
      />,
    );

    expect(markup).toContain('未检测到明确的中文或英文');
    expect(markup).toContain('Hello.');
  });
});

describe('AudioTranscript current cue following', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let originalScrollIntoView: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    scrollIntoView = vi.fn();
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('scrolls only when the cue changes and lets manual browsing pause follow', () => {
    const onSeek = vi.fn();
    const render = (currentTime: number) => {
      act(() =>
        root.render(
          <AudioTranscript
            snapshot={snapshot()}
            mode="source"
            currentTime={currentTime}
            onSeek={onSeek}
          />,
        ),
      );
    };

    render(0.2);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    render(0.8);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const transcript = container.querySelector('[aria-label="音频逐句字幕"]');
    act(() =>
      transcript?.dispatchEvent(new WheelEvent('wheel', { bubbles: true })),
    );
    expect(container.textContent).toContain('定位当前句');

    render(1.2);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '定位当前句')
        ?.click(),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.instances.at(-1)?.textContent).toContain(
      'Welcome.',
    );

    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Hello.'))
        ?.click(),
    );
    expect(onSeek).toHaveBeenCalledWith(0);
  });
});
