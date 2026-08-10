import { describe, expect, it, vi } from 'vitest';

import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';
import { DocumentQuestionInstruction, documentQuestionInstructionFactory } from './document-question-instruction';
import { createDocumentQuestionTaskDefinitionV1 } from './document-question-task-definition';

describe('DocumentQuestion generation contract', () => {
  it('round-trips page and region targets through the instruction snapshot', () => {
    const instruction = new DocumentQuestionInstruction({
      question: '解释这个公式',
      target: {
        scope: 'content',
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 3, x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      },
    });
    const parsed = documentQuestionInstructionFactory.parse(instruction.toSnapshot());
    expect(parsed).toMatchObject({ ok: true });
    expect(instruction.toUserMessage({
      assetReferences: {
        document: [{
          alias: 'document',
          assetId: 'asset',
          name: 'file.pdf',
          mediaType: 'application/pdf',
          contentRevision: 'revision',
          relativePath: 'references/document/file.pdf',
        }],
      },
    } as never).content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('references/document/file.pdf'),
    });
  });

  it('uses Generation Center and returns the persisted final assistant output', async () => {
    const definition = createDocumentQuestionTaskDefinitionV1();
    const call = vi.fn(async () => ({
      callKey: 'answer',
      purpose: 'document-question',
      sessionId: 'session',
      assistantText: '这是最终回答。',
      metrics: {
        providerId: 'codex', connectionId: 'account', modelId: 'gpt-test',
        startedTime: 1, completedTime: 2, activeDurationMs: 1,
      },
    }));
    expect(definition.providerSelectorId).toBe(GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID);
    await expect(definition.process({ agent: { call } } as never)).resolves.toEqual({
      answer: '这是最终回答。', providerId: 'codex', modelId: 'gpt-test',
    });
    expect(call).toHaveBeenCalledWith({ callKey: 'answer', purpose: 'document-question' });
  });
});
