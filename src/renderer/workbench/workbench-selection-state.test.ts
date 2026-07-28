import { describe, expect, it } from 'vitest';

import type { WorkbenchSelectionEnvelope } from '../../shared/workbench/selection';
import { reduceWorkbenchSelection } from './workbench-selection-state';

const selected: WorkbenchSelectionEnvelope = {
  assetId: 'asset-1',
  sessionId: 'session-1',
  selection: {
    text: '一段文字',
    target: {
      scope: 'content',
      anchorType: 'pdf.text-range',
      anchorVersion: 1,
      anchorPayload: { pageNumber: 1 },
    },
  },
};

describe('Workbench selection state', () => {
  it('accepts a selection only from the active Asset', () => {
    expect(reduceWorkbenchSelection(undefined, selected, 'asset-1')).toBe(
      selected,
    );
    expect(
      reduceWorkbenchSelection(undefined, selected, 'asset-2'),
    ).toBeUndefined();
  });

  it('ignores a stale session clearing the current selection', () => {
    const staleClear: WorkbenchSelectionEnvelope = {
      assetId: 'asset-1',
      sessionId: 'old-session',
      selection: undefined,
    };

    expect(
      reduceWorkbenchSelection(selected, staleClear, 'asset-1'),
    ).toBe(selected);
  });

  it('clears the selection for the matching session', () => {
    expect(
      reduceWorkbenchSelection(
        selected,
        { ...selected, selection: undefined },
        'asset-1',
      ),
    ).toBeUndefined();
  });
});
