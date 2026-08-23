import { describe, expect, it } from 'vitest';

import type {
  SubtitleSourceTrackV1,
  SubtitleTranslationTrackV1,
} from '../../media-subtitles/contracts';
import {
  createVideoSubtitleConversationContext,
  selectVideoSubtitleContextCues,
} from './video-subtitle-conversation-context';

const source: SubtitleSourceTrackV1 = {
  version: 1,
  kind: 'subtitle-source',
  sourceRevision: 'video-hash',
  language: 'en',
  origin: 'asr',
  engine: {
    id: 'whisper',
    version: '1',
    model: 'large-v3-turbo',
    backend: 'cuda',
  },
  generatedTime: 1,
  cues: Array.from({ length: 8 }, (_, index) => ({
    id: `cue-${index}`,
    startMs: index * 2_000,
    endMs: index * 2_000 + 1_500,
    text: `source ${index}`,
    sourceCueIds: [`raw-${index}`],
  })),
};

const translation: SubtitleTranslationTrackV1 = {
  version: 1,
  kind: 'subtitle-translation',
  sourceTrackRevision: 'track-hash',
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  profile: 'quality',
  engine: {
    id: 'hymt',
    version: '1',
    model: 'hymt',
    backend: 'llama.cpp',
  },
  generatedTime: 2,
  cues: source.cues.map((cue, index) => ({
    sourceCueId: cue.id,
    text: `译文 ${index}`,
  })),
};

describe('video subtitle conversation context', () => {
  it('selects at most five real cues around the exact frame time', () => {
    expect(
      selectVideoSubtitleContextCues(source.cues, 7.25).map(({ id }) => id),
    ).toEqual(['cue-1', 'cue-2', 'cue-3', 'cue-4', 'cue-5']);
    expect(
      selectVideoSubtitleContextCues(source.cues, 0.25).map(({ id }) => id),
    ).toEqual(['cue-0', 'cue-1', 'cue-2', 'cue-3', 'cue-4']);
    expect(
      selectVideoSubtitleContextCues(source.cues, 14.25).map(({ id }) => id),
    ).toEqual(['cue-3', 'cue-4', 'cue-5', 'cue-6', 'cue-7']);
  });

  it('does not attach a distant subtitle cue to an unrelated frame', () => {
    expect(selectVideoSubtitleContextCues(source.cues, 60)).toEqual([]);
    expect(
      createVideoSubtitleConversationContext(source, translation, 60),
    ).toBeUndefined();
  });

  it('keeps real cue timestamps and includes both original and translation', () => {
    const value = createVideoSubtitleConversationContext(
      source,
      translation,
      7.25,
    );
    expect(value).toContain('[00:02.000–00:03.500]');
    expect(value).toContain('原文（英文）：source 1');
    expect(value).toContain('译文（简体中文）：译文 1');
    expect(value).toContain('转写和翻译可能有误');
  });

  it('includes source-only cues without pretending a translation exists', () => {
    const value = createVideoSubtitleConversationContext(
      source,
      undefined,
      0.25,
    );
    expect(value).toContain('原文（英文）：source 0');
    expect(value).not.toContain('译文（');
  });
});
