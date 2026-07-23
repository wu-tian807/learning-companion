import type { ProjectSummary } from '../shared/ipc';

export type ProjectViewMode = 'grid' | 'list';
export type ProjectSortMode = 'newest' | 'oldest' | 'title';

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

const titleCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

function compareBySortMode(
  left: ProjectSummary,
  right: ProjectSummary,
  sortMode: ProjectSortMode,
): number {
  if (sortMode === 'title') {
    return titleCollator.compare(left.name, right.name);
  }

  const difference = Date.parse(left.createdTime) - Date.parse(right.createdTime);
  return sortMode === 'oldest' ? difference : -difference;
}

export function filterAndSortProjects(
  projects: readonly ProjectSummary[],
  searchQuery: string,
  sortMode: ProjectSortMode,
): ProjectSummary[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN');

  return projects
    .filter(
      (project) =>
        normalizedQuery.length === 0 ||
        project.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
    )
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }

      return compareBySortMode(left, right, sortMode);
    });
}

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
