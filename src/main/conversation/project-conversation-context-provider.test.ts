import { describe, expect, it, vi } from 'vitest';

import type { PreparedGenerationAssetReferenceBindings } from '../generation/contracts/generation-asset-reference';
import { WorkbenchConversationInstruction } from './workbench-conversation-instruction';
import { ProjectConversationContextProvider } from './project-conversation-context-provider';

function context(
  overrides: Partial<{
    readonly assetId: string;
    readonly context: { readonly selected: string };
    readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  }> = {},
) {
  const { assetReferences = { source: [] }, ...instruction } = overrides;
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: 'builtin.project.conversation',
      conversationId: 'conversation-1',
      question: '请帮我复习',
      ...instruction,
    }),
    assetReferences,
    signal: undefined,
    reportStatus: vi.fn(),
  } as never;
}

describe('ProjectConversationContextProvider', () => {
  it('accepts the normalized empty AssetReference slot for a context-free Project turn', async () => {
    const prepared = await new ProjectConversationContextProvider().prepare(
      context(),
    );

    expect(prepared.purpose).toBe('project-conversation');
    expect(prepared.userMessage).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '用户问题：请帮我复习' }],
    });
    expect(prepared.toolRequirements).toEqual([]);
  });

  it('rejects hidden Asset or Workbench context on the global provider', async () => {
    const provider = new ProjectConversationContextProvider();

    await expect(provider.prepare(context({ assetId: 'asset-1' }))).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });
    await expect(
      provider.prepare(context({ context: { selected: 'text' } })),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    await expect(
      provider.prepare(
        context({
          assetReferences: {
            source: [
              {
                alias: 'source-0001',
                assetId: 'asset-1',
                name: 'source.txt',
                mediaType: 'text/plain',
                contentRevision: 'revision-1',
                relativePath: 'references/source-0001/source.txt',
              },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });
});
