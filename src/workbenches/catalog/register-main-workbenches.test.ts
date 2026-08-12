import { describe, expect, it, vi } from 'vitest';

import { AnchorRegistry } from '../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import { SANDBOX_CONTEXT_MENU_TRIGGER } from '../../main/workbench/interaction/sandbox-frame-interaction-triggers';
import { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { RendererWorkbenchLoader } from '../../renderer/workbench/renderer-workbench-registry';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../shared/workbench/facilities/core-facilities';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../document-ai/ai-annotation-attachment';
import { OFFICE_ANCHOR_VERSION, OFFICE_REGION_ANCHOR_TYPE } from '../office/shared';
import { PDF_REGION_ANCHOR_TYPE, PDF_REGION_ANCHOR_VERSION } from '../pdf/shared';
import { UnsupportedWorkbenchProvider } from '../unsupported/main';
import {
  mainWorkbenchContributions,
  registerMainWorkbenchAttachments,
  registerMainWorkbenchProviders,
} from './register-main-workbenches';
import {
  registerRendererWorkbenches,
  rendererWorkbenchContributions,
} from './register-renderer-workbenches';

const mainManifests = mainWorkbenchContributions.flatMap(({ manifest }) =>
  manifest ? [manifest] : []);

describe('Workbench contribution catalogs', () => {
  it('keeps Main and Renderer manifests aligned', () => {
    expect(mainManifests.map(({ id }) => id)).toEqual(
      rendererWorkbenchContributions.map(({ manifest }) => manifest.id),
    );
    expect(new Set(mainWorkbenchContributions.map(({ id }) => id)).size).toBe(
      mainWorkbenchContributions.length,
    );
  });

  it('registers every Main provider and its owned adapters', () => {
    const facilityDefinitions = createCoreWorkbenchFacilityDefinitionRegistry();
    const providers = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
      facilityDefinitions,
    );
    registerMainWorkbenchProviders(providers, {
      associationService: {} as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
    });

    for (const manifest of mainManifests) {
      expect(providers.get(manifest.id)?.manifest).toBe(manifest);
    }
    expect(
      providers.get('builtin.html')?.facilityAdapters?.find(
        (adapter) =>
          adapter.facilityId === CORE_CONTEXT_MENU_SURFACE_FACILITY_ID &&
          adapter.facilityVersion === CORE_FACILITY_VERSION &&
          adapter.triggers.includes(SANDBOX_CONTEXT_MENU_TRIGGER),
      )?.workbenchId,
    ).toBe('builtin.html');
  });

  it('registers Renderer loaders for the same manifests', () => {
    const loaders = new Map<
      string,
      { manifest: AssetWorkbenchManifest; loader: RendererWorkbenchLoader }
    >();
    const registerLoader = vi.fn(
      (manifest: AssetWorkbenchManifest, loader: RendererWorkbenchLoader) => {
        loaders.set(manifest.id, { manifest, loader });
      },
    );

    registerRendererWorkbenches({ registerLoader });

    expect([...loaders.keys()]).toEqual(mainManifests.map(({ id }) => id));
    expect([...loaders.values()].every(({ loader }) => typeof loader === 'function')).toBe(true);
  });

  it('registers Attachment and Anchor extensions through the same Main catalog', () => {
    const attachments = new AttachmentRegistry();
    const anchors = new AnchorRegistry();

    registerMainWorkbenchAttachments({ attachments, anchors });

    expect(
      attachments.get(
        AI_ANNOTATION_ATTACHMENT_TYPE,
        AI_ANNOTATION_ATTACHMENT_VERSION,
      ),
    ).toBeDefined();
    expect(
      anchors
        .get(PDF_REGION_ANCHOR_TYPE, PDF_REGION_ANCHOR_VERSION)
        ?.isPayload({ pageNumber: 1, x: 0, y: 0, width: 0.5, height: 0.5 }),
    ).toBe(true);
    expect(
      anchors
        .get(OFFICE_REGION_ANCHOR_TYPE, OFFICE_ANCHOR_VERSION)
        ?.isPayload({
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          width: 0.5,
          height: 0.5,
        }),
    ).toBe(true);
  });
});
