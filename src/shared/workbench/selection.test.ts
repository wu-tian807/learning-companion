import { describe, expect, it } from 'vitest';

import {
  isWorkbenchSelectionEnvelope,
  isWorkbenchSelectionSnapshot,
  type WorkbenchSelectionSnapshot,
} from './selection';

const selection: WorkbenchSelectionSnapshot = {
  text: '选中的正文',
  target: {
    scope: 'content',
    anchorType: 'pdf.text-range',
    anchorVersion: 1,
    anchorPayload: {
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
  it('accepts a content selection and its session envelope', () => {
    expect(isWorkbenchSelectionSnapshot(selection)).toBe(true);
    expect(
      isWorkbenchSelectionEnvelope({
        assetId: 'asset-1',
        sessionId: 'session-1',
        selection,
      }),
    ).toBe(true);
    expect(
      isWorkbenchSelectionEnvelope({
        assetId: 'asset-1',
        sessionId: 'session-1',
        selection: undefined,
      }),
    ).toBe(true);
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

  it('rejects envelopes without asset or session identity', () => {
    expect(
      isWorkbenchSelectionEnvelope({
        assetId: '',
        sessionId: 'session-1',
        selection,
      }),
    ).toBe(false);
    expect(
      isWorkbenchSelectionEnvelope({
        assetId: 'asset-1',
        sessionId: '',
        selection,
      }),
    ).toBe(false);
  });
});
