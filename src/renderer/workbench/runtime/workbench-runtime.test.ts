import { describe, expect, it, vi } from 'vitest';

import {
  CORE_FACILITY_VERSION,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import type { AssetWorkbenchManifest } from '../../../shared/workbench/manifest';
import {
  findTextSelectionInput,
  interactionFromTextSelection,
} from '../../../shared/workbench/selection';
import { plainTextWorkbenchManifest } from '../../../workbenches/plain-text/shared';
import { WorkbenchRuntime } from './workbench-runtime';

const identity = {
  projectId: 'project-1',
  assetId: 'asset-1',
  workbenchId: 'builtin.plain-text',
  sessionId: 'session-1',
};

const regionSelectionFacilityId = 'test.input.region-selection';
const regionAnchorType = 'test.region';

function createRegionSelectionFixture(): {
  manifest: AssetWorkbenchManifest;
  runtime: WorkbenchRuntime;
} {
  const facilityRegistry =
    createCoreWorkbenchFacilityDefinitionRegistry();

  facilityRegistry.register({
    id: regionSelectionFacilityId,
    version: CORE_FACILITY_VERSION,
    role: 'input',
    validateOptions: (value) => value === undefined,
    validateInput: (value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      ) {
        return false;
      }

      const candidate = value as Record<string, unknown>;

      return ['x', 'y', 'width', 'height'].every(
        (key) => typeof candidate[key] === 'number',
      );
    },
    inputCardinality: 'one',
  });

  return {
    manifest: {
      ...plainTextWorkbenchManifest,
      supportedAnchorTypes: [
        ...plainTextWorkbenchManifest.supportedAnchorTypes,
        regionAnchorType,
      ],
      facilities: [
        ...plainTextWorkbenchManifest.facilities,
        {
          id: regionSelectionFacilityId,
          version: CORE_FACILITY_VERSION,
        },
      ],
    },
    runtime: new WorkbenchRuntime(vi.fn(), facilityRegistry),
  };
}

describe('WorkbenchRuntime', () => {
  it('publishes the frozen right-click interaction for other surfaces', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity, plainTextWorkbenchManifest);
    const selection = {
      text: '当前选区',
      target: {
        scope: 'content' as const,
        anchorType: 'plain-text.text-range',
        anchorVersion: 1,
        anchorPayload: {
          ranges: [{ start: 0, end: 4 }],
        },
      },
    };

    expect(
      runtime.openContextMenu(
        identity.sessionId,
        { x: 20, y: 30 },
        interactionFromTextSelection(selection),
      ),
    ).toBe(true);
    const current = runtime.interactionContext();
    expect(
      current && findTextSelectionInput(current)?.text,
    ).toBe('当前选区');
  });

  it('does not publish an interaction from a stale session', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity, plainTextWorkbenchManifest);

    expect(
      runtime.openContextMenu(
        'stale-session',
        { x: 20, y: 30 },
        { inputs: [] },
      ),
    ).toBe(false);
    expect(runtime.interactionContext()?.inputs).toEqual([]);
  });

  it('preserves the pointer-capture policy for embedded content menus', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity, plainTextWorkbenchManifest);

    expect(
      runtime.openContextMenu(
        identity.sessionId,
        { x: 20, y: 30 },
        { inputs: [] },
        { captureOutsidePointer: true },
      ),
    ).toBe(true);
    expect(
      runtime.store.getState().contextMenu?.captureOutsidePointer,
    ).toBe(true);
  });

  it('accepts a newly registered region input without runtime changes', () => {
    const { manifest, runtime } = createRegionSelectionFixture();
    runtime.activate(identity, manifest);

    expect(
      runtime.publishInteraction(identity.sessionId, {
        inputs: [
          {
            type: regionSelectionFacilityId,
            version: CORE_FACILITY_VERSION,
            target: {
              scope: 'content',
              anchorType: regionAnchorType,
              anchorVersion: 1,
              anchorPayload: {
                x: 10,
                y: 20,
                width: 30,
                height: 40,
              },
            },
            payload: {
              x: 10,
              y: 20,
              width: 30,
              height: 40,
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects an input facility that the active manifest did not declare', () => {
    const { runtime } = createRegionSelectionFixture();
    runtime.activate(identity, plainTextWorkbenchManifest);

    expect(
      runtime.publishInteraction(identity.sessionId, {
        inputs: [
          {
            type: regionSelectionFacilityId,
            version: CORE_FACILITY_VERSION,
            payload: {
              x: 10,
              y: 20,
              width: 30,
              height: 40,
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('enforces the input cardinality declared by the facility', () => {
    const { manifest, runtime } = createRegionSelectionFixture();
    runtime.activate(identity, manifest);
    const input = {
      type: regionSelectionFacilityId,
      version: CORE_FACILITY_VERSION,
      payload: {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    };

    expect(
      runtime.publishInteraction(identity.sessionId, {
        inputs: [input, input],
      }),
    ).toBe(false);
  });
});
