import { defineRendererWorkbenchContribution } from '../../renderer/workbench/renderer-workbench-contribution';
import { learningOutlineWorkbenchManifest } from './shared';
import { learningOutlineIntakeMode } from './conversation/intake-mode';
import {
  LEARNING_OUTLINE_INTAKE_MODE_ID,
  learningOutlineActions,
} from './shared';

export const learningOutlineRendererWorkbenchContribution =
  defineRendererWorkbenchContribution({
    manifest: learningOutlineWorkbenchManifest,
    conversationModes: [learningOutlineIntakeMode],
    generationTools: [
      {
        id: 'study-outline',
        label: '学习提纲',
        description: '整理章节与学习路线',
        requiresSources: true,
        async activate({ projectId, sourceAssets }) {
          const result = await window.learningCompanion.invokeWorkbenchAction({
            actionId: learningOutlineActions.createDraft,
            projectId,
            payload: {
              sourceAssetIds: sourceAssets.map(({ id }) => id),
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
          const asset = record.asset;
          const conversation = record.conversation;
          if (
            typeof asset !== 'object' ||
            asset === null ||
            Array.isArray(asset) ||
            typeof conversation !== 'object' ||
            conversation === null ||
            Array.isArray(conversation) ||
            typeof (asset as Record<string, unknown>).id !== 'string' ||
            typeof (conversation as Record<string, unknown>).id !== 'string'
          ) {
            throw new Error('学习大纲草稿响应无效');
          }
          const assetId = (asset as Record<string, unknown>).id as string;
          return {
            assetId,
            conversationId: (conversation as Record<string, unknown>).id as string,
            modeId: LEARNING_OUTLINE_INTAKE_MODE_ID,
            boundAssetId: assetId,
          };
        },
      },
    ],
    load: async () =>
      (await import('./renderer')).learningOutlineRendererWorkbenchModule,
  });
