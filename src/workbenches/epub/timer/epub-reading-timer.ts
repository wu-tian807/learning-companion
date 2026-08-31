export const EPUB_READING_TIMER_MIN_MINUTES = 1;
export const EPUB_READING_TIMER_MAX_MINUTES = 240;

export function parseReadingDurationMinutes(
  value: string,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;

  const minutes = Number(value);
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < EPUB_READING_TIMER_MIN_MINUTES ||
    minutes > EPUB_READING_TIMER_MAX_MINUTES
  ) {
    return undefined;
  }
  return minutes;
}

export function getRemainingReadingSeconds(
  deadline: number,
  now: number,
): number {
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}

export function formatReadingTimer(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  const minuteText = String(minutes).padStart(2, '0');
  const secondText = String(seconds).padStart(2, '0');

  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minuteText}:${secondText}`;
}
