import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  DEFAULT_IMAGE_VIEW_STATE,
  IMAGE_REGION_ANCHOR_TYPE,
  IMAGE_REGION_ANCHOR_VERSION,
  IMAGE_VIEWPORT_ANCHOR_TYPE,
  IMAGE_VIEWPORT_ANCHOR_VERSION,
  isImageRegionAnchorV1,
  isImageWorkbenchViewState,
} from './shared';

export const imageTargetMainFeature = Object.freeze({
  id: 'builtin.image.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.image',
      targetType: IMAGE_VIEWPORT_ANCHOR_TYPE,
      version: IMAGE_VIEWPORT_ANCHOR_VERSION,
      isPayload: isImageWorkbenchViewState,
      agent: {
        description: '图片阅读器中由中心点、缩放与旋转描述的视图',
        payloadSchema: {
          type: 'object',
          required: ['mode', 'centerX', 'centerY', 'scale', 'rotation'],
          properties: {
            mode: { enum: ['fit', 'actual-size', 'manual'] },
            centerX: { type: 'number' },
            centerY: { type: 'number' },
            scale: { type: 'number', minimum: 0.01, maximum: 64 },
            rotation: { enum: [0, 90, 180, 270] },
          },
        },
        examplePayloads: [{ ...DEFAULT_IMAGE_VIEW_STATE }],
      },
      describe(payload): string {
        const value = payload as { readonly mode: string; readonly centerX: number; readonly centerY: number };
        return `${value.mode} 视图，中心 (${value.centerX}, ${value.centerY})`;
      },
    });
    targets.register({
      workbenchId: 'builtin.image',
      targetType: IMAGE_REGION_ANCHOR_TYPE,
      version: IMAGE_REGION_ANCHOR_VERSION,
      isPayload: isImageRegionAnchorV1,
      agent: {
        description: '图片原始像素空间中的归一化矩形区域',
        payloadSchema: {
          type: 'object',
          required: ['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'],
          properties: {
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
            height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
            sourceWidth: { type: 'integer', minimum: 1 },
            sourceHeight: { type: 'integer', minimum: 1 },
          },
        },
        examplePayloads: [{
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.5,
          sourceWidth: 1920,
          sourceHeight: 1080,
        }],
      },
      describe(payload): string {
        const value = payload as { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
        return `区域 (${value.x}, ${value.y}, ${value.width}, ${value.height})`;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
