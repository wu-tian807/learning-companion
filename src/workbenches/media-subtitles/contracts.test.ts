import { describe, expect, it } from 'vitest';

import {
  isSubtitleSourceTrackV1,
  isSubtitleTranslationTrackV1,
  oppositeSubtitleLanguage,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';

const source: SubtitleSourceTrackV1 = {
  version: 1,
  kind: 'subtitle-source',
  sourceRevision: 'video-revision',
  language: 'en',
  origin: 'asr',
  engine: {
    id: 'engine',
    version: '1',
    model: 'model',
    backend: 'cpu',
  },
  generatedTime: 100,
  cues: [
    {
      id: 'cue-1',
      startMs: 0,
      endMs: 900,
      text: 'Hello.',
      sourceCueIds: ['raw-1'],
    },
    {
      id: 'cue-2',
      startMs: 1_000,
      endMs: 1_900,
      text: 'World.',
      sourceCueIds: ['raw-2'],
    },
  ],
};

const translation: SubtitleTranslationTrackV1 = {
  version: 1,
  kind: 'subtitle-translation',
  sourceTrackRevision: 'artifact-revision',
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  profile: 'quality',
  engine: {
    id: 'engine',
    version: '1',
    model: 'model',
    backend: 'cpu',
  },
  generatedTime: 100,
  cues: [
    { sourceCueId: 'cue-1', text: '你好。' },
    { sourceCueId: 'cue-2', text: '世界。' },
  ],
};

describe('media subtitle contracts', () => {
  it('accepts complete ordered source and translation tracks', () => {
    expect(isSubtitleSourceTrackV1(source)).toBe(true);
    expect(isSubtitleTranslationTrackV1(translation)).toBe(true);
    expect(oppositeSubtitleLanguage('en')).toBe('zh-Hans');
    expect(oppositeSubtitleLanguage('zh-Hans')).toBe('en');
  });

  it('accepts chronological overlaps and rejects invalid order or identity', () => {
    expect(isSubtitleSourceTrackV1({
      ...source,
      cues: [{ ...source.cues[0], endMs: 0 }],
    })).toBe(false);
    expect(isSubtitleSourceTrackV1({
      ...source,
      cues: [source.cues[1], source.cues[0]],
    })).toBe(false);
    expect(isSubtitleSourceTrackV1({
      ...source,
      cues: [
        source.cues[0],
        { ...source.cues[1], startMs: 800 },
      ],
    })).toBe(true);
    expect(isSubtitleSourceTrackV1({
      ...source,
      cues: [source.cues[0], { ...source.cues[1], id: 'cue-1' }],
    })).toBe(false);
    expect(isSubtitleSourceTrackV1({
      ...source,
      cues: [
        source.cues[0],
        { ...source.cues[1], sourceCueIds: ['raw-1'] },
      ],
    })).toBe(false);
  });

  it('requires every speaker-aware cue to reference a known speaker', () => {
    const speakerAware = {
      ...source,
      speakerAnalysis: {
        method: 'joint-transcription-diarization' as const,
        supportsOverlappingTranscription: true,
        segments: [
          { speakerId: 'speaker-0001', startMs: 0, endMs: 1_900 },
        ],
      },
      cues: source.cues.map((cue) => ({
        ...cue,
        speakerId: 'speaker-0001',
      })),
    };

    expect(isSubtitleSourceTrackV1(speakerAware)).toBe(true);
    expect(
      isSubtitleSourceTrackV1({
        ...speakerAware,
        cues: [
          speakerAware.cues[0],
          { ...speakerAware.cues[1], speakerId: 'speaker-0002' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects same-language, empty, and duplicate translation cues', () => {
    expect(isSubtitleTranslationTrackV1({
      ...translation,
      targetLanguage: 'en',
    })).toBe(false);
    expect(isSubtitleTranslationTrackV1({
      ...translation,
      cues: [{ sourceCueId: 'cue-1', text: ' ' }],
    })).toBe(false);
    expect(isSubtitleTranslationTrackV1({
      ...translation,
      cues: [translation.cues[0], translation.cues[0]],
    })).toBe(false);
  });
});
