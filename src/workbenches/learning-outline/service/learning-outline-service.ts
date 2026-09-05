import { randomUUID } from 'node:crypto';

import {
  cloneLearningOutlineDocument,
  createDraftLearningOutline,
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_GENERATED_FILE_NAME,
  type CreateLearningOutlineResult,
  type LearningOutlineBriefState,
  type LearningOutlineDocument,
  type LearningOutlineProgressEntry,
  type LearningOutlineSnapshot,
  type LearningUnitStatus,
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
  getSnapshot(assetId: string): Promise<LearningOutlineSnapshot | undefined>;
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
  updateDocument(
    assetId: string,
    expectedUpdatedTime: number,
    update: (document: LearningOutlineDocument) => LearningOutlineDocument,
  ): Promise<LearningOutlineDocument>;
  updateUnitStatus(
    assetId: string,
    unitId: string,
    status: LearningUnitStatus,
  ): Promise<LearningOutlineDocument>;
  setSources(
    assetId: string,
    sourceAssetIds: readonly string[],
  ): Promise<LearningOutlineDocument>;
  ensureBriefWorkspace(projectId: string, assetId: string): Promise<string>;
  startBriefMonitor(projectId: string, assetId: string): Promise<void>;
  flushBrief(assetId: string): Promise<void>;
  runBriefTask<T>(assetId: string, operation: () => Promise<T>): Promise<T>;
  getBriefState(assetId: string): LearningOutlineBriefState;
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

function progressForUnit(
  document: LearningOutlineDocument,
  unitId: string,
  status: LearningUnitStatus,
  updatedTime: number,
): readonly LearningOutlineProgressEntry[] {
  const existing = document.progress.filter((entry) => entry.unitId !== unitId);
  return [...existing, { unitId, status, updatedTime }];
}

export class LearningOutlineService implements LearningOutlineServiceApi {
  private readonly listeners = new Set<
    (event: LearningOutlineServiceEvent) => void
  >();
  private readonly documentTails = new Map<string, Promise<void>>();
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
    assetLookup: AssetLookup | undefined,
    private readonly attachments: AttachmentServiceApi,
    private readonly associations: AssetAssociationServiceApi,
    private readonly projects: ProjectLookup,
    private readonly conversations: ProjectConversationServiceApi,
    private readonly agentWorkspaces: AgentWorkspacePreparationApi,
  ) {
    this.documents = new LearningOutlineDocumentStore(this.assets);
    this.briefMonitor = new LearningOutlineBriefMonitor(
      assetLookup ?? {
        get: (projectId, assetId) => {
          const asset = this.assets.get(assetId);
          return asset?.projectId === projectId ? asset : undefined;
        },
      },
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

  async getSnapshot(
    assetId: string,
  ): Promise<LearningOutlineSnapshot | undefined> {
    const normalizedAssetId = requireId(assetId, 'assetId');
    const asset = this.assets.get(normalizedAssetId);
    if (!asset || asset.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE) {
      return undefined;
    }
    const document = await this.readDocument(normalizedAssetId);
    return Object.freeze({
      asset,
      document,
      brief: this.getBriefState(normalizedAssetId),
    });
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

  async updateDocument(
    assetId: string,
    expectedUpdatedTime: number,
    update: (document: LearningOutlineDocument) => LearningOutlineDocument,
  ): Promise<LearningOutlineDocument> {
    const normalizedAssetId = requireId(assetId, 'assetId');
    const previous =
      this.documentTails.get(normalizedAssetId) ?? Promise.resolve();
    let result: LearningOutlineDocument | undefined;
    const operation = previous.then(async () => {
      const current = await this.readDocument(normalizedAssetId);
      if (current.updatedTime !== expectedUpdatedTime) {
        throw new AppError('DATABASE_WRITE_CONFLICT');
      }
      const next = cloneLearningOutlineDocument(update(current));
      const asset = this.assets.get(normalizedAssetId);
      if (!asset) throw new AppError('ASSET_NOT_FOUND');
      await this.documents.write(normalizedAssetId, next);
      this.assets.update(normalizedAssetId, {
        updatedTime: { mode: 'now' },
      });
      result = next;
      this.publish({
        type: 'document-changed',
        projectId: asset.projectId,
        assetId: normalizedAssetId,
        document: next,
      });
    });
    this.documentTails.set(
      normalizedAssetId,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    await operation;
    return result!;
  }

  async updateUnitStatus(
    assetId: string,
    unitId: string,
    status: LearningUnitStatus,
  ): Promise<LearningOutlineDocument> {
    const document = await this.readDocument(assetId);
    const unitExists = document.chapters.some((chapter) =>
      chapter.units.some((unit) => unit.id === unitId),
    );
    if (!unitExists) throw new AppError('DATA_INTEGRITY_ERROR');
    return this.updateDocument(assetId, document.updatedTime, (current) => ({
      ...current,
      progress: progressForUnit(current, unitId, status, Date.now()),
      updatedTime: Math.max(Date.now(), current.updatedTime),
    }));
  }

  async setSources(
    assetId: string,
    sourceAssetIds: readonly string[],
  ): Promise<LearningOutlineDocument> {
    const asset = this.assets.get(requireId(assetId, 'assetId'));
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    const normalized = [
      ...new Set(sourceAssetIds.map((id) => requireId(id, 'sourceAssetId'))),
    ];
    if (normalized.length === 0) {
      throw new AppError('INVALID_IPC_REQUEST', {
        cause: new Error('学习大纲必须至少保留一个 MindMap 来源。'),
      });
    }
    for (const sourceAssetId of normalized) {
      const source = this.assets.get(sourceAssetId);
      if (
        !source ||
        source.projectId !== asset.projectId ||
        source.id === asset.id ||
        source.mediaType !== MIND_MAP_ASSET_MEDIA_TYPE
      ) {
        throw new AppError('ASSET_NOT_FOUND');
      }
    }
    for (const reference of this.associations.listReferences(asset.id)) {
      if (!normalized.includes(reference.sourceAssetId)) {
        this.associations.deleteReference(reference.id);
      }
    }
    for (const sourceAssetId of normalized) {
      this.associations.ensureReference(asset.id, { sourceAssetId });
    }
    const document = await this.readDocument(asset.id);
    return this.updateDocument(asset.id, document.updatedTime, (current) => ({
      ...current,
      sourceAssetIds: normalized,
      updatedTime: Math.max(Date.now(), current.updatedTime),
    }));
  }

  async ensureBriefWorkspace(
    projectId: string,
    assetId: string,
  ): Promise<string> {
    return this.briefMonitor.ensureWorkspace(
      requireId(projectId, 'projectId'),
      requireId(assetId, 'assetId'),
    );
  }

  async startBriefMonitor(projectId: string, assetId: string): Promise<void> {
    if (this.disposed) return;
    await this.briefMonitor.start(
      requireId(projectId, 'projectId'),
      requireId(assetId, 'assetId'),
    );
  }

  async flushBrief(assetId: string): Promise<void> {
    if (this.disposed) return;
    await this.briefMonitor.flush(requireId(assetId, 'assetId'));
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

  getBriefState(assetId: string): LearningOutlineBriefState {
    return this.briefMonitor.getState(assetId);
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
