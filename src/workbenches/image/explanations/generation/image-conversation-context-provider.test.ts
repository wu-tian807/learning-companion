import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-input-preparer', () => ({
  prepareImageExplanationInputs: vi.fn(async () => ({
    overviewPath: 'C:\\workspace\\overview.png',
    markedOverviewPath: 'C:\\workspace\\marked.png',
    cropPath: 'C:\\workspace\\crop.png',
  })),
}));

import { WorkbenchConversationInstruction } from '../../../../main/conversation/workbench-conversation-instruction';
import { createImageRegionTarget } from '../../shared';
import { createImageConversationContext } from '../image-conversation-context';
import { prepareImageExplanationInputs } from './image-input-preparer';
import { ImageConversationContextProvider } from './image-conversation-context-provider';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

function context(input: {
  readonly revision?: string;
  readonly withSelection?: boolean;
} = {}) {
  const revision = input.revision ?? 'revision-1';
  const selection = input.withSelection === false
    ? undefined
    : createImageConversationContext(target, revision);
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: new WorkbenchConversationInstruction({
      contextProviderId: 'image.context',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '解释这里',
      ...(selection ? { context: selection } : {}),
      commitAnswer: selection !== undefined,
    }),
    workspaces: {
      primary: { path: 'C:\\workspace' },
      secondary: [],
    },
    assetReferences: {
      source: [
        {
          assetId: 'asset-1',
          relativePath: 'sources-0001/source.png',
          contentRevision: 'revision-1',
        },
      ],
    },
    signal: undefined,
    reportStatus: vi.fn(),
  } as never;
}

describe('Image conversation context provider', () => {
  beforeEach(() => {
    vi.mocked(prepareImageExplanationInputs).mockClear();
  });

  it('prepares overview, marked overview and crop only for a new region', async () => {
    const provider = new ImageConversationContextProvider({} as never);
    const prepared = await provider.prepare(context());

    expect(prepareImageExplanationInputs).toHaveBeenCalledWith(
      'C:\\workspace\\sources-0001\\source.png',
      target,
      'C:\\workspace',
    );
    expect(prepared.userMessage.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'local-image',
          path: 'C:\\workspace\\overview.png',
        }),
        expect.objectContaining({
          type: 'local-image',
          path: 'C:\\workspace\\marked.png',
        }),
        expect.objectContaining({
          type: 'local-image',
          path: 'C:\\workspace\\crop.png',
        }),
      ]),
    );

    await provider.prepare(context({ withSelection: false }));
    expect(prepareImageExplanationInputs).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale selection before preparing visual input', async () => {
    const provider = new ImageConversationContextProvider({} as never);
    await expect(
      provider.prepare(context({ revision: 'revision-2' })),
    ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
    expect(prepareImageExplanationInputs).not.toHaveBeenCalled();
  });

  it('creates one revision-bound Attachment and reuses it on replay', async () => {
    const createWithContent = vi.fn(async () => ({ id: 'attachment-1' }));
    const attachments = {
      listByAsset: vi.fn(async () => []),
      createWithContent,
    };
    const provider = new ImageConversationContextProvider(attachments as never);

    await expect(
      provider.commitAnswer!(context(), { answer: '图片解释' } as never),
    ).resolves.toEqual({ attachmentId: 'attachment-1' });
    expect(createWithContent).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        metadata: {
          format: 'learning-companion/image-explanation',
          version: 1,
          sourceRevision: 'revision-1',
        },
        content: expect.objectContaining({ data: '图片解释\n' }),
      }),
    );

    attachments.listByAsset.mockResolvedValueOnce([
      {
        id: 'attachment-existing',
        typeId: 'image.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/image-explanation',
          version: 1,
          sourceRevision: 'revision-1',
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
