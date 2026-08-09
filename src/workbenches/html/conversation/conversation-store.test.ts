import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchCommand } from '../../../shared/workbench/protocol';
import {
  createHtmlConversationStore,
  type HtmlConversationStoreOptions,
} from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';

const validEntry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  anchor: Object.freeze({ exact: '自注意力机制' }),
  question: '什么是自注意力？',
  answer: '自注意力允许任意两个位置直接交互。',
  createdTime: 1_720_000_000_000,
});

function createStore(handler: (command: WorkbenchCommand) => unknown) {
  const executeCommand = vi.fn(async (command: WorkbenchCommand) => ({
    payload: handler(command),
  }));
  const options: HtmlConversationStoreOptions = { executeCommand };
  const store = createHtmlConversationStore(options);

  return { store, executeCommand };
}

describe('createHtmlConversationStore', () => {
  it('lists entries through the list command', async () => {
    const { store, executeCommand } = createStore(() => ({
      entries: [validEntry],
    }));

    const entries = await store.list();

    expect(entries).toEqual([validEntry]);
    expect(executeCommand).toHaveBeenCalledWith({
      type: 'html.conversations.list',
    });
  });

  it('appends an entry through the append command', async () => {
    const { store, executeCommand } = createStore(() => ({
      entries: [validEntry],
    }));

    const entries = await store.append(validEntry);

    expect(entries).toEqual([validEntry]);
    expect(executeCommand).toHaveBeenCalledWith({
      type: 'html.conversations.append',
      payload: { entry: validEntry },
    });
  });

  it('rejects an invalid list payload', async () => {
    const { store } = createStore(() => ({ entries: [{ id: '' }] }));

    await expect(store.list()).rejects.toThrow();
  });

  it('rejects a non-array payload', async () => {
    const { store } = createStore(() => 'not-an-object');

    await expect(store.list()).rejects.toThrow();
  });

  it('propagates command rejection', async () => {
    const { store } = createStore(() => {
      throw new Error('命令失败');
    });

    await expect(store.list()).rejects.toThrow('命令失败');
  });
});
