import { describe, expect, it } from 'vitest';

import { WORKBENCH_PROTOCOL_VERSION } from './manifest';
import {
  isJsonValue,
  isWorkbenchBootstrap,
  isWorkbenchCloseRequest,
  isWorkbenchCommandRequest,
  isWorkbenchEvent,
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
      isWorkbenchEvent({
        sessionId: 'session',
        type: 'test:status',
        payload: { phase: 'ready' },
      }),
    ).toBe(true);
    expect(
      isWorkbenchEvent({
        sessionId: '',
        type: 'test:status',
        payload: Number.NaN,
      }),
    ).toBe(false);
    expect(
      isWorkbenchBootstrap({
        sessionId: 'session',
        workbenchId: 'builtin.unsupported',
        workbenchVersion: 1,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        assetId: 'asset',
        mediaType: 'text/plain',
        availability: 'available',
        payload: { reason: 'unsupported-media' },
      }),
    ).toBe(true);
    expect(
      isWorkbenchBootstrap({
        sessionId: 'session',
        workbenchId: 'builtin.unsupported',
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        assetId: 'asset',
        mediaType: 'text/plain',
        availability: 'available',
        payload: null,
      }),
    ).toBe(false);
  });
});
