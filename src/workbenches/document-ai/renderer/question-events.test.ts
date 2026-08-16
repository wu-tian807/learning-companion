import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_AI_QUESTION_COMMITTED_EVENT,
  notifyDocumentAiQuestionCommitted,
} from './question-events';

describe('document question committed event', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('notifies the active Workbench as soon as a question enters history', () => {
    const dispatchEvent = vi.fn();
    class TestCustomEvent {
      constructor(
        readonly type: string,
        readonly init: { readonly detail: { readonly assetId: string } },
      ) {}
    }
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', TestCustomEvent);

    notifyDocumentAiQuestionCommitted('asset-1');

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: DOCUMENT_AI_QUESTION_COMMITTED_EVENT,
      init: { detail: { assetId: 'asset-1' } },
    });
  });
});
