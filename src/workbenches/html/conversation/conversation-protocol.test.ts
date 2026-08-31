import { describe, expect, it } from 'vitest';

import { createHtmlQuoteTarget } from '../shared';
import {
  isHtmlConversationEntry,
  isHtmlConversationIndex,
  normalizeHtmlConversationIndex,
  type HtmlConversationEntry,
  type HtmlConversationIndex,
} from './conversation-protocol';

const validEntry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  messages: Object.freeze([
    Object.freeze({
      role: 'user',
      text: '什么是自注意力？',
      anchor: createHtmlQuoteTarget('自注意力'),
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

  it('rejects unsafe ids, empty messages, invalid roles, times, and non-JSON anchors', () => {
    expect(
      isHtmlConversationEntry({ ...validEntry, id: '../unsafe' }),
    ).toBe(false);
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

  it('rejects anchors that are not validated HTML targets', () => {
    // 只有 anchorType/anchorPayload 但缺 scope/anchorVersion 的裸对象不合法。
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          {
            role: 'user',
            text: 'x',
            anchor: {
              anchorType: 'html.quote',
              anchorPayload: { exact: '裸锚点' },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('accepts a stopped assistant message and rejects non-boolean stopped', () => {
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          ...validEntry.messages,
          Object.freeze({
            role: 'assistant',
            text: '已生成的部分',
            stopped: true,
          }),
        ],
      }),
    ).toBe(true);

    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          ...validEntry.messages,
          { role: 'assistant', text: '已生成的部分', stopped: 'yes' },
        ],
      }),
    ).toBe(false);
  });

  it('validates persisted GenerationTask associations', () => {
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          {
            role: 'assistant',
            text: 'answer',
            generationTaskId: 'task-1',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          {
            role: 'assistant',
            text: 'answer',
            generationTaskId: '',
          },
        ],
      }),
    ).toBe(false);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          {
            role: 'assistant',
            text: '',
            generationTaskId: 'task-pending',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [{ role: 'assistant', text: '' }],
      }),
    ).toBe(false);
  });

  it('enforces the anchor byte budget', () => {
    const oversizedAnchor = createHtmlQuoteTarget('大'.repeat(8_000));
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          { role: 'user', text: 'x', anchor: oversizedAnchor },
        ],
      }),
    ).toBe(false);

    const boundedAnchor = createHtmlQuoteTarget('自注意力');
    expect(
      isHtmlConversationEntry({
        ...validEntry,
        messages: [
          { role: 'user', text: 'x', anchor: boundedAnchor },
        ],
      }),
    ).toBe(true);
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
          anchor: createHtmlQuoteTarget('旧锚点'),
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
              anchor: createHtmlQuoteTarget('旧锚点'),
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
    expect(isHtmlConversationIndex(makeIndex([]))).toBe(true);
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
