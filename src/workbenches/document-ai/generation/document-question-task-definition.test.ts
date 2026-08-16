import { describe, expect, it, vi } from 'vitest';

import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';
import { DocumentQuestionInstruction, documentQuestionInstructionFactory } from './document-question-instruction';
import {
  createDocumentQuestionTaskDefinitionV1,
  DOCUMENT_QUESTION_SYSTEM_INSTRUCTION_V1,
} from './document-question-task-definition';

describe('DocumentQuestion generation contract', () => {
  it('round-trips page and region targets through the instruction snapshot', () => {
    const instruction = new DocumentQuestionInstruction({
      conversationId: 'conversation-1',
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

  it('uses the Workbench selector, preserves the conversation session, and requests PDF support for materialized PDFs', async () => {
    const definition = createDocumentQuestionTaskDefinitionV1();
    const call = vi.fn(async () => ({
      callKey: 'answer',
      purpose: 'document-question',
      sessionId: 'session',
      assistantOutput: '这是最终回答。',
      metrics: {
        providerId: 'codex', connectionId: 'account', modelId: 'gpt-test',
        startedTime: 1, completedTime: 2, activeDurationMs: 1,
      },
    }));
    expect(definition.providerSelectorId).toBe(WORKBENCH_AGENT_PROVIDER_SELECTOR_ID);
    expect(definition.primaryWorkspaceConfig.resolveInstanceKey?.({
      taskId: 'task-1',
      instruction: new DocumentQuestionInstruction({
        conversationId: 'conversation-1',
        question: '为什么？',
        target: { scope: 'asset' },
      }).toSnapshot(),
    })).toBe('conversation-1');
    const preparedUserMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '为什么？' }],
    };
    await expect(
      definition.process({
        agent: { call },
        assetReferences: {
          document: [{
            alias: 'document',
            assetId: 'asset',
            name: 'slides.pptx',
            mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            materializedMediaType: 'application/pdf',
            contentRevision: 'revision',
            relativePath: 'references/document/slides.pdf',
          }],
        },
        preparedUserMessage,
      } as never),
    ).resolves.toEqual({
      answer: '这是最终回答。', providerId: 'codex', modelId: 'gpt-test',
    });
    expect(call).toHaveBeenCalledWith({
      callKey: 'answer',
      purpose: 'document-question',
      systemInstruction: DOCUMENT_QUESTION_SYSTEM_INSTRUCTION_V1,
      userMessage: preparedUserMessage,
      toolRequirements: [
        { id: 'workspace_read_pdf', availability: 'required' },
      ],
      skills: [],
      mcpServers: [],
    });
  });

  it.each([
    ['plain text', 'text/plain', 'notes.txt'],
    ['Markdown', 'text/markdown', 'notes.md'],
  ])('does not request a media tool for %s', async (_label, mediaType, name) => {
    const definition = createDocumentQuestionTaskDefinitionV1();
    const call = vi.fn(async () => ({
      callKey: 'answer',
      purpose: 'document-question',
      sessionId: 'session',
      assistantOutput: '回答',
      metrics: {
        providerId: 'codex', connectionId: 'account', modelId: 'gpt-test',
        startedTime: 1, completedTime: 2, activeDurationMs: 1,
      },
    }));

    await definition.process({
      agent: { call },
      assetReferences: {
        document: [{
          alias: 'document',
          assetId: 'asset',
          name,
          mediaType,
          contentRevision: 'revision',
          relativePath: `references/document/${name}`,
        }],
      },
      preparedUserMessage: {
        role: 'user',
        content: [{ type: 'text', text: '解释它' }],
      },
    } as never);

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ toolRequirements: [] }),
    );
  });

  it('does not redundantly declare the Provider-native image tool', async () => {
    const definition = createDocumentQuestionTaskDefinitionV1();
    const call = vi.fn(async () => ({
      callKey: 'answer',
      purpose: 'document-question',
      sessionId: 'session',
      assistantOutput: '回答',
      metrics: {
        providerId: 'codex', connectionId: 'account', modelId: 'gpt-test',
        startedTime: 1, completedTime: 2, activeDurationMs: 1,
      },
    }));

    await definition.process({
      agent: { call },
      assetReferences: {
        document: [{
          alias: 'document',
          assetId: 'asset',
          name: 'diagram.png',
          mediaType: 'image/png',
          contentRevision: 'revision',
          relativePath: 'references/document/diagram.png',
        }],
      },
      preparedUserMessage: {
        role: 'user',
        content: [{ type: 'text', text: '解释它' }],
      },
    } as never);

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        toolRequirements: [],
      }),
    );
  });

  it('extracts an AI-generated conversation title without leaking its marker into the answer', async () => {
    const definition = createDocumentQuestionTaskDefinitionV1();
    const call = vi.fn(async () => ({
      callKey: 'answer',
      purpose: 'document-question',
      sessionId: 'session',
      assistantOutput: '<conversation-title>Softmax 权重归一化</conversation-title>\n权重总和为 1。',
      metrics: {
        providerId: 'codex', connectionId: 'account', modelId: 'gpt-test',
        startedTime: 1, completedTime: 2, activeDurationMs: 1,
      },
    }));

    await expect(definition.process({
      agent: { call },
      assetReferences: {
        document: [{
          alias: 'document',
          assetId: 'asset',
          name: 'document.pdf',
          mediaType: 'application/pdf',
          contentRevision: 'revision',
          relativePath: 'references/document/document.pdf',
        }],
      },
      preparedUserMessage: {
        role: 'user',
        content: [{ type: 'text', text: '解释它' }],
      },
    } as never)).resolves.toEqual({
      title: 'Softmax 权重归一化',
      answer: '权重总和为 1。',
      providerId: 'codex',
      modelId: 'gpt-test',
    });
  });
});
