import { describe, expect, it } from 'vitest';

import type { MarkdownEditorAdapter } from './markdown-editor-adapter';
import { MarkdownEditorActionAdapter } from './markdown-editor-action-adapter';

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
});
