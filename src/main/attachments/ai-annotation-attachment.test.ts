import { describe, expect, it } from 'vitest';

import {
  isAiAnnotationMetadata,
} from './ai-annotation-attachment';

const metadata = (selectedAnswer: string) => ({
  question: '这个公式是什么意思？',
  answer: '回答',
  selectedAnswer,
  timestamp: 1,
});

describe('AI annotation attachment metadata', () => {
  it('accepts long selected answer content without truncation', () => {
    expect(isAiAnnotationMetadata(metadata('字'.repeat(100)))).toBe(true);
    expect(isAiAnnotationMetadata(metadata('字'.repeat(10_000)))).toBe(true);
  });
});
