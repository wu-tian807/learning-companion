import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  AUDIO_TIME_RANGE_ANCHOR_TYPE,
  AUDIO_TIME_RANGE_ANCHOR_VERSION,
  isAudioTimeRangeAnchorV1,
} from './shared';

export const audioTargetMainFeature = Object.freeze({
  id: 'builtin.audio.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.audio',
      targetType: AUDIO_TIME_RANGE_ANCHOR_TYPE,
      version: AUDIO_TIME_RANGE_ANCHOR_VERSION,
      isPayload: isAudioTimeRangeAnchorV1,
      agent: {
        description: '音频中以秒为单位的闭合时间范围',
        payloadSchema: {
          type: 'object',
          required: ['startSeconds', 'endSeconds'],
          properties: {
            startSeconds: { type: 'number', minimum: 0 },
            endSeconds: { type: 'number', minimum: 0 },
          },
        },
        examplePayloads: [{ startSeconds: 12.5, endSeconds: 18 }],
      },
      describe(payload): string {
        const value = payload as { readonly startSeconds: number; readonly endSeconds: number };
        return `${value.startSeconds}–${value.endSeconds} 秒`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
