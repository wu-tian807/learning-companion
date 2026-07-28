import { describe, expect, it } from 'vitest';

import {
  createMarkdownSaveNormalizedCommand,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownBufferSyncResult,
  isMarkdownSaveNormalizedPayload,
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
    expect(markdownWorkbenchManifest.supportedAnchorTypes).toEqual([]);
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
          normalizationPending: true,
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
          normalizationPending: true,
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
          normalizationPending: 'yes',
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

  it('requires an explicit literal confirmation for normalized saves', () => {
    const command = createMarkdownSaveNormalizedCommand();

    expect(command).toEqual({
      type: markdownCommands.saveNormalized,
      payload: { confirmed: true },
    });
    expect(isMarkdownSaveNormalizedPayload(command.payload)).toBe(true);
    expect(
      isMarkdownSaveNormalizedPayload({ confirmed: false }),
    ).toBe(false);
  });

  it('validates normalization-aware sync results', () => {
    expect(
      isMarkdownBufferSyncResult({
        accepted: true,
        dirty: true,
        normalizationState: 'requires-confirmation',
      }),
    ).toBe(true);
    expect(
      isMarkdownBufferSyncResult({
        accepted: true,
        dirty: false,
        normalizationState: 'unknown',
      }),
    ).toBe(false);
  });
});
