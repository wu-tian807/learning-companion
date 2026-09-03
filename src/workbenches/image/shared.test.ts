import { describe, expect, it } from 'vitest';

import {
  createImageSaveViewStateCommand,
  createImageRegionTarget,
  createImageViewportTarget,
  DEFAULT_IMAGE_VIEW_STATE,
  imageCommands,
  imageWorkbenchManifest,
  isImageSaveViewStatePayload,
  isImageSaveViewStateResult,
  isImageWorkbenchPayload,
  isImageWorkbenchStateV1,
  isImageWorkbenchViewState,
  isImageRegionAnchorV1,
} from './shared';

describe('Image Workbench shared protocol', () => {
  it('declares the supported image formats and stream capability', () => {
    expect(imageWorkbenchManifest.supportedMediaTypes).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/bmp',
    ]);
    expect(imageWorkbenchManifest.requiredContentCapabilities).toEqual([
      'read-stream',
    ]);
    expect(imageWorkbenchManifest.supportedTargetTypes).toEqual([
      'image.viewport',
      'image.region',
    ]);
  });

  it('creates a stable normalized interest-region anchor', () => {
    const target = createImageRegionTarget({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      sourceWidth: 2000,
      sourceHeight: 1000,
    });
    expect(target).toMatchObject({
      scope: 'content',
      targetType: 'image.region',
      targetVersion: 1,
    });
    expect(isImageRegionAnchorV1(target.targetPayload)).toBe(true);
    const payload = target.targetPayload as unknown as Record<string, unknown>;
    expect(isImageRegionAnchorV1({ ...payload, x: 0.8, width: 0.3 })).toBe(false);
    expect(isImageRegionAnchorV1({ ...payload, width: 0 })).toBe(false);
  });

  it('validates bootstrap and persisted view state', () => {
    expect(isImageWorkbenchViewState(DEFAULT_IMAGE_VIEW_STATE)).toBe(true);
    expect(
      isImageWorkbenchStateV1({
        viewState: {
          mode: 'manual',
          centerX: 0.4,
          centerY: 0.6,
          scale: 2,
          rotation: 90,
        },
      }),
    ).toBe(true);
    expect(
      isImageWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        sourceRevision: 'revision-1',
        viewState: DEFAULT_IMAGE_VIEW_STATE,
      }),
    ).toBe(true);
  });

  it('rejects unsafe URLs and out-of-range view state', () => {
    expect(
      isImageWorkbenchPayload({
        contentUrl: 'file:///Users/test/private.png',
        sourceRevision: 'revision-1',
        viewState: DEFAULT_IMAGE_VIEW_STATE,
      }),
    ).toBe(false);
    expect(
      isImageWorkbenchViewState({
        ...DEFAULT_IMAGE_VIEW_STATE,
        scale: 0,
      }),
    ).toBe(false);
    expect(
      isImageWorkbenchViewState({
        ...DEFAULT_IMAGE_VIEW_STATE,
        rotation: 45,
      }),
    ).toBe(false);
  });

  it('creates and validates the save-view-state command', () => {
    const command = createImageSaveViewStateCommand({
      mode: 'actual-size',
      centerX: 0.5,
      centerY: 0.5,
      scale: 1,
      rotation: 270,
    });

    expect(command.type).toBe(imageCommands.saveViewState);
    expect(isImageSaveViewStatePayload(command.payload)).toBe(true);
    expect(
      isImageSaveViewStateResult({ saved: true, savedTime: 100 }),
    ).toBe(true);
  });

  it('captures the visible image viewport as an AI-ready target', () => {
    expect(createImageViewportTarget(DEFAULT_IMAGE_VIEW_STATE)).toEqual({
      scope: 'content',
      targetType: 'image.viewport',
      targetVersion: 1,
      targetPayload: DEFAULT_IMAGE_VIEW_STATE,
    });
  });
});
