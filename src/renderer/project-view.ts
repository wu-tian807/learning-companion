const PROJECT_CARD_COLORS = [
  '#323941',
  '#3c3332',
  '#30363d',
  '#38392d',
  '#3b3231',
  '#38312f',
  '#36382d',
  '#3b3139',
] as const;

export function getProjectCardColor(projectId: string): string {
  const hash = [...projectId].reduce(
    (value, character) => (value * 31 + character.codePointAt(0)!) >>> 0,
    0,
  );

  return PROJECT_CARD_COLORS[hash % PROJECT_CARD_COLORS.length]!;
}

export function formatProjectDate(createdTime: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(createdTime));
}

export function formatSourceCount(count: number): string {
  return `${count} 个来源`;
}
