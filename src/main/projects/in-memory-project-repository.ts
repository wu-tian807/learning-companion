import { Project } from './project';
import type { ProjectRepository } from './project-repository';

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects: Project[];

  constructor(projects: readonly Project[]) {
    this.projects = projects.map((project) => project.clone());
  }

  list(): readonly Project[] {
    return [...this.projects]
      .sort((left, right) => right.createdTime.getTime() - left.createdTime.getTime())
      .map((project) => project.clone());
  }
}

function createSourceIds(projectId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${projectId}:source-${index + 1}`);
}

export function createDefaultProjectRepository(): InMemoryProjectRepository {
  const projectData = [
    ['llm-engineering', '大模型工程化学习', '🚀', '2026-07-22T08:00:00.000Z', 12],
    ['price-elasticity', '需求价格弹性理论', '📈', '2026-07-18T08:00:00.000Z', 6],
    ['project-risk', '工程项目风险管理', '⚠️', '2026-07-15T08:00:00.000Z', 24],
    ['machine-learning', '机器学习基础', '🤖', '2026-07-10T08:00:00.000Z', 18],
    ['signals-and-systems', '信号与系统', '📡', '2026-06-29T08:00:00.000Z', 13],
    ['hash-and-sort', '哈希表与排序算法', '📦', '2026-06-21T08:00:00.000Z', 11],
    ['search-tree', '数据结构：搜索树', '🔍', '2026-06-12T08:00:00.000Z', 36],
    ['vector-merge', '向量归并与排序', '🧬', '2026-06-08T08:00:00.000Z', 15],
  ] as const;

  return new InMemoryProjectRepository(
    projectData.map(
      ([id, name, icon, createdTime, sourceCount]) =>
        new Project({
          id,
          name,
          icon,
          createdTime: new Date(createdTime),
          sources: createSourceIds(id, sourceCount),
        }),
    ),
  );
}
