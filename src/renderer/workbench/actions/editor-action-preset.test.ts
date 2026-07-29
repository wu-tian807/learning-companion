import { describe, expect, it, vi } from 'vitest';

import type {
  EditorActionAdapter,
  EditorActionState,
} from '../editor/editor-action-adapter';
import { isWorkbenchActionEnabled } from './workbench-action';
import { createEditorActionPreset } from './editor-action-preset';

function createAdapter(
  state: EditorActionState,
): EditorActionAdapter {
  return {
    getState: () => state,
    captureInteraction: () => ({ inputs: [] }),
    captureContextMenu: () => ({ interaction: { inputs: [] } }),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    find: vi.fn(),
    selectAll: vi.fn(),
  };
}

describe('Editor action preset', () => {
  it('maps dynamic editor capabilities to one shared menu model', () => {
    const adapter = createAdapter({
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canFind: false,
      canSelectAll: true,
    });
    const bundle = createEditorActionPreset(adapter);
    const enabled = Object.fromEntries(
      bundle.actions.map((action) => [
        action.id,
        isWorkbenchActionEnabled(action),
      ]),
    );

    expect(enabled).toMatchObject({
      'editor.undo': true,
      'editor.redo': false,
      'editor.cut': true,
      'editor.find': false,
      'editor.ai-placeholder': false,
    });
    expect(
      bundle.contributions.filter(
        (entry) => entry.surface === 'context-menu',
      ),
    ).toHaveLength(8);
  });
});
