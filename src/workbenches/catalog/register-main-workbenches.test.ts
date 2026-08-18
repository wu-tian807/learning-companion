import { describe, expect, it, vi } from 'vitest';

import { AnchorRegistry } from '../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import { GenerationTaskDefinitionRegistry } from '../../main/generation/generation-task-definition-registry';
import { AgentFunctionToolRegistry } from '../../main/agents/function-tools/agent-function-tool-registry';
import { ExternalLibraryRegistry } from '../../main/external-libraries/external-library-registry';
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
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../document-ai/ai-annotation-attachment';
import { OFFICE_ANCHOR_VERSION, OFFICE_REGION_ANCHOR_TYPE } from '../office/shared';
import { PDF_REGION_ANCHOR_TYPE, PDF_REGION_ANCHOR_VERSION } from '../pdf/shared';
import { PDF_READ_FUNCTION_TOOL_ID } from '../pdf/agent/pdf-function-tool';
import { UnsupportedWorkbenchProvider } from '../unsupported/main';
import {
  mainWorkbenchContributions,
  registerMainWorkbenchAgentFunctionTools,
  registerMainWorkbenchAttachments,
  registerMainWorkbenchGeneration,
  registerMainWorkbenchExternalLibraries,
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
      assetService: {
        subscribe: vi.fn(() => () => undefined),
      } as never,
      artifactRegistry: { register: vi.fn() } as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
      sandboxFrameScripts: {} as never,
      workbenchEvents: {} as never,
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

  it('registers Workbench-owned external components through the same catalog', () => {
    const libraries = new ExternalLibraryRegistry();

    registerMainWorkbenchExternalLibraries({
      libraries,
      hardware: { nvidiaGpuAvailable: false },
    });

    expect(libraries.list().map(({ id }) => id)).toEqual([
      'libreoffice',
      'media-subtitles',
    ]);
    expect(libraries.require('media-subtitles').defaultVariantId).toBe(
      'cpu',
    );
    expect(
      libraries.selectPackage('media-subtitles', 'win32', 'x64').variantId,
    ).toBe('cpu');
  });

  it('selects the NVIDIA subtitle profile when compatible hardware is present', () => {
    const libraries = new ExternalLibraryRegistry();

    registerMainWorkbenchExternalLibraries({
      libraries,
      hardware: { nvidiaGpuAvailable: true },
    });

    expect(libraries.require('media-subtitles').defaultVariantId).toBe(
      'nvidia',
    );
    expect(
      libraries.selectPackage('media-subtitles', 'win32', 'x64').variantId,
    ).toBe('nvidia');
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

  it('registers Workbench-owned Agent tools without enabling them globally', () => {
    const functionTools = new AgentFunctionToolRegistry();

    registerMainWorkbenchAgentFunctionTools({ functionTools });

    expect(functionTools.get(PDF_READ_FUNCTION_TOOL_ID)).toBeDefined();
  });

  it('registers the HTML assistant TaskDefinition through the same Main catalog', () => {
    const definitions = new GenerationTaskDefinitionRegistry();

    registerMainWorkbenchGeneration({
      definitions,
      assets: {} as never,
      associations: {} as never,
      attachments: {} as never,
    });

    expect(
      definitions.get(
        HTML_ASSISTANT_TASK_DEFINITION_ID,
        HTML_ASSISTANT_TASK_DEFINITION_VERSION,
      ),
    ).toBeDefined();
  });
});
