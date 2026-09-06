import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { learningOutlineWorkbenchManifest } from './shared';
import { learningOutlineIntakeMode } from './conversation/intake-mode';
import {
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_INTAKE_MODE_ID,
  learningOutlineActions,
} from './shared';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import { isAssetSnapshot } from '../../shared/assets';
import { isConversationRecord } from '../../shared/project-conversations';
import { LearningOutlineSourceSetup } from './outline-source-setup';

export const learningOutlineRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: learningOutlineWorkbenchManifest,
    conversationModes: [learningOutlineIntakeMode],
    generationTools: [
      {
        id: 'study-outline',
        label: '学习大纲',
        description: '整理章节与学习路线',
        order: 20,
        requiresSources: true,
        sourceScope: 'generated',
        acceptsSource: (asset) => asset.mediaType === MIND_MAP_ASSET_MEDIA_TYPE,
        setup: LearningOutlineSourceSetup,
        async activate({ projectId, sourceAssets, requestId }) {
          if (sourceAssets.length !== 1 || !sourceAssets[0]) {
            throw new Error('学习大纲一次只能选择一份思维导图。');
          }
          const sourceAsset = sourceAssets[0];
          const result = await window.learningCompanion.invokeWorkbenchAction({
            actionId: learningOutlineActions.createDraft,
            projectId,
            payload: {
              title: `${sourceAsset.name} · 学习大纲`,
              ...(requestId ? { createRequestId: requestId } : {}),
              sourceAssetIds: [sourceAsset.id],
            },
          });
          if (
            typeof result !== 'object' ||
            result === null ||
            Array.isArray(result)
          ) {
            throw new Error('学习大纲草稿响应无效');
          }
          const record = result as Record<string, unknown>;
          if (
            !isAssetSnapshot(record.asset) ||
            !isConversationRecord(record.conversation) ||
            record.asset.projectId !== projectId ||
            record.asset.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE ||
            record.asset.creationKind !== 'generated' ||
            record.conversation.boundAssetId !== record.asset.id ||
            record.conversation.modeId !== LEARNING_OUTLINE_INTAKE_MODE_ID
          ) {
            throw new Error('学习大纲草稿响应无效');
          }
          const assetId = record.asset.id;
          return {
            asset: record.asset,
            conversation: {
              conversationId: record.conversation.id,
              modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
              boundAssetId: assetId,
            },
          };
        },
      },
    ],
    load: async () =>
      (await import('./renderer')).learningOutlineRendererWorkbenchModule,
  });
