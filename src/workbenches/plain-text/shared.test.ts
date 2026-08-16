import { describe, expect, it } from 'vitest';

import {
  createPlainTextBufferCommand,
  DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
  isPlainTextBufferPayload,
  isPlainTextEncodingPayload,
  isPlainTextLineEndingPayload,
  isPlainTextWorkbenchPayload,
  isPlainTextWorkbenchStateV1,
  isPlainTextWorkbenchStateV2,
  plainTextWorkbenchManifest,
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
        viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
        viewState,
      }),
    ).toBe(true);
    expect(isPlainTextWorkbenchStateV1({ recovery: {} })).toBe(false);
    expect(
      isPlainTextWorkbenchStateV2({
        viewState,
        viewOptions: {
          wordWrap: false,
          lineNumbers: true,
          readMode: false,
        },
      }),
    ).toBe(true);
    expect(
      isPlainTextWorkbenchStateV2({
        viewOptions: {
          wordWrap: false,
          lineNumbers: true,
        },
      }),
    ).toBe(false);
    expect(
      isPlainTextWorkbenchStateV2({
        viewOptions: {
          wordWrap: 'yes',
          lineNumbers: true,
        },
      }),
    ).toBe(false);
  });

  it('creates a JSON-safe buffer command', () => {
    const command = createPlainTextBufferCommand(
      plainTextCommands.backup,
      {
        content: '未保存正文',
        lineEnding: 'crlf',
        viewState,
      },
    );

    expect(command).toEqual({
      type: 'plain-text:backup',
      payload: {
        content: '未保存正文',
        lineEnding: 'crlf',
        viewState,
      },
    });
    expect(isPlainTextBufferPayload(command.payload)).toBe(true);
  });

  it('validates format control payloads', () => {
    expect(isPlainTextLineEndingPayload({ lineEnding: 'crlf' })).toBe(true);
    expect(isPlainTextLineEndingPayload({ lineEnding: 'cr' })).toBe(false);
    expect(isPlainTextEncodingPayload({ encoding: 'gbk' })).toBe(true);
    expect(isPlainTextEncodingPayload({ encoding: 'latin1' })).toBe(false);
  });

  it('declares text range anchors for editor interactions', () => {
    expect(plainTextWorkbenchManifest.supportedAnchorTypes).toEqual([
      'plain-text.text-range',
    ]);
  });
});
