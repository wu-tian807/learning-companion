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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCreateDraftPayload(payload: JsonValue | undefined): {
  readonly title?: string;
  readonly sourceAssetIds?: readonly string[];
} {
  if (payload === undefined) return {};
  if (!isJsonValue(payload) || !isRecord(payload)) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  const title = payload.title;
  const sourceAssetIds = payload.sourceAssetIds;
  if (
    (title !== undefined &&
      (typeof title !== 'string' || title.trim().length === 0 || title.length > 512)) ||
    (sourceAssetIds !== undefined &&
      (!Array.isArray(sourceAssetIds) ||
        sourceAssetIds.length > 128 ||
        sourceAssetIds.some((assetId) => typeof assetId !== 'string' || !assetId.trim()) ||
        new Set(sourceAssetIds).size !== sourceAssetIds.length))
  ) {
    throw new AppError('INVALID_IPC_REQUEST');
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(sourceAssetIds === undefined ? {} : { sourceAssetIds }),
  };
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
        context.attachmentService,
        context.associationService,
        context.projectLookup,
        context.projectConversationService,
        context.agentWorkspaces,
      );
      return new LearningOutlineWorkbenchProvider(service, context.workbenchEvents);
    },
    [
      {
        id: 'builtin.learning-outline.generation',
        registerActions(context): void {
          const service = requireRuntimeOwner(context.provider).learningOutlineService;
          context.actions.register(learningOutlineActions.createDraft, async (projectId, payload) =>
            (await service.createDraft(
              projectId,
              parseCreateDraftPayload(payload),
            )) as unknown as JsonValue,
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
          const service = requireRuntimeOwner(context.provider).learningOutlineService;
          return service;
        },
      },
    ],
  );
