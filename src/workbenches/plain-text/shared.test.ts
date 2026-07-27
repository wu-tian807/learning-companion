import { describe, expect, it } from 'vitest';

import {
  createPlainTextBufferCommand,
  isPlainTextBufferPayload,
  isPlainTextWorkbenchPayload,
  isPlainTextWorkbenchStateV1,
  plainTextCommands,
} from './shared';

describe('Plain Text shared protocol', () => {
  const viewState = { anchor: 1, head: 4, scrollTop: 24 };

  it('validates Workbench state and bootstrap payloads', () => {
    expect(
      isPlainTextWorkbenchStateV1({
        viewState,
        recovery: {
          dataKey: 'recovery-content',
          baseRevision: 'revision',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          updatedTime: 100,
        },
      }),
    ).toBe(true);
    expect(
      isPlainTextWorkbenchPayload({
        content: '正文',
        encoding: 'utf-8',
        lineEnding: 'lf',
        hasByteOrderMark: false,
        revision: 'revision',
        viewState,
      }),
    ).toBe(true);
    expect(isPlainTextWorkbenchStateV1({ recovery: {} })).toBe(false);
  });

  it('creates a JSON-safe buffer command', () => {
    const command = createPlainTextBufferCommand(
      plainTextCommands.backup,
      {
        content: '未保存正文',
        viewState,
      },
    );

    expect(command).toEqual({
      type: 'plain-text:backup',
      payload: {
        content: '未保存正文',
        viewState,
      },
    });
    expect(isPlainTextBufferPayload(command.payload)).toBe(true);
  });
});
