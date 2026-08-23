import { describe, expect, it, vi } from 'vitest';

import { WorkbenchConversationInstruction } from '../../../../main/conversation/workbench-conversation-instruction';
import { createEpubCfiRangeTarget } from '../../shared';
import { createEpubConversationContext } from '../epub-conversation-context';
import { EpubConversationContextProvider } from './epub-conversation-context-provider';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
  quote: {
    exact: '需要解释的文字',
    prefix: '前面的内容',
    suffix: '后面的内容',
  },
});

function context(commitAnswer = true) {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: 'epub.context',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '请解释这段话。',
      context: createEpubConversationContext(target),
      commitAnswer,
    }),
    signal: undefined,
    reportStatus: vi.fn(),
  } as never;
}

describe('EPUB conversation context provider', () => {
  it('turns the exact CFI quote and nearby text into Agent input', async () => {
    const provider = new EpubConversationContextProvider({} as never);
    const prepared = await provider.prepare(context(false));
    const text = prepared.userMessage.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');

    expect(prepared.purpose).toBe('epub-reading-conversation');
    expect(text).toContain('<selection>\n需要解释的文字\n</selection>');
    expect(text).toContain('<context-before>\n前面的内容');
    expect(prepared.toolRequirements).toEqual([]);
  });

  it('creates one Attachment after a valid answer and reuses it on replay', async () => {
    const createWithContent = vi.fn(async () => ({ id: 'attachment-1' }));
    const attachments = {
      listByAsset: vi.fn(async () => []),
      createWithContent,
    };
    const provider = new EpubConversationContextProvider(attachments as never);

    await expect(
      provider.commitAnswer!(context(), { answer: '解释正文' } as never),
    ).resolves.toEqual({ attachmentId: 'attachment-1' });
    expect(createWithContent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        assetId: 'asset-1',
        target,
        content: {
          fileName: 'answer.md',
          mediaType: 'text/markdown',
          data: '解释正文\n',
        },
      }),
    );

    attachments.listByAsset.mockResolvedValueOnce([
      {
        id: 'attachment-existing',
        typeId: 'epub.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/epub-explanation',
          version: 1,
        },
        content: { mediaType: 'text/markdown' },
      },
    ] as never);
    await expect(
      provider.commitAnswer!(context(), { answer: '重复执行' } as never),
    ).resolves.toEqual({ attachmentId: 'attachment-existing' });
    expect(createWithContent).toHaveBeenCalledTimes(1);
  });
});
