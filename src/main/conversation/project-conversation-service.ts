import { randomUUID } from 'node:crypto';

import {
  cloneConversationRecord,
  isConversationModeId,
  type ConversationRecord,
} from '../../shared/project-conversations';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import type { AssetLookup } from '../assets/asset-database';
import type { ProjectConversationDatabaseApi } from './project-conversation-database';

export interface ProjectConversationServiceApi {
  list(projectId: string): readonly ConversationRecord[];
  save(
    projectId: string,
    conversation: ConversationRecord,
  ): readonly ConversationRecord[];
  remove(
    projectId: string,
    conversationId: string,
  ): readonly ConversationRecord[];
  requireBoundConversation(
    projectId: string,
    conversationId: string,
    boundAssetId: string,
  ): ConversationRecord;
  getOrCreateBoundConversation(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord;
  /** Explicitly replace the unique bound conversation through Main. */
  rebuildBoundConversation(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord;
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
    private readonly assets?: AssetLookup,
  ) {}

  list(projectId: string): readonly ConversationRecord[] {
    const normalizedProjectId = this.requireProject(projectId);
    return this.database.list(normalizedProjectId);
  }

  getOrCreateBoundConversation(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord {
    const normalizedProjectId = this.requireProject(projectId);
    const normalizedAssetId = requireId(boundAssetId);
    const normalizedModeId = requireId(modeId);
    if (!isConversationModeId(normalizedModeId)) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    const asset = this.assets?.get(normalizedProjectId, normalizedAssetId);
    if (!asset || asset.projectId !== normalizedProjectId) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    const existing = this.database.getBound(
      normalizedProjectId,
      normalizedAssetId,
      normalizedModeId,
    );
    if (existing) return cloneConversationRecord(existing);
    const now = Date.now();
    const candidate = cloneConversationRecord({
      id: `conv-${randomUUID()}`,
      modeId: normalizedModeId,
      boundAssetId: normalizedAssetId,
      title: '新对话',
      messages: [],
      createdTime: now,
      updatedTime: now,
    });
    if (
      candidate.modeId !== normalizedModeId ||
      candidate.boundAssetId !== normalizedAssetId
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    try {
      return cloneConversationRecord(
        this.database.save(normalizedProjectId, candidate),
      );
    } catch (error) {
      const raced = this.database.getBound(
        normalizedProjectId,
        normalizedAssetId,
        normalizedModeId,
      );
      if (raced) return cloneConversationRecord(raced);
      throw error;
    }
  }

  rebuildBoundConversation(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord {
    const normalizedProjectId = this.requireProject(projectId);
    const normalizedAssetId = requireId(boundAssetId);
    const normalizedModeId = requireId(modeId);
    if (!isConversationModeId(normalizedModeId)) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    const asset = this.assets?.get(normalizedProjectId, normalizedAssetId);
    if (!asset || asset.projectId !== normalizedProjectId) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    const now = Date.now();
    const candidate = cloneConversationRecord({
      id: `conv-${randomUUID()}`,
      modeId: normalizedModeId,
      boundAssetId: normalizedAssetId,
      title: '新对话',
      messages: [],
      createdTime: now,
      updatedTime: now,
    });
    return cloneConversationRecord(
      this.database.replaceBound(
        normalizedProjectId,
        normalizedAssetId,
        normalizedModeId,
        candidate,
      ),
    );
  }

  requireBoundConversation(
    projectId: string,
    conversationId: string,
    boundAssetId: string,
  ): ConversationRecord {
    const normalizedProjectId = this.requireProject(projectId);
    const normalizedConversationId = requireId(conversationId);
    const normalizedAssetId = requireId(boundAssetId);
    const record = this.database.get(normalizedConversationId);
    if (
      !record ||
      record.projectId !== normalizedProjectId ||
      record.conversation.boundAssetId !== normalizedAssetId
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return cloneConversationRecord(record.conversation);
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
