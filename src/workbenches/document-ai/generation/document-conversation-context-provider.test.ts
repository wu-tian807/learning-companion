import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import {
  createDocumentConversationContext,
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
} from '../document-conversation-context';
import {
  DocumentConversationContextProvider,
  DOCUMENT_MAX_IMAGE_BYTES,
} from './document-conversation-context-provider';

const workspacePath = resolve('workspace');

function instruction(selection?: ReturnType<
  typeof createDocumentConversationContext
>) {
  return new WorkbenchConversationInstruction({
    contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
    assetId: 'asset-1',
    conversationId: 'conversation-1',
    question: '图片里写了什么？',
    ...(selection ? { context: selection } : {}),
  });
}

function context(input: {
  readonly selection?: ReturnType<
    typeof createDocumentConversationContext
  >;
  readonly alias?: string;
} = {}) {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    instruction: instruction(input.selection),
    workspaces: {
      primary: { path: workspacePath },
      secondary: [],
    },
    assetReferences: {
      source: [
        {
          assetId: 'asset-1',
          alias: input.alias ?? 'source-0001',
          relativePath: 'sources-0001/source.md',
          contentRevision: 'revision-1',
        },
      ],
    },
    signal: undefined,
    reportStatus: vi.fn(),
  } as never;
}

describe('DocumentConversationContextProvider image questions', () => {
  it('copies the Markdown image into the workspace and sends it as local-image', async () => {
    const png = Buffer.from('png-bytes', 'utf8');
    const provider = new DocumentConversationContextProvider(
      {
        resolveContent: vi.fn(async () => ({
          location: {
            kind: 'local-file',
            absolutePath: resolve('notes', 'notes.md'),
          },
        })),
      } as never,
      {
        readFile: vi.fn(async () => png),
        writeFile: vi.fn(async () => undefined),
      },
    );
    const selection = createDocumentConversationContext({
      target: { scope: 'asset' },
      image: { relativePath: 'images/shot.png' },
    });

    const prepared = await provider.prepare(context({ selection }));

    expect(prepared.statusMessage).toBe('正在准备 Markdown 中的图片…');
    expect(
      (prepared.userMessage as { content: readonly unknown[] })
        .content,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'local-image',
          path: resolve(
            workspacePath,
            'references',
            'source-0001',
            'question-image.png',
          ),
        }),
      ]),
    );
    expect(prepared.systemInstruction).toContain(
      'accompanying image is authoritative',
    );
  });

  it('rejects unsafe relative image paths', async () => {
    const provider = new DocumentConversationContextProvider(
      {
        resolveContent: vi.fn(async () => ({
          location: {
            kind: 'local-file',
            absolutePath: resolve('notes', 'notes.md'),
          },
        })),
      } as never,
    );
    const selection = createDocumentConversationContext({
      target: { scope: 'asset' },
      image: { relativePath: '../outside.png' },
    });

    await expect(
      provider.prepare(context({ selection })),
    ).rejects.toThrow();
  });

  it('rejects images that exceed the byte limit', async () => {
    const oversized = Buffer.alloc(DOCUMENT_MAX_IMAGE_BYTES + 1);
    const provider = new DocumentConversationContextProvider(
      {
        resolveContent: vi.fn(async () => ({
          location: {
            kind: 'local-file',
            absolutePath: resolve('notes', 'notes.md'),
          },
        })),
      } as never,
      {
        readFile: vi.fn(async () => oversized),
        writeFile: vi.fn(async () => undefined),
      },
    );
    const selection = createDocumentConversationContext({
      target: { scope: 'asset' },
      image: { relativePath: 'images/huge.png' },
    });

    await expect(
      provider.prepare(context({ selection })),
    ).rejects.toThrow();
  });
});
