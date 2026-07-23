import type { ProjectSummary } from '../../shared/ipc';

export interface ProjectInput {
  id: string;
  name: string;
  icon: string;
  createdTime: Date;
  sources: string[];
}

function requireText(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`Project ${field} 不能为空`);
  }

  return value;
}

function copySources(sources: string[]): string[] {
  if (sources.some((source) => source.trim().length === 0)) {
    throw new Error('Project source ID 不能为空');
  }

  return [...sources];
}

export class Project {
  readonly id: string;
  name: string;
  icon: string;
  readonly createdTime: Date;
  readonly sources: string[];

  constructor(input: ProjectInput) {
    if (Number.isNaN(input.createdTime.getTime())) {
      throw new Error('Project createdTime 必须是有效日期');
    }

    this.id = requireText(input.id, 'id');
    this.name = requireText(input.name, 'name');
    this.icon = requireText(input.icon, 'icon');
    this.createdTime = new Date(input.createdTime.getTime());
    this.sources = copySources(input.sources);
  }

  clone(): Project {
    return new Project({
      id: this.id,
      name: this.name,
      icon: this.icon,
      createdTime: this.createdTime,
      sources: this.sources,
    });
  }

  toSummary(): ProjectSummary {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      createdTime: this.createdTime.toISOString(),
      sources: [...this.sources],
    };
  }
}
