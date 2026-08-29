import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  AudioTranscript,
  resolveAudioTranscriptRows,
} from './audio-transcript';
import type { AudioSubtitleSnapshot } from './shared';

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
