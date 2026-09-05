import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { LearningOutlineWorkbenchProvider } from './main';
import { learningOutlineWorkbenchManifest } from './shared';
import { createLearningOutlineIntakeTaskDefinitionV1 } from './generation/learning-outline-intake-task-definition';
import {
  LearningOutlineService,
  type LearningOutlineServiceApi,
} from './service/learning-outline-service';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import { AppError } from '../../main/errors/app-error';
import { isJsonValue, type JsonValue } from '../../shared/workbench/protocol';
import { learningOutlineActions } from './shared';
import {
  isLearningOutlineBriefAttachmentMetadata,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
} from './shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCreateDraftPayload(payload: JsonValue | undefined): {
  readonly title?: string;
  readonly sourceAssetIds?: readonly string[];
  readonly createRequestId?: string;
} {
  if (payload === undefined) return {};
  if (!isJsonValue(payload) || !isRecord(payload)) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  const title = payload.title;
  const sourceAssetIds = payload.sourceAssetIds;
  const createRequestId = payload.createRequestId;
  if (
    (title !== undefined &&
      (typeof title !== 'string' ||
        title.trim().length === 0 ||
        title.length > 512)) ||
    (createRequestId !== undefined &&
      (typeof createRequestId !== 'string' ||
        !/^[A-Za-z0-9._-]{1,160}$/u.test(createRequestId))) ||
    (sourceAssetIds !== undefined &&
      (!Array.isArray(sourceAssetIds) ||
        sourceAssetIds.length > 128 ||
        sourceAssetIds.some(
          (assetId) => typeof assetId !== 'string' || !assetId.trim(),
        ) ||
        new Set(sourceAssetIds).size !== sourceAssetIds.length))
  ) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(sourceAssetIds === undefined ? {} : { sourceAssetIds }),
    ...(createRequestId === undefined ? {} : { createRequestId }),
  };
}

function parseBoundAssetId(payload: JsonValue | undefined): string {
  if (
    !isJsonValue(payload) ||
    !isRecord(payload) ||
    typeof payload.assetId !== 'string' ||
    !payload.assetId.trim()
  ) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return payload.assetId;
}

export interface LearningOutlineWorkbenchRuntimeOwner {
  readonly learningOutlineService: LearningOutlineServiceApi;
}

function requireRuntimeOwner(
  provider: MainWorkbenchProvider | undefined,
): LearningOutlineWorkbenchRuntimeOwner {
  if (!(provider instanceof LearningOutlineWorkbenchProvider)) {
    throw new Error('Learning Outline Workbench Provider 尚未注册');
  }
  return provider;
}

export const learningOutlineMainWorkbenchContribution =
  composeMainWorkbenchContribution(
    learningOutlineWorkbenchManifest,
    (context) => {
      if (
        !context.attachmentService ||
        !context.projectConversationService ||
        !context.agentWorkspaces
      ) {
        throw new Error('Learning Outline Workbench 缺少通用运行时依赖');
      }
      const service = new LearningOutlineService(
        context.assetService,
        context.assetLookup,
        context.attachmentService,
        context.associationService,
        context.projectLookup,
        context.projectConversationService,
        context.agentWorkspaces,
      );
      return new LearningOutlineWorkbenchProvider(
        service,
        context.workbenchEvents,
      );
    },
    [
      {
        id: 'builtin.learning-outline.brief-attachment',
        registerAttachmentTypes({ attachments }): void {
          attachments.register({
            typeId: LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
            version: LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
            isMetadata: isLearningOutlineBriefAttachmentMetadata,
          });
        },
      },
      {
        id: 'builtin.learning-outline.generation',
        registerActions(context): void {
          const service = requireRuntimeOwner(
            context.provider,
          ).learningOutlineService;
          context.actions.register(
            learningOutlineActions.createDraft,
            async (projectId, payload) =>
              (await service.createDraft(
                projectId,
                parseCreateDraftPayload(payload),
              )) as unknown as JsonValue,
          );
          context.actions.register(
            learningOutlineActions.getBriefState,
            async (projectId, payload) => {
              const assetId = parseBoundAssetId(payload);
              await service.startBriefMonitor(projectId, assetId);
              await service.flushBrief(assetId);
              return service.getBriefState(assetId) as unknown as JsonValue;
            },
          );
        },
        registerGeneration(context): void {
          context.definitions.register(
            createLearningOutlineIntakeTaskDefinitionV1(
              context.conversationContexts,
              requireRuntimeOwner(context.provider).learningOutlineService,
            ),
          );
        },
        start(context) {
          const service = requireRuntimeOwner(
            context.provider,
          ).learningOutlineService;
          return service;
        },
      },
    ],
  );
