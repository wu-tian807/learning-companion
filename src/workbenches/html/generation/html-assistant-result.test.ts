import { describe, expect, it } from 'vitest';

import { isHtmlAssistantTaskResult } from './html-assistant-result';

describe('isHtmlAssistantTaskResult', () => {
  it('accepts a non-empty authoritative answer', () => {
    expect(
      isHtmlAssistantTaskResult({
        answer: '最终回答',
      }),
    ).toBe(true);
  });

  it('rejects missing, empty, or malformed results', () => {
    expect(isHtmlAssistantTaskResult(undefined)).toBe(false);
    expect(
      isHtmlAssistantTaskResult({ answer: '' }),
    ).toBe(false);
    expect(isHtmlAssistantTaskResult({ answer: 42 })).toBe(false);
  });
});
