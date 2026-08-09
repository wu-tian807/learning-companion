import { describe, expect, it } from 'vitest';

import {
  normalizeCodexResponsesBaseUrl,
  resolveCodexResponsesEndpointUrl,
} from './codex-responses-url';

describe('Codex Responses URLs', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/responses'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1/responses'],
    [
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses',
    ],
    [
      'https://api.openai.com/v1/RESPONSES/',
      'https://api.openai.com/v1/RESPONSES',
    ],
  ])('resolves %s to the concrete Responses endpoint', (input, expected) => {
    expect(resolveCodexResponsesEndpointUrl(input)).toBe(expected);
  });

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
  ])('normalizes %s to the Codex model provider root', (input, expected) => {
    expect(normalizeCodexResponsesBaseUrl(input)).toBe(expected);
  });
});
