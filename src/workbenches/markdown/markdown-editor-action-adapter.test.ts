import { describe, expect, it } from 'vitest';

import type { MarkdownEditorAdapter } from './markdown-editor-adapter';
import {
  MarkdownEditorActionAdapter,
  resolveMarkdownVisualSelectionSourceRange,
} from './markdown-editor-action-adapter';

describe('Markdown editor action adapter', () => {
  it('maps Vditor readiness and history into shared editor capabilities', () => {
    const editor = {
      getEditableElement: () => ({}) as HTMLElement,
      canUndo: () => true,
      canRedo: () => false,
    } as MarkdownEditorAdapter;
    const adapter = new MarkdownEditorActionAdapter({
      getEditor: () => editor,
    });

    expect(adapter.getState()).toEqual({
      canUndo: true,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: true,
      canSelectAll: true,
      canFind: false,
    });
  });

  it('disables every operation while Vditor is unavailable', () => {
    const adapter = new MarkdownEditorActionAdapter({
      getEditor: () => undefined,
    });

    expect(adapter.getState()).toEqual({
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
      canFind: false,
    });
  });

  it('maps formatted visual text back to the exact Markdown source range', () => {
    expect(resolveMarkdownVisualSelectionSourceRange({
      source: '[hello](url) world',
      selectedMarkdown: '[hello](url) world',
      selectedText: 'hello world',
      renderedPrefix: '',
      renderedDocument: 'hello world',
    })).toEqual({ start: 0, end: 18 });

    expect(resolveMarkdownVisualSelectionSourceRange({
      source: '[hello](url)',
      selectedMarkdown: '[hello](url)',
      selectedText: 'hello',
      renderedPrefix: '',
      renderedDocument: 'hello',
    })).toEqual({ start: 0, end: 12 });
  });

  it('refuses to treat unformatted visual text as a safe Markdown syntax boundary', () => {
    expect(resolveMarkdownVisualSelectionSourceRange({
      source: '[hello](url)',
      selectedMarkdown: 'hello',
      selectedText: 'hello',
      renderedPrefix: '',
      renderedDocument: 'hello',
    })).toBeUndefined();

    expect(resolveMarkdownVisualSelectionSourceRange({
      source: '[hello](url)',
      selectedMarkdown: 'hello',
      selectedText: ' hello ',
      renderedPrefix: '',
      renderedDocument: ' hello ',
    })).toBeUndefined();
  });

  it('uses the rendered occurrence or an independently aligned literal boundary', () => {
    expect(resolveMarkdownVisualSelectionSourceRange({
      source: 'hello hello',
      selectedMarkdown: 'hello',
      selectedText: 'hello',
      renderedPrefix: 'hello ',
      renderedDocument: 'hello hello',
    })).toEqual({ start: 6, end: 11 });

    expect(resolveMarkdownVisualSelectionSourceRange({
      source: '[hello](hello) hello',
      selectedMarkdown: 'hello',
      selectedText: 'hello',
      renderedPrefix: 'hello ',
      renderedDocument: 'hello hello',
    })).toEqual({ start: 15, end: 20 });
  });
});
