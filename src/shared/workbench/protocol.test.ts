import { describe, expect, it } from 'vitest';

import {
  isJsonValue,
  isWorkbenchBootstrap,
  isWorkbenchCloseRequest,
  isWorkbenchCommandRequest,
  isWorkbenchOpenRequest,
} from './protocol';

describe('Workbench protocol', () => {
  it('accepts finite nested JSON values', () => {
    expect(
      isJsonValue({
        title: '学习笔记',
        pages: [1, 2, null],
        flags: { pinned: true },
      }),
    ).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
  });

  it('validates open, command and close requests', () => {
    expect(isWorkbenchOpenRequest({ assetId: 'asset' })).toBe(true);
    expect(isWorkbenchOpenRequest({ assetId: ' ' })).toBe(false);
    expect(
      isWorkbenchCommandRequest({
        sessionId: 'session',
        command: { type: 'navigate', payload: { page: 2 } },
      }),
    ).toBe(true);
    expect(
      isWorkbenchCommandRequest({
        sessionId: 'session',
        command: { type: 'navigate', payload: Number.POSITIVE_INFINITY },
      }),
    ).toBe(false);
    expect(isWorkbenchCloseRequest({ sessionId: 'session' })).toBe(true);
    expect(
      isWorkbenchBootstrap({
        sessionId: 'session',
        workbenchId: 'builtin.unsupported',
        protocolVersion: 1,
        assetId: 'asset',
        mediaType: 'text/plain',
        availability: 'available',
        payload: { reason: 'unsupported-media' },
      }),
    ).toBe(true);
  });
});
