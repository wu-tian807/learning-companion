import { describe, expect, it } from 'vitest';

import {
  createHtmlConversationIndex,
  HTML_CONVERSATION_MAX_ENTRIES,
  isHtmlConversationEntry,
  isHtmlConversationIndex,
  normalizeHtmlConversationIndex,
  removeHtmlConversationEntry,
  saveHtmlConversationEntry,
  type HtmlConversationEntry,
  type HtmlConversationIndex,
} from './conversation-protocol';

const validEntry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  messages: Object.freeze([
    Object.freeze({
      role: 'user',
      text: '什么是自注意力？',
      anchor: Object.freeze({
        anchorType: 'html.quote',
        anchorPayload: Object.freeze({ exact: '自注意力' }),
      }),
    }),
    Object.freeze({
      role: 'assistant',
      text: '自注意力允许任意两个位置直接交互。',
    }),
  ]),
  createdTime: 1_720_000_000_000,
  updatedTime: 1_720_000_000_100,
});

function makeIndex(
  entries: readonly HtmlConversationEntry[] = [validEntry],
): HtmlConversationIndex {
  return {
    format: 'learning-companion/html-conversation-index',
    version: 2,
    entries: Object.freeze([...entries]),
  };
}

describe('isHtmlConversationEntry', () => {
  it('accepts a valid multi-turn entry', () => {
    expect(isHtmlConversationEntry(validEntry)).toBe(true);
  });

  it('rejects empty messages, invalid roles, times, and non-JSON anchors', () => {
    expect(isHtmlConversationEntry({ ...validEntry, messages: [] })).toBe(false);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [{ role: 'system', text: 'x' }],
      }),
    ).toBe(false);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        updatedTime: validEntry.createdTime - 1,
      }),
    ).toBe(false);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          { role: 'user', text: 'x', anchor: { invalid: () => undefined } },
        ],
      }),
    ).toBe(false);
  });
});

describe('normalizeHtmlConversationIndex', () => {
  it('accepts the current v2 format', () => {
    expect(normalizeHtmlConversationIndex(makeIndex())).toEqual(makeIndex());
  });

  it('migrates original v1 question/answer entries without losing anchors', () => {
    const migrated = normalizeHtmlConversationIndex({
      format: 'learning-companion/html-conversation-index',
      version: 1,
      entries: [
        {
          id: 'legacy-task',
          anchor: { anchorType: 'html.quote', anchorPayload: { exact: '旧锚点' } },
          question: '旧问题',
          answer: '旧回答',
          createdTime: 100,
        },
      ],
    });

    expect(migrated).toEqual({
      format: 'learning-companion/html-conversation-index',
      version: 2,
      entries: [
        {
          id: 'legacy-task',
          messages: [
            {
              role: 'user',
              text: '旧问题',
              anchor: {
                anchorType: 'html.quote',
                anchorPayload: { exact: '旧锚点' },
              },
            },
            { role: 'assistant', text: '旧回答' },
          ],
          createdTime: 100,
          updatedTime: 100,
        },
      ],
    });
  });

  it('accepts the transitional message shape that was written as version 1', () => {
    expect(
      normalizeHtmlConversationIndex({
        format: 'learning-companion/html-conversation-index',
        version: 1,
        entries: [validEntry],
      }),
    ).toEqual(makeIndex());
  });

  it('keeps colliding v1 entries by assigning deterministic migrated ids', () => {
    const legacy = {
      id: 'same-id',
      question: '问题',
      answer: '回答',
      createdTime: 100,
    };
    const migrated = normalizeHtmlConversationIndex({
      format: 'learning-companion/html-conversation-index',
      version: 1,
      entries: [legacy, legacy],
    });

    expect(migrated?.entries.map((entry) => entry.id)).toEqual([
      'same-id',
      'same-id~2',
    ]);
  });

  it('rejects corrupted data instead of partially dropping entries', () => {
    expect(
      normalizeHtmlConversationIndex({
        format: 'learning-companion/html-conversation-index',
        version: 1,
        entries: [{ id: 'broken' }],
      }),
    ).toBeUndefined();
    expect(
      normalizeHtmlConversationIndex(makeIndex([validEntry, validEntry])),
    ).toBeUndefined();
  });
});

describe('isHtmlConversationIndex', () => {
  it('accepts empty/current indexes and rejects duplicate ids or bad ordering', () => {
    expect(isHtmlConversationIndex(createHtmlConversationIndex())).toBe(true);
    expect(isHtmlConversationIndex(makeIndex())).toBe(true);
    expect(isHtmlConversationIndex(makeIndex([validEntry, validEntry]))).toBe(
      false,
    );
    expect(
      isHtmlConversationIndex(
        makeIndex([
          { ...validEntry, id: 'later', createdTime: validEntry.createdTime + 1 },
          validEntry,
        ]),
      ),
    ).toBe(false);
  });
});

describe('saveHtmlConversationEntry', () => {
  it('inserts a new entry and keeps the index ordered', () => {
    const later = {
      ...validEntry,
      id: 'later',
      createdTime: validEntry.createdTime + 10,
    };
    const index = saveHtmlConversationEntry(createHtmlConversationIndex(), later);
    const next = saveHtmlConversationEntry(index, validEntry);

    expect(next.entries.map((entry) => entry.id)).toEqual(['c-1', 'later']);
    expect(isHtmlConversationIndex(next)).toBe(true);
  });

  it('updates by stable id without duplicating or changing createdTime', () => {
    const updated = saveHtmlConversationEntry(makeIndex(), {
      ...validEntry,
      messages: [...validEntry.messages, { role: 'user', text: '继续问' }],
      createdTime: validEntry.createdTime + 999,
      updatedTime: validEntry.updatedTime + 1_000,
    });

    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]?.createdTime).toBe(validEntry.createdTime);
    expect(updated.entries[0]?.messages).toHaveLength(3);
  });

  it('ignores a stale update and enforces the entry cap only for inserts', () => {
    const index = makeIndex();
    expect(
      saveHtmlConversationEntry(index, {
        ...validEntry,
        messages: [{ role: 'user', text: 'stale' }],
        updatedTime: validEntry.updatedTime - 1,
      }),
    ).toBe(index);

    const entries = Array.from(
      { length: HTML_CONVERSATION_MAX_ENTRIES },
      (_, index) => ({
        ...validEntry,
        id: `c-${index}`,
        createdTime: validEntry.createdTime + index,
        updatedTime: validEntry.updatedTime + index,
      }),
    );
    expect(() =>
      saveHtmlConversationEntry(makeIndex(entries), {
        ...validEntry,
        id: 'overflow',
        createdTime: validEntry.createdTime + entries.length,
        updatedTime: validEntry.updatedTime + entries.length,
      }),
    ).toThrow();
  });
});

describe('removeHtmlConversationEntry', () => {
  it('removes only the requested stable id', () => {
    const other = {
      ...validEntry,
      id: 'c-2',
      createdTime: validEntry.createdTime + 1,
      updatedTime: validEntry.updatedTime + 1,
    };
    expect(
      removeHtmlConversationEntry(
        makeIndex([validEntry, other]),
        'c-1',
      ).entries,
    ).toEqual([other]);
  });
});
