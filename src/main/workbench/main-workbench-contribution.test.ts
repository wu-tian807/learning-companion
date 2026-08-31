import { describe, expect, it, vi } from 'vitest';

import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  composeMainWorkbenchContribution,
  type MainWorkbenchFeatureContribution,
} from './main-workbench-contribution';

const manifest = {
  id: 'test.workbench',
  version: 1,
  protocolVersion: 2,
  supportedMediaTypes: ['text/test'],
  requiredContentCapabilities: [],
  supportedAnchorTypes: [],
  facilities: [],
} satisfies AssetWorkbenchManifest;

describe('Main Workbench contribution composition', () => {
  it('runs every owned feature hook in declaration order', () => {
    const calls: string[] = [];
    const features: MainWorkbenchFeatureContribution[] = [
      {
        id: 'test.first',
        registerAttachmentTypes: () => calls.push('first'),
      },
      {
        id: 'test.second',
        registerAttachmentTypes: () => calls.push('second'),
      },
    ];
    const contribution = composeMainWorkbenchContribution(
      manifest,
      vi.fn() as never,
      features,
    );

    contribution.registerAttachmentTypes?.({} as never);

    expect(calls).toEqual(['first', 'second']);
    expect(contribution.features).toEqual(features);
  });

  it('rolls back started features in reverse order without masking the start error', () => {
    const calls: string[] = [];
    const failure = new Error('start failed');
    const contribution = composeMainWorkbenchContribution(
      manifest,
      vi.fn() as never,
      [
        {
          id: 'test.first',
          start: () => ({ dispose: () => calls.push('dispose first') }),
        },
        {
          id: 'test.second',
          start: () => ({ dispose: () => calls.push('dispose second') }),
        },
        {
          id: 'test.failure',
          start: () => {
            throw failure;
          },
        },
      ],
    );

    expect(() => contribution.start?.({} as never)).toThrow(failure);
    expect(calls).toEqual(['dispose second', 'dispose first']);
  });

  it('disposes a composed runtime once in reverse order', () => {
    const calls: string[] = [];
    const contribution = composeMainWorkbenchContribution(
      manifest,
      vi.fn() as never,
      [
        {
          id: 'test.first',
          start: () => ({ dispose: () => calls.push('first') }),
        },
        {
          id: 'test.second',
          start: () => ({ dispose: () => calls.push('second') }),
        },
      ],
    );

    const runtime = contribution.start?.({} as never);
    runtime?.dispose();
    runtime?.dispose();

    expect(calls).toEqual(['second', 'first']);
  });

  it.each([
    [[{ id: '' }, { id: 'test.valid' }]],
    [[{ id: 'test.duplicate' }, { id: 'test.duplicate' }]],
  ])('rejects invalid owned feature identities', (features) => {
    expect(() =>
      composeMainWorkbenchContribution(
        manifest,
        vi.fn() as never,
        features,
      )).toThrow();
  });
});
