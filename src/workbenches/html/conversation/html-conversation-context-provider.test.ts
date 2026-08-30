import { describe, expect, it, vi } from 'vitest';

import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import { createHtmlDomTarget } from '../shared';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './html-conversation-context';
import { HtmlConversationContextProvider } from './html-conversation-context-provider';

function context(
  anchor = createHtmlDomTarget({
    frameUrl: 'learning-content://resource/token',
    element: {
      path: [1, 0],
      tagName: 'p',
      textQuote: '公式：$x^2 + y^2 = z^2$',
    },
  }),
) {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '解释这个公式。',
      context: anchor,
    }),
    assetReferences: {
      source: [
        {
          assetId: 'asset-1',
          relativePath: 'materials/lesson.html',
        },
      ],
    },
    signal: undefined,
    reportStatus: vi.fn(),
  } as never;
}

describe('HTML conversation context provider', () => {
  it('passes the formula-source DOM quote to the Agent', async () => {
    const prepared = await new HtmlConversationContextProvider().prepare(
      context(),
    );
    const message = prepared.userMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

    expect(message).toContain('公式：$x^2 + y^2 = z^2$');
    expect(message).not.toContain('x2x^2');
    expect(prepared.toolRequirements).toEqual([]);
  });

  it('rejects a source Asset that does not own the conversation context', async () => {
    const invalid = context() as unknown as {
      assetReferences: {
        source: Array<{ assetId: string; relativePath: string }>;
      };
    };
    invalid.assetReferences.source[0]!.assetId = 'asset-2';

    await expect(
      new HtmlConversationContextProvider().prepare(invalid as never),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('declares HTML editing tools and the trusted DOM target only when editable', async () => {
    const editable = { canEdit: vi.fn(async () => true) };
    const prepared = await new HtmlConversationContextProvider(
      () => editable,
    ).prepare(context());
    const message = prepared.userMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

    expect(editable.canEdit).toHaveBeenCalledWith('project-1', 'asset-1');
    expect(prepared.toolRequirements).toEqual([
      { id: 'html_begin_edit', availability: 'required' },
      { id: 'html_replace_edit', availability: 'required' },
    ]);
    expect(prepared.systemInstruction).toContain('html_begin_edit');
    expect(message).toContain('"anchorType":"html.dom"');

    const readOnly = await new HtmlConversationContextProvider(() => ({
      canEdit: vi.fn(async () => false),
    })).prepare(context());
    expect(readOnly.toolRequirements).toEqual([]);
  });
});
