import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_PROVIDER_SELECTOR_DEFINITIONS } from './create-agent-provider-service';

describe('default Provider Selector registration', () => {
  it('declares high, medium and low intelligence defaults', () => {
    expect(DEFAULT_AGENT_PROVIDER_SELECTOR_DEFINITIONS).toEqual([
      expect.objectContaining({
        id: 'intelligence-high',
        defaultSelection: expect.objectContaining({
          modelId: 'gpt-5.6-sol',
          reasoningEffort: 'high',
        }),
      }),
      expect.objectContaining({
        id: 'intelligence-medium',
        defaultSelection: expect.objectContaining({
          modelId: 'gpt-5.6-terra',
          reasoningEffort: 'medium',
        }),
      }),
      expect.objectContaining({
        id: 'intelligence-low',
        defaultSelection: expect.objectContaining({
          modelId: 'gpt-5.6-luna',
          reasoningEffort: 'low',
        }),
      }),
    ]);
  });
});
