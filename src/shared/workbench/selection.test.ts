import { describe, expect, it } from 'vitest';

import {
  createTextSelectionInput,
  findTextSelectionInput,
  interactionFromTextSelection,
  isWorkbenchSelectionSnapshot,
  type WorkbenchSelectionSnapshot,
} from './selection';

const selection: WorkbenchSelectionSnapshot = {
  text: '选中的正文',
  target: {
    scope: 'content',
    targetType: 'pdf.text-range',
    targetVersion: 1,
    targetPayload: {
      documentFingerprint: 'fingerprint',
      start: { pageNumber: 1, offset: 0 },
      end: { pageNumber: 1, offset: 6 },
      exact: '选中的正文',
      prefix: '',
      suffix: '',
    },
  },
};

describe('Workbench selection contract', () => {
  it('accepts a content selection snapshot', () => {
    expect(isWorkbenchSelectionSnapshot(selection)).toBe(true);
    const input = createTextSelectionInput(selection);
    const interaction = interactionFromTextSelection(selection);

    expect(input.type).toBe('core.input.text-selection');
    expect(interaction.focus).toEqual(selection.target);
    expect(findTextSelectionInput(interaction)).toEqual(selection);
  });

  it('rejects empty selections and asset-level targets', () => {
    expect(
      isWorkbenchSelectionSnapshot({ ...selection, text: '   ' }),
    ).toBe(false);
    expect(
      isWorkbenchSelectionSnapshot({
        text: '选区',
        target: { scope: 'asset' },
      }),
    ).toBe(false);
  });
});
