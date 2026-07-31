const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'} ago`;
}

export function formatRelativeTime(
  value: number,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - value);

  if (elapsed < MINUTE) {
    return 'just now';
  }

  if (elapsed < HOUR) {
    return plural(Math.floor(elapsed / MINUTE), 'min');
  }

  if (elapsed < DAY) {
    return plural(Math.floor(elapsed / HOUR), 'hr');
  }

  return plural(Math.floor(elapsed / DAY), 'day');
}
