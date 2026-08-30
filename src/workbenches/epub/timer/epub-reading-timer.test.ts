import { describe, expect, it } from 'vitest';

import {
  formatReadingTimer,
  getRemainingReadingSeconds,
  parseReadingDurationMinutes,
} from './epub-reading-timer';

describe('EPUB reading timer helpers', () => {
  it('accepts whole-minute durations inside the supported range', () => {
    expect(parseReadingDurationMinutes('1')).toBe(1);
    expect(parseReadingDurationMinutes('25')).toBe(25);
    expect(parseReadingDurationMinutes('240')).toBe(240);
  });

  it('rejects empty, fractional, non-numeric, and out-of-range durations', () => {
    expect(parseReadingDurationMinutes('')).toBeUndefined();
    expect(parseReadingDurationMinutes('0')).toBeUndefined();
    expect(parseReadingDurationMinutes('1.5')).toBeUndefined();
    expect(parseReadingDurationMinutes('241')).toBeUndefined();
    expect(parseReadingDurationMinutes('abc')).toBeUndefined();
  });

  it('derives remaining time from an absolute deadline', () => {
    expect(getRemainingReadingSeconds(61_001, 1_000)).toBe(61);
    expect(getRemainingReadingSeconds(999, 1_000)).toBe(0);
  });

  it('formats short and long reading sessions', () => {
    expect(formatReadingTimer(65)).toBe('01:05');
    expect(formatReadingTimer(3_661)).toBe('1:01:01');
  });
});
