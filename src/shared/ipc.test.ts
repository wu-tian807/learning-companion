import { describe, expect, it } from 'vitest';

import { createHealthCheckResponse, isHealthCheckResponse } from './ipc';

describe('health check contract', () => {
  it('creates a serializable health response', () => {
    const now = new Date('2026-07-22T08:00:00.000Z');

    const response = createHealthCheckResponse('0.1.0', 'darwin', now);

    expect(response).toEqual({
      status: 'ok',
      appVersion: '0.1.0',
      platform: 'darwin',
      timestamp: '2026-07-22T08:00:00.000Z',
    });
    expect(isHealthCheckResponse(response)).toBe(true);
  });

  it('rejects malformed responses', () => {
    expect(isHealthCheckResponse(null)).toBe(false);
    expect(isHealthCheckResponse({ status: 'error' })).toBe(false);
    expect(
      isHealthCheckResponse({
        status: 'ok',
        appVersion: '0.1.0',
        platform: 'darwin',
        timestamp: 'not-a-date',
      }),
    ).toBe(false);
  });
});
