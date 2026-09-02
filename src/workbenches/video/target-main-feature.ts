import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  VIDEO_FRAME_REGION_ANCHOR_TYPE,
  VIDEO_FRAME_REGION_ANCHOR_VERSION,
  VIDEO_TIME_RANGE_ANCHOR_TYPE,
  VIDEO_TIME_RANGE_ANCHOR_VERSION,
  isVideoFrameRegionAnchorV1,
  isVideoTimeRangeAnchorV1,
} from './shared';

export const videoTargetMainFeature = Object.freeze({
  id: 'builtin.video.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.video',
      targetType: VIDEO_TIME_RANGE_ANCHOR_TYPE,
      version: VIDEO_TIME_RANGE_ANCHOR_VERSION,
      isPayload: isVideoTimeRangeAnchorV1,
      agent: {
        description: '视频中以秒为单位的闭合时间范围',
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
    targets.register({
      workbenchId: 'builtin.video',
      targetType: VIDEO_FRAME_REGION_ANCHOR_TYPE,
      version: VIDEO_FRAME_REGION_ANCHOR_VERSION,
      isPayload: isVideoFrameRegionAnchorV1,
      agent: {
        description: '视频指定时间帧上的归一化矩形区域',
        payloadSchema: {
          type: 'object',
          required: ['timeSeconds', 'x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'],
          properties: {
            timeSeconds: { type: 'number', minimum: 0 },
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
            height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
            sourceWidth: { type: 'integer', minimum: 1 },
            sourceHeight: { type: 'integer', minimum: 1 },
          },
        },
        examplePayloads: [{
          timeSeconds: 12.5,
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.5,
          sourceWidth: 1920,
          sourceHeight: 1080,
        }],
      },
      describe(payload): string {
        const value = payload as { readonly timeSeconds: number };
        return `${value.timeSeconds} 秒处的画面区域`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
