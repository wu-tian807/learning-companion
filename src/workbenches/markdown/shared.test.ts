import { describe, expect, it } from 'vitest';

import {
  areMarkdownSourceViewStatesEqual,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownBufferSyncResult,
  isMarkdownSourceBufferPayload,
  isMarkdownWorkbenchPayload,
  isMarkdownWorkbenchStateV1,
  isMarkdownWysiwygBufferPayload,
  markdownCommands,
  markdownWorkbenchManifest,
} from './shared';

describe('Markdown Workbench shared protocol', () => {
  it('declares Markdown byte read/write capabilities', () => {
    expect(markdownWorkbenchManifest.supportedMediaTypes).toEqual([
      'text/markdown',
    ]);
    expect(
      markdownWorkbenchManifest.requiredContentCapabilities,
    ).toEqual(['read-bytes', 'write-bytes']);
    expect(markdownWorkbenchManifest.supportedAnchorTypes).toEqual([
      'markdown.source-range',
      'markdown.visual-selection',
    ]);
  });

  it('recognizes unchanged source editor view state', () => {
    const state = { anchor: 2, head: 5, scrollTop: 120 };

    expect(areMarkdownSourceViewStatesEqual(state, { ...state })).toBe(
      true,
    );
    expect(
      areMarkdownSourceViewStatesEqual(state, {
        ...state,
        scrollTop: 121,
      }),
    ).toBe(false);
  });

  it('validates persisted state and bootstrap recovery metadata', () => {
    expect(
      isMarkdownWorkbenchStateV1({
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        sourceViewState: {
          anchor: 2,
          head: 6,
          scrollTop: 24,
        },
        recovery: {
          dataKey: 'recovery-content',
          baseRevision: 'revision-0',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          editedFrom: 'wysiwyg',
          updatedTime: 100,
        },
      }),
    ).toBe(true);
    expect(
      isMarkdownWorkbenchPayload({
        diskSource: '# 标题',
        encoding: 'utf-8',
        lineEnding: 'lf',
        hasByteOrderMark: false,
        revision: 'revision-0',
        state: DEFAULT_MARKDOWN_WORKBENCH_STATE,
        recovery: {
          content: '# 恢复标题',
          baseRevision: 'revision-0',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          editedFrom: 'wysiwyg',
          updatedTime: 100,
          sourceChanged: false,
        },
      }),
    ).toBe(true);
    expect(
      isMarkdownWorkbenchStateV1({
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        viewMode: 'preview',
      }),
    ).toBe(false);
    expect(
      isMarkdownWorkbenchStateV1({
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        recovery: {
          dataKey: 'recovery-content',
          baseRevision: 'revision-0',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          editedFrom: 'wysiwyg',
          updatedTime: -1,
        },
      }),
    ).toBe(false);
  });

  it('keeps Source and WYSIWYG buffer commands semantically distinct', () => {
    const source = createMarkdownSyncSourceCommand({
      content: '# Source',
      lineEnding: 'lf',
      sourceViewState: {
        anchor: 1,
        head: 3,
        scrollTop: 12,
      },
    });
    const wysiwyg = createMarkdownSyncWysiwygCommand({
      content: '# WYSIWYG',
      lineEnding: 'crlf',
      wysiwygScrollTop: 48,
    });

    expect(source.type).toBe(markdownCommands.syncSourceBuffer);
    expect(isMarkdownSourceBufferPayload(source.payload)).toBe(true);
    expect(
      isMarkdownWysiwygBufferPayload(source.payload),
    ).toBe(false);
    expect(wysiwyg.type).toBe(markdownCommands.syncWysiwygBuffer);
    expect(isMarkdownWysiwygBufferPayload(wysiwyg.payload)).toBe(true);
    expect(isMarkdownSourceBufferPayload(wysiwyg.payload)).toBe(false);
  });

  it('validates buffer sync results', () => {
    expect(
      isMarkdownBufferSyncResult({
        accepted: true,
        dirty: true,
      }),
    ).toBe(true);
    expect(
      isMarkdownBufferSyncResult({
        accepted: true,
        dirty: 'yes',
      }),
    ).toBe(false);
  });
});
