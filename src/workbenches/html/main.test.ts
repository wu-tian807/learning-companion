import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchStateDataDatabaseApi } from '../../main/workbench/workbench-state-data-database';
import type {
  WorkbenchCommand,
} from '../../shared/workbench/protocol';
import {
  HTML_CONVERSATION_DATA_KEY,
  type HtmlConversationEntry,
} from './conversation/conversation-protocol';
import { HtmlWorkbenchProvider } from './main';
import { htmlConversationCommands, htmlWorkbenchManifest } from './shared';

type ProviderCommandContext = Parameters<HtmlWorkbenchProvider['command']>[0];
type ProviderOpenContext = Parameters<HtmlWorkbenchProvider['open']>[0];

const validEntry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  messages: Object.freeze([
    Object.freeze({ role: 'user', text: '什么是自注意力？' }),
    Object.freeze({
      role: 'assistant',
      text: '自注意力允许任意两个位置直接交互。',
      anchor: Object.freeze({ exact: '自注意力机制' }),
    }),
  ]),
  createdTime: 1_720_000_000_000,
  updatedTime: 1_720_000_000_100,
});

function encode(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

function createFakeStateDatabase(
  initial: Uint8Array | undefined,
): WorkbenchStateDataDatabaseApi & { readonly saved: Array<unknown> } {
  const saved: Array<unknown> = [];
  let current = initial;

  return {
    saved,
    async get() {
      return current
        ? {
            assetId: 'asset-1',
            workbenchId: htmlWorkbenchManifest.id,
            dataKey: HTML_CONVERSATION_DATA_KEY,
            data: current,
            updatedTime: 0,
          }
        : undefined;
    },
    async save(record) {
      current = record.data;
      saved.push(record);
    },
    async delete() {
      current = undefined;
    },
  };
}

async function createProvider(stateDatabase?: WorkbenchStateDataDatabaseApi) {
  const provider = new HtmlWorkbenchProvider(
    {
      register: vi.fn(() => 'learning-content://resource/token'),
      revokeSession: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    },
    stateDatabase ?? createFakeStateDatabase(undefined),
  );
  // 注册 session（open 成功后 sessions 才会包含该 sessionId）
  await provider.open({
    sessionId: 'session-1',
    asset: { id: 'asset-1', mediaType: 'text/html' },
    selectionReason: 'matched',
    content: {
      handle: {
        capabilities: new Set(['read-stream']),
        openByteStream: vi.fn(),
      },
    },
    attachments: [],
    state: undefined,
  } as unknown as ProviderOpenContext);
  const context = {
    sessionId: 'session-1',
    asset: { id: 'asset-1' },
  } as ProviderCommandContext;

  return { provider, context };
}

describe('HtmlWorkbenchProvider conversations', () => {
  it('lists an empty index when nothing is stored', async () => {
    const { provider, context } = await createProvider();

    const result = await provider.command(context, {
      type: htmlConversationCommands.list,
    });

    expect(result.payload).toEqual({ entries: [] });
  });

  it('lists stored entries', async () => {
    const stored = encode({
      format: 'learning-companion/html-conversation-index',
      version: 2,
      entries: [validEntry],
    });
    const { provider, context } = await createProvider(
      createFakeStateDatabase(stored),
    );

    const result = await provider.command(context, {
      type: htmlConversationCommands.list,
    });

    expect(result.payload).toEqual({ entries: [validEntry] });
  });

  it('saves an entry and persists it', async () => {
    const state = createFakeStateDatabase(undefined);
    const { provider, context } = await createProvider(state);

    const result = await provider.command(context, {
      type: htmlConversationCommands.save,
      payload: { entry: validEntry },
    });

    expect(result.payload).toEqual({ entries: [validEntry] });
    expect(state.saved).toHaveLength(1);
    const second = await provider.command(context, {
      type: htmlConversationCommands.list,
    });
    expect(second.payload).toEqual({ entries: [validEntry] });
  });

  it('updates an existing conversation by id without duplicating it', async () => {
    const state = createFakeStateDatabase(
      encode({
        format: 'learning-companion/html-conversation-index',
        version: 2,
        entries: [validEntry],
      }),
    );
    const { provider, context } = await createProvider(state);
    const continued: HtmlConversationEntry = {
      ...validEntry,
      messages: [
        ...validEntry.messages,
        { role: 'user', text: '能再举个例子吗？' },
        { role: 'assistant', text: '当然可以。' },
      ],
      updatedTime: validEntry.updatedTime + 1,
    };

    const result = await provider.command(context, {
      type: htmlConversationCommands.save,
      payload: { entry: continued },
    });

    expect(result.payload).toEqual({ entries: [continued] });
    expect(state.saved).toHaveLength(1);
  });

  it('migrates legacy v1 question/answer history when listing', async () => {
    const legacyAnchor = { exact: '旧锚点' };
    const { provider, context } = await createProvider(
      createFakeStateDatabase(
        encode({
          format: 'learning-companion/html-conversation-index',
          version: 1,
          entries: [
            {
              id: 'legacy-1',
              anchor: legacyAnchor,
              question: '旧问题',
              answer: '旧回答',
              createdTime: 100,
            },
          ],
        }),
      ),
    );

    await expect(
      provider.command(context, { type: htmlConversationCommands.list }),
    ).resolves.toEqual({
      payload: {
        entries: [
          {
            id: 'legacy-1',
            messages: [
              { role: 'user', text: '旧问题', anchor: legacyAnchor },
              { role: 'assistant', text: '旧回答' },
            ],
            createdTime: 100,
            updatedTime: 100,
          },
        ],
      },
    });
  });

  it('removes an entry and persists the remaining index', async () => {
    const state = createFakeStateDatabase(
      encode({
        format: 'learning-companion/html-conversation-index',
        version: 2,
        entries: [validEntry],
      }),
    );
    const { provider, context } = await createProvider(state);

    const result = await provider.command(context, {
      type: htmlConversationCommands.remove,
      payload: { entryId: validEntry.id },
    });

    expect(result.payload).toEqual({ entries: [] });
    expect(state.saved).toHaveLength(1);
  });

  it('rejects invalid save payload', async () => {
    const { provider, context } = await createProvider();

    await expect(
      provider.command(context, {
        type: htmlConversationCommands.save,
        payload: { entry: { id: '' } },
      }),
    ).rejects.toThrow();
  });

  it('recovers from corrupted stored data as empty index', async () => {
    const { provider, context } = await createProvider(
      createFakeStateDatabase(new TextEncoder().encode('not-json')),
    );

    const result = await provider.command(context, {
      type: htmlConversationCommands.list,
    });

    expect(result.payload).toEqual({ entries: [] });
  });

  it('rejects unknown commands and expired sessions', async () => {
    const { provider, context } = await createProvider();

    await expect(
      provider.command(context, { type: 'unknown.command' } as WorkbenchCommand),
    ).rejects.toThrow();

    const expired = {
      sessionId: 'session-999',
      asset: { id: 'asset-1' },
    } as ProviderCommandContext;
    await expect(
      provider.command(expired, {
        type: htmlConversationCommands.list,
      }),
    ).rejects.toThrow();
  });
});
