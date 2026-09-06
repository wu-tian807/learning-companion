import { randomUUID } from 'node:crypto';

import {
  cloneLearningOutlineDocument,
  createDraftLearningOutline,
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_GENERATED_FILE_NAME,
  type CreateLearningOutlineResult,
  type LearningOutlineBriefState,
  type LearningOutlineDocument,
} from '../shared';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../../shared/asset-media-types';
import type { LearningOutlineChangedEvent } from '../shared';
import type { ConversationRecord } from '../../../shared/project-conversations';
import type { AssetAssociationServiceApi } from '../../../main/asset-associations/asset-association-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { AppError } from '../../../main/errors/app-error';
import type { AgentWorkspacePreparationApi } from '../../../main/agents/workspaces/agent-workspace-manager';
import type { ProjectConversationServiceApi } from '../../../main/conversation/project-conversation-service';
import type { ProjectLookup } from '../../../main/projects/project-database';
import { LearningOutlineBriefMonitor } from '../brief/learning-outline-brief-monitor';
import { LearningOutlineDocumentStore } from '../document/learning-outline-document-store';

export type LearningOutlineServiceEvent = LearningOutlineChangedEvent;

export interface LearningOutlineServiceApi {
  createDraft(
    projectId: string,
    input?: {
      readonly title?: string;
      readonly sourceAssetIds?: readonly string[];
      readonly createRequestId?: string;
    },
  ): Promise<CreateLearningOutlineResult>;
  requireBoundConversation(
    projectId: string,
    conversationId: string,
    boundAssetId: string,
  ): ConversationRecord;
  readDocument(assetId: string): Promise<LearningOutlineDocument>;
  /** Return the persisted MindMap sources of a bound outline for Main task preparation. */
  listIntakeSourceAssetIds(
    projectId: string,
    boundAssetId: string,
  ): Promise<readonly string[]>;
  readBriefState(projectId: string, assetId: string): Promise<LearningOutlineBriefState>;
  runBriefTask<T>(assetId: string, operation: () => Promise<T>): Promise<T>;
  subscribe(listener: (event: LearningOutlineServiceEvent) => void): () => void;
  shutdown(): Promise<void>;
  dispose(): void;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new AppError('INVALID_IPC_REQUEST', {
      cause: new Error(`${field} 无效`),
    });
  }
  return normalized;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export class LearningOutlineService implements LearningOutlineServiceApi {
  private readonly listeners = new Set<
    (event: LearningOutlineServiceEvent) => void
  >();
  private readonly briefTaskTails = new Map<string, Promise<void>>();
  private readonly draftRequests = new Map<
    string,
    Promise<CreateLearningOutlineResult>
  >();
  private readonly documents: LearningOutlineDocumentStore;
  private readonly briefMonitor: LearningOutlineBriefMonitor;
  private readonly unsubscribeBriefMonitor: () => void;
  private disposed = false;

  constructor(
    private readonly assets: AssetServiceApi,
    assetLookup: AssetLookup,
    private readonly attachments: AttachmentServiceApi,
    private readonly associations: AssetAssociationServiceApi,
    private readonly projects: ProjectLookup,
    private readonly conversations: ProjectConversationServiceApi,
    private readonly agentWorkspaces: AgentWorkspacePreparationApi,
  ) {
    this.documents = new LearningOutlineDocumentStore(this.assets);
    this.briefMonitor = new LearningOutlineBriefMonitor(
      assetLookup,
      this.attachments,
      this.agentWorkspaces,
    );
    this.unsubscribeBriefMonitor = this.briefMonitor.subscribe((event) =>
      this.publish(event),
    );
  }

  async createDraft(
    projectId: string,
    input: {
      readonly title?: string;
      readonly sourceAssetIds?: readonly string[];
      readonly createRequestId?: string;
    } = {},
  ): Promise<CreateLearningOutlineResult> {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const requestId = input.createRequestId?.trim();
    if (requestId) {
      if (!/^[A-Za-z0-9._-]{1,160}$/u.test(requestId)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      const requestKey = `${normalizedProjectId}:${requestId}`;
      const previous = this.draftRequests.get(requestKey);
      if (previous) return previous;
      const task = this.createDraftInternal(normalizedProjectId, input);
      const retained = task.catch((error: unknown) => {
        this.draftRequests.delete(requestKey);
        throw error;
      });
      this.draftRequests.set(requestKey, retained);
      return retained;
    }
    return this.createDraftInternal(normalizedProjectId, input);
  }

  private async createDraftInternal(
    projectId: string,
    input: {
      readonly title?: string;
      readonly sourceAssetIds?: readonly string[];
      readonly createRequestId?: string;
    },
  ): Promise<CreateLearningOutlineResult> {
    const normalizedProjectId = requireId(projectId, 'projectId');
    if (!this.projects.get(normalizedProjectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }
    const title = input.title?.trim() || '学习大纲';
    const sourceAssetIds = [
      ...new Set(
        (input.sourceAssetIds ?? []).map((assetId) =>
          requireId(assetId, 'sourceAssetId'),
        ),
      ),
    ];
    if (sourceAssetIds.length !== 1) {
      throw new AppError('INVALID_IPC_REQUEST', {
        cause: new Error('学习大纲必须绑定一份 MindMap 来源。'),
      });
    }
    for (const sourceAssetId of sourceAssetIds) {
      const source = this.assets.get(sourceAssetId);
      if (
        !source ||
        source.projectId !== normalizedProjectId ||
        source.mediaType !== MIND_MAP_ASSET_MEDIA_TYPE
      ) {
        throw new AppError('ASSET_NOT_FOUND');
      }
    }

    const draft = createDraftLearningOutline(title, Date.now());
    const document = cloneLearningOutlineDocument({
      ...draft,
      sourceAssetIds: sourceAssetIds,
    });
    const staged = await this.assets.stageGeneratedFile(normalizedProjectId, {
      fileName: `${LEARNING_OUTLINE_GENERATED_FILE_NAME.replace(/\.outline$/u, '')}-${randomUUID()}.outline`,
      name: title,
      mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
      content: jsonBytes(document),
    });

    try {
      for (const sourceAssetId of sourceAssetIds) {
        this.associations.ensureReference(staged.asset.id, { sourceAssetId });
      }
      const conversation = this.conversations.getOrCreateBoundConversation(
        normalizedProjectId,
        staged.asset.id,
        'learning-outline.intake',
      );
      return Object.freeze({ asset: staged.asset, conversation });
    } catch (error) {
      if (staged.created) {
        try {
          await this.assets.delete(staged.asset.id);
        } catch (cleanupError) {
          console.error('Learning Outline 草稿补偿清理失败', {
            originalError: error,
            cleanupError,
          });
          throw new Error(
            '学习大纲创建失败，且临时 Asset 清理失败，请稍后检查生成内容。',
            {
              cause: cleanupError,
            },
          );
        }
      }
      throw error;
    }
  }

  requireBoundConversation(
    projectId: string,
    conversationId: string,
    boundAssetId: string,
  ) {
    return this.conversations.requireBoundConversation(
      projectId,
      conversationId,
      boundAssetId,
    );
  }

  async readDocument(assetId: string): Promise<LearningOutlineDocument> {
    return this.documents.read(requireId(assetId, 'assetId'));
  }

  async listIntakeSourceAssetIds(
    projectId: string,
    boundAssetId: string,
  ): Promise<readonly string[]> {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedAssetId = requireId(boundAssetId, 'boundAssetId');
    const outline = this.assets.get(normalizedAssetId);
    if (
      !outline ||
      outline.projectId !== normalizedProjectId ||
      outline.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE
    ) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    const document = await this.readDocument(normalizedAssetId);
    const references = this.associations
      .listReferences(normalizedAssetId)
      .map((reference) => reference.sourceAssetId);
    const referenceIds = new Set(references);
    const sourceAssetIds = [...new Set(document.sourceAssetIds)];
    if (
      sourceAssetIds.some((sourceAssetId) => !referenceIds.has(sourceAssetId))
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    for (const sourceAssetId of sourceAssetIds) {
      const source = this.assets.get(sourceAssetId);
      if (
        !source ||
        source.projectId !== normalizedProjectId ||
        source.mediaType !== MIND_MAP_ASSET_MEDIA_TYPE
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
    }
    return Object.freeze(sourceAssetIds);
  }

  async readBriefState(
    projectId: string,
    assetId: string,
  ): Promise<LearningOutlineBriefState> {
    if (this.disposed) throw new AppError('SERVICE_NOT_READY');
    const owner = requireId(projectId, 'projectId');
    const id = requireId(assetId, 'assetId');
    await this.briefMonitor.start(owner, id);
    await this.briefMonitor.flush(owner, id);
    return this.briefMonitor.getState(owner, id);
  }

  async runBriefTask<T>(
    assetId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.disposed) throw new AppError('SERVICE_NOT_READY');
    const normalizedAssetId = requireId(assetId, 'assetId');
    const previous =
      this.briefTaskTails.get(normalizedAssetId) ?? Promise.resolve();
    let result: T | undefined;
    const task = previous.then(async () => {
      if (this.disposed) throw new AppError('SERVICE_NOT_READY');
      result = await operation();
    });
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.briefTaskTails.set(normalizedAssetId, tail);
    try {
      await task;
      return result as T;
    } finally {
      if (this.briefTaskTails.get(normalizedAssetId) === tail) {
        this.briefTaskTails.delete(normalizedAssetId);
      }
    }
  }

  subscribe(
    listener: (event: LearningOutlineServiceEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.briefTaskTails.values()]);
    await this.briefMonitor.shutdown();
  }

  dispose(): void {
    this.disposed = true;
    this.draftRequests.clear();
    this.briefTaskTails.clear();
    this.briefMonitor.dispose();
    this.unsubscribeBriefMonitor();
    this.listeners.clear();
  }

  private publish(event: LearningOutlineServiceEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('Learning Outline 事件订阅失败', error);
      }
    }
  }
}
