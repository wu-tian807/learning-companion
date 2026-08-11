import { describe, expect, it } from 'vitest';

import { isAiAnnotationMetadata } from './ai-annotation-attachment';

const metadata = (questionPreview: string) => ({
  contentFormat: 'ai-annotation-v1' as const,
  questionPreview,
  timestamp: 1,
});

describe('AI annotation attachment metadata', () => {
  it('keeps only a bounded preview in metadata', () => {
    expect(isAiAnnotationMetadata(metadata('问题预览'))).toBe(true);
    expect(isAiAnnotationMetadata(metadata('字'.repeat(201)))).toBe(false);
    expect(isAiAnnotationMetadata({ ...metadata('问题'), answer: '正文' })).toBe(false);
  });
});
