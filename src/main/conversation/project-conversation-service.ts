import {
  cloneConversationRecord,
  cloneConversationRecords,
  type ConversationRecord,
} from '../../shared/project-conversations';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectConversationDatabaseApi } from './project-conversation-database';

export interface ProjectConversationServiceApi {
  list(projectId: string): readonly ConversationRecord[];
  save(
    projectId: string,
    conversation: ConversationRecord,
  ): readonly ConversationRecord[];
  import(
    projectId: string,
    conversations: readonly ConversationRecord[],
  ): readonly ConversationRecord[];
  remove(
    projectId: string,
    conversationId: string,
  ): readonly ConversationRecord[];
}

function requireId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return normalized;
}

export class ProjectConversationService
  implements ProjectConversationServiceApi
{
  constructor(
    private readonly database: ProjectConversationDatabaseApi,
    private readonly projects: ProjectLookup,
  ) {}

  list(projectId: string): readonly ConversationRecord[] {
    const normalizedProjectId = this.requireProject(projectId);
    return this.database.list(normalizedProjectId);
  }

  save(
    projectId: string,
    conversation: ConversationRecord,
  ): readonly ConversationRecord[] {
    const normalizedProjectId = this.requireProject(projectId);
    this.database.save(
      normalizedProjectId,
      cloneConversationRecord(conversation),
    );
    return this.database.list(normalizedProjectId);
  }

  import(
    projectId: string,
    conversations: readonly ConversationRecord[],
  ): readonly ConversationRecord[] {
    const normalizedProjectId = this.requireProject(projectId);
    return this.database.import(
      normalizedProjectId,
      cloneConversationRecords(conversations),
    );
  }

  remove(
    projectId: string,
    conversationId: string,
  ): readonly ConversationRecord[] {
    const normalizedProjectId = this.requireProject(projectId);
    this.database.remove(normalizedProjectId, requireId(conversationId));
    return this.database.list(normalizedProjectId);
  }

  private requireProject(projectId: string): string {
    const normalized = requireId(projectId);
    if (!this.projects.get(normalized)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }
    return normalized;
  }
}
