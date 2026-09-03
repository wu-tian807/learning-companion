import { describe, expect, it } from 'vitest';

import {
  areMarkdownSourceViewStatesEqual,
  createMarkdownImageReference,
  createMarkdownImageTarget,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownBufferSyncResult,
  isMarkdownInsertImagePayload,
  isMarkdownInsertImageResult,
  isMarkdownReadImagePayload,
  isMarkdownReadImageResult,
  isMarkdownImageTargetPayload,
  markdownImageReferenceCandidates,
  isMarkdownSourceBufferPayload,
  markdownImageMediaTypeFromName,
  isMarkdownWorkbenchPayload,
  isMarkdownWorkbenchStateV1,
  isMarkdownWysiwygBufferPayload,
  isSupportedMarkdownImageMediaType,
  MARKDOWN_MAX_IMAGE_BYTES,
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
    expect(markdownWorkbenchManifest.supportedTargetTypes).toEqual([
      'markdown.source-range',
      'markdown.visual-selection',
      'markdown.image-source',
    ]);
  });

  it('accepts supported image types and maps names to media types', () => {
    expect(isSupportedMarkdownImageMediaType('image/png')).toBe(true);
    expect(isSupportedMarkdownImageMediaType('image/webp')).toBe(true);
    expect(isSupportedMarkdownImageMediaType('image/svg+xml')).toBe(
      false,
    );
    expect(
      markdownImageMediaTypeFromName('images/截图 1.JPG'),
    ).toBe('image/jpeg');
    expect(markdownImageMediaTypeFromName('images/scan.png')).toBe(
      'image/png',
    );
    expect(markdownImageMediaTypeFromName('images/data.bin')).toBe(
      undefined,
    );
  });

  it('validates markdown image anchor payloads', () => {
    const target = createMarkdownImageTarget('images/shot.png');
    expect(target).toMatchObject({
      scope: 'content',
      targetType: 'markdown.image-source',
      targetVersion: 1,
      targetPayload: { relativePath: 'images/shot.png' },
    });
    expect(isMarkdownImageTargetPayload(target.targetPayload)).toBe(true);
    expect(
      isMarkdownImageTargetPayload({ relativePath: '../secret.png' }),
    ).toBe(false);
    expect(
      isMarkdownImageTargetPayload({ relativePath: 'images/notes.txt' }),
    ).toBe(false);
  });

  it('builds image reference lookup candidates', () => {
    expect(
      markdownImageReferenceCandidates('images/my pic.png'),
    ).toEqual([
      'images/my pic.png',
      'images/my%20pic.png',
    ]);
    expect(
      markdownImageReferenceCandidates('images/%E5%9B%BE.png'),
    ).toContain('images/图.png');
  });

  it('validates insert/read image payloads and results', () => {
    const data = Buffer.from('png bytes').toString('base64');
    expect(
      isMarkdownInsertImagePayload({
        name: '截图 1.png',
        mediaType: 'image/png',
        data,
      }),
    ).toBe(true);
    expect(
      isMarkdownInsertImagePayload({
        name: '图.svg',
        mediaType: 'image/svg+xml',
        data,
      }),
    ).toBe(false);
    expect(
      isMarkdownInsertImagePayload({
        name: 'x.png',
        mediaType: 'image/png',
        data: `${'A'.repeat(Math.ceil((MARKDOWN_MAX_IMAGE_BYTES * 4) / 3) + 8)}`,
      }),
    ).toBe(false);

    expect(
      isMarkdownReadImagePayload({
        relativePath: 'images/截图 1.png',
      }),
    ).toBe(true);
    expect(
      isMarkdownReadImagePayload({
        relativePath: '../secret.png',
      }),
    ).toBe(false);
    expect(
      isMarkdownReadImagePayload({
        relativePath: 'images/notes.txt',
      }),
    ).toBe(false);

    expect(
      isMarkdownInsertImageResult({
        relativePath: 'images/截图 1.png',
      }),
    ).toBe(true);
    expect(
      isMarkdownReadImageResult({
        dataUrl: `data:image/png;base64,${data}`,
      }),
    ).toBe(true);
    expect(
      isMarkdownReadImageResult({
        dataUrl: 'https://example.com/x.png',
      }),
    ).toBe(false);
  });

  it('builds Markdown image references with encoded spaces', () => {
    expect(
      createMarkdownImageReference('images/截图 1.png', '截图'),
    ).toBe('![截图](images/截图%201.png)');
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
