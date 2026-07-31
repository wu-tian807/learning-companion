import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './relative-time';

const now = Date.parse('2026-07-31T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it.each([
    [now + 1_000, 'just now'],
    [now - 59_999, 'just now'],
    [now - 60_000, '1 min ago'],
    [now - 18 * 60_000, '18 mins ago'],
    [now - 60 * 60_000, '1 hr ago'],
    [now - 16 * 60 * 60_000, '16 hrs ago'],
    [now - 24 * 60 * 60_000, '1 day ago'],
    [now - 366 * 24 * 60 * 60_000, '366 days ago'],
  ])('formats %s relative to now', (value, expected) => {
    expect(formatRelativeTime(value, now)).toBe(expected);
  });
});
