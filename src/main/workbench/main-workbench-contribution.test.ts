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
  supportedTargetTypes: [],
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

  it('shuts down composed feature runtimes once in reverse order', async () => {
    const calls: string[] = [];
    const contribution = composeMainWorkbenchContribution(
      manifest,
      vi.fn() as never,
      [
        {
          id: 'test.first',
          start: () => ({
            shutdown: async () => {
              calls.push('first');
            },
            dispose: () => undefined,
          }),
        },
        {
          id: 'test.second',
          start: () => ({
            shutdown: async () => {
              calls.push('second');
            },
            dispose: () => undefined,
          }),
        },
      ],
    );
    const runtime = contribution.start?.({} as never);

    const first = runtime?.shutdown?.();
    const second = runtime?.shutdown?.();
    expect(second).toBe(first);
    await first;

    expect(calls).toEqual(['second', 'first']);
  });

  it('continues shutting down earlier runtimes after a later runtime fails', async () => {
    const calls: string[] = [];
    const failure = new Error('shutdown failed');
    const contribution = composeMainWorkbenchContribution(
      manifest,
      vi.fn() as never,
      [
        {
          id: 'test.first',
          start: () => ({
            shutdown: async () => {
              calls.push('first');
            },
            dispose: () => undefined,
          }),
        },
        {
          id: 'test.second',
          start: () => ({
            shutdown: async () => {
              calls.push('second');
              throw failure;
            },
            dispose: () => undefined,
          }),
        },
      ],
    );

    const runtime = contribution.start?.({} as never);
    await expect(runtime?.shutdown?.()).rejects.toBe(failure);
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
