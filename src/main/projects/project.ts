import {
  PROJECT_ICON_MAX_CODE_POINTS,
  PROJECT_NAME_MAX_LENGTH,
  type ProjectSummary,
} from '../../shared/ipc';

export interface ProjectInput {
  id: string;
  name: string;
  icon: string;
  createdTime: Date;
  sources: string[];
  pinned?: boolean;
}

function requireText(value: string, field: string, maxLength?: number): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Project ${field} 不能为空`);
  }

  if (maxLength !== undefined && [...normalized].length > maxLength) {
    throw new Error(`Project ${field} 过长`);
  }

  return normalized;
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
  pinned: boolean;

  constructor(input: ProjectInput) {
    if (Number.isNaN(input.createdTime.getTime())) {
      throw new Error('Project createdTime 必须是有效日期');
    }

    this.id = requireText(input.id, 'id');
    this.name = requireText(input.name, 'name', PROJECT_NAME_MAX_LENGTH);
    this.icon = requireText(input.icon, 'icon', PROJECT_ICON_MAX_CODE_POINTS);
    this.createdTime = new Date(input.createdTime.getTime());
    this.sources = copySources(input.sources);
    this.pinned = input.pinned ?? false;
  }

  rename(name: string): void {
    this.name = requireText(name, 'name', PROJECT_NAME_MAX_LENGTH);
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned;
  }

  clone(): Project {
    return new Project({
      id: this.id,
      name: this.name,
      icon: this.icon,
      createdTime: this.createdTime,
      sources: this.sources,
      pinned: this.pinned,
    });
  }

  toSummary(): ProjectSummary {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      createdTime: this.createdTime.toISOString(),
      sources: [...this.sources],
      pinned: this.pinned,
    };
  }
}
