import { describe, expect, it } from 'vitest';

import {
  appendHtmlConversationEntry,
  createHtmlConversationIndex,
  HTML_CONVERSATION_MAX_ENTRIES,
  isHtmlConversationEntry,
  isHtmlConversationIndexV1,
  type HtmlConversationEntry,
  type HtmlConversationIndexV1,
} from './conversation-protocol';

const validEntry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  question: '什么是自注意力？',
  answer: '自注意力允许任意两个位置直接交互。',
  createdTime: 1_720_000_000_000,
});

function makeIndex(
  entries: readonly HtmlConversationEntry[] = [validEntry],
): HtmlConversationIndexV1 {
  return Object.freeze({
    format: 'learning-companion/html-conversation-index',
    version: 1,
    entries: Object.freeze(entries),
  });
}

describe('isHtmlConversationEntry', () => {
  it('accepts a valid entry', () => {
    expect(isHtmlConversationEntry(validEntry)).toBe(true);
  });

  it('accepts an entry without anchor', () => {
    const { anchor: _anchor, ...rest } = validEntry;
    expect(isHtmlConversationEntry(rest)).toBe(true);
  });

  it('rejects empty id / question / answer', () => {
    expect(isHtmlConversationEntry({ ...validEntry, id: '' })).toBe(false);
    expect(isHtmlConversationEntry({ ...validEntry, question: '  ' })).toBe(false);
    expect(isHtmlConversationEntry({ ...validEntry, answer: '' })).toBe(false);
  });

  it('rejects oversized text and invalid time', () => {
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        question: 'q'.repeat(32_769),
      }),
    ).toBe(false);
    expect(isHtmlConversationEntry({ ...validEntry, createdTime: -1 })).toBe(false);
  });

  it('rejects non-JSON anchor', () => {
    expect(
      isHtmlConversationEntry({ ...validEntry, anchor: { nested: () => 1 } }),
    ).toBe(false);
  });
});

describe('isHtmlConversationIndexV1', () => {
  it('accepts a valid index', () => {
    expect(isHtmlConversationIndexV1(makeIndex())).toBe(true);
  });

  it('accepts an empty index', () => {
    expect(isHtmlConversationIndexV1(createHtmlConversationIndex())).toBe(true);
  });

  it('rejects wrong format / version / non-array entries', () => {
    expect(
      isHtmlConversationIndexV1({ ...makeIndex(), format: 'other' }),
    ).toBe(false);
    expect(
      isHtmlConversationIndexV1({ ...makeIndex(), version: 2 }),
    ).toBe(false);
    expect(
      isHtmlConversationIndexV1({ ...makeIndex(), entries: 'x' }),
    ).toBe(false);
  });

  it('rejects out-of-order entries', () => {
    const later = { ...validEntry, id: 'c-2', createdTime: 1_720_000_000_001 };
    expect(isHtmlConversationIndexV1(makeIndex([later, validEntry]))).toBe(false);
  });

  it('rejects more than the entry cap', () => {
    const entries = Array.from(
      { length: HTML_CONVERSATION_MAX_ENTRIES + 1 },
      (_, index) => ({
        ...validEntry,
        id: `c-${index}`,
        createdTime: 1_720_000_000_000 + index,
      }),
    );
    expect(isHtmlConversationIndexV1(makeIndex(entries))).toBe(false);
  });
});

describe('appendHtmlConversationEntry', () => {
  it('appends a new entry immutably', () => {
    const index = createHtmlConversationIndex();
    const next = appendHtmlConversationEntry(index, validEntry);

    expect(index.entries).toHaveLength(0);
    expect(next.entries).toEqual([validEntry]);
    expect(Object.isFrozen(next.entries)).toBe(true);
    expect(isHtmlConversationIndexV1(next)).toBe(true);
  });

  it('rejects invalid entry and time regression', () => {
    expect(() =>
      appendHtmlConversationEntry(createHtmlConversationIndex(), {
        ...validEntry,
        id: '',
      }),
    ).toThrow();
    expect(() =>
      appendHtmlConversationEntry(makeIndex(), {
        ...validEntry,
        id: 'c-2',
        createdTime: 1_000_000,
      }),
    ).toThrow();
  });
});
