import { describe, expect, it } from 'vitest';

import { normalizeCodexResponsesBaseUrl } from './codex-responses-url';

describe('Codex Responses URLs', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    [
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1',
    ],
    [
      'https://api.openai.com/v1/RESPONSES/',
      'https://api.openai.com/v1',
    ],
    ['https://api.deepseek.com', 'https://api.deepseek.com'],
    ['https://api.deepseek.com/', 'https://api.deepseek.com'],
    [
      'https://api.deepseek.com/responses',
      'https://api.deepseek.com',
    ],
  ])('normalizes %s to the Codex model provider root', (input, expected) => {
    expect(normalizeCodexResponsesBaseUrl(input)).toBe(expected);
  });
});
