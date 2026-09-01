import { describe, expect, it, vi } from 'vitest';

import { AnchorRegistry } from '../../main/attachments/anchor-registry';
import { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import { GenerationTaskDefinitionRegistry } from '../../main/generation/generation-task-definition-registry';
import { WorkbenchConversationContextProviderRegistry } from '../../main/conversation/workbench-conversation-context-provider-registry';
import { AgentFunctionToolRegistry } from '../../main/agents/function-tools/agent-function-tool-registry';
import { ExternalLibraryRegistry } from '../../main/external-libraries/external-library-registry';
import { ExternalLibraryLifecycleRegistry } from '../../main/external-libraries/external-library-lifecycle';
import { ExternalLibraryRuntimeSetupRegistry } from '../../main/external-libraries/external-library-runtime-setup';
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
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../shared/workbench-conversation';
import {
  AI_ANNOTATION_ATTACHMENT_TYPE,
  AI_ANNOTATION_ATTACHMENT_VERSION,
} from '../document-ai/ai-annotation-attachment';
import { DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID } from '../document-ai/document-conversation-context';
import { EPUB_CONVERSATION_CONTEXT_PROVIDER_ID } from '../epub/explanations/epub-conversation-context';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from '../html/conversation/html-conversation-context';
import { IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID } from '../image/explanations/image-conversation-context';
import {
  OFFICE_ANCHOR_VERSION,
  OFFICE_REGION_ANCHOR_TYPE,
} from '../office/shared';
import {
  PDF_REGION_ANCHOR_TYPE,
  PDF_REGION_ANCHOR_VERSION,
} from '../pdf/shared';
import { PDF_READ_FUNCTION_TOOL_ID } from '../pdf/agent/pdf-function-tool';
import { VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID } from '../video/conversation/video-conversation-context';
import { VIDEO_READ_FUNCTION_TOOL_ID } from '../video/agent/video-function-tool';
import { MEDIA_DUBBING_VOXCPM2_LIBRARY_ID } from '../media-dubbing/external-libraries/voxcpm2-definition';
import {
  SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
  SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
} from '../media-subtitles/generation/subtitle-translation-instruction';
import { UnsupportedWorkbenchProvider } from '../unsupported/main';
import {
  mainWorkbenchContributions,
  registerMainWorkbenchAgentFunctionTools,
  registerMainWorkbenchAttachments,
  registerMainWorkbenchGeneration,
  registerMainWorkbenchExternalLibraries,
  registerMainWorkbenchProviders,
} from './register-main-workbenches';
import { preloadWorkbenchContributions } from './register-preload-workbench-features';
import {
  registerRendererWorkbenches,
  rendererWorkbenchContributions,
} from './register-renderer-workbenches';

const mainManifests = mainWorkbenchContributions.flatMap(({ manifest }) =>
  manifest ? [manifest] : [],
);

function createRegisteredMainWorkbenchRegistry(): WorkbenchRegistry {
  const providers = new WorkbenchRegistry(
    new UnsupportedWorkbenchProvider(),
    createCoreWorkbenchFacilityDefinitionRegistry(),
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
    generationTasks: { subscribe: vi.fn(() => () => undefined) } as never,
    projectLookup: {} as never,
    stateDatabase: {} as never,
    stateDataDatabase: {} as never,
    sandboxFrameScripts: {} as never,
    workbenchEvents: {} as never,
  });
  return providers;
}

describe('Workbench contribution catalogs', () => {
  it('keeps Main, Preload, and Renderer Workbench roots aligned', () => {
    expect(mainManifests.map(({ id }) => id)).toEqual(
      rendererWorkbenchContributions.map(({ manifest }) => manifest.id),
    );
    expect(mainManifests.map(({ id }) => id)).toEqual(
      preloadWorkbenchContributions.map(({ id }) => id),
    );
    expect(new Set(mainWorkbenchContributions.map(({ id }) => id)).size).toBe(
      mainWorkbenchContributions.length,
    );
  });

  it('registers every Main provider and its owned adapters', () => {
    const providers = createRegisteredMainWorkbenchRegistry();

    for (const manifest of mainManifests) {
      expect(providers.get(manifest.id)?.manifest).toBe(manifest);
    }
    expect(
      providers
        .get('builtin.html')
        ?.facilityAdapters?.find(
          (adapter) =>
            adapter.facilityId === CORE_CONTEXT_MENU_SURFACE_FACILITY_ID &&
            adapter.facilityVersion === CORE_FACILITY_VERSION &&
            adapter.triggers.includes(SANDBOX_CONTEXT_MENU_TRIGGER),
        )?.workbenchId,
    ).toBe('builtin.html');
  });

  it('registers Workbench-owned external components through the same catalog', () => {
    const libraries = new ExternalLibraryRegistry();
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    const runtimeSetups = new ExternalLibraryRuntimeSetupRegistry();

    registerMainWorkbenchExternalLibraries({
      libraries,
      hardware: {
        nvidiaGpuAvailable: false,
        appleSiliconAvailable: false,
      },
      lifecycles,
      runtimeSetups,
    });

    expect(libraries.list().map(({ id }) => id)).toEqual([
      'libreoffice',
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
      'media-subtitles',
    ]);
    expect(libraries.require('media-subtitles').defaultVariantId).toBe('cpu');
    expect(runtimeSetups.find(MEDIA_DUBBING_VOXCPM2_LIBRARY_ID)).toBeDefined();
    expect(lifecycles.find(MEDIA_DUBBING_VOXCPM2_LIBRARY_ID)).toBeDefined();
    expect(
      libraries.selectPackage('media-subtitles', 'win32', 'x64').variantId,
    ).toBe('cpu');
  });

  it('selects the NVIDIA subtitle profile when compatible hardware is present', () => {
    const libraries = new ExternalLibraryRegistry();
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    const runtimeSetups = new ExternalLibraryRuntimeSetupRegistry();

    registerMainWorkbenchExternalLibraries({
      libraries,
      hardware: {
        nvidiaGpuAvailable: true,
        appleSiliconAvailable: false,
      },
      lifecycles,
      runtimeSetups,
    });

    expect(libraries.require('media-subtitles').defaultVariantId).toBe(
      'nvidia',
    );
    expect(
      libraries.selectPackage('media-subtitles', 'win32', 'x64').variantId,
    ).toBe('nvidia');
  });

  it('selects the Metal subtitle profile on Apple Silicon', () => {
    const libraries = new ExternalLibraryRegistry();

    registerMainWorkbenchExternalLibraries({
      libraries,
      hardware: {
        nvidiaGpuAvailable: false,
        appleSiliconAvailable: true,
      },
      lifecycles: new ExternalLibraryLifecycleRegistry(),
      runtimeSetups: new ExternalLibraryRuntimeSetupRegistry(),
    });

    expect(libraries.require('media-subtitles').defaultVariantId).toBe(
      'apple-silicon',
    );
    expect(
      libraries.selectPackage('media-subtitles', 'darwin', 'arm64').variantId,
    ).toBe('apple-silicon');
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
    expect(
      [...loaders.values()].every(({ loader }) => typeof loader === 'function'),
    ).toBe(true);
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
      anchors.get(OFFICE_REGION_ANCHOR_TYPE, OFFICE_ANCHOR_VERSION)?.isPayload({
        pageNumber: 1,
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }),
    ).toBe(true);
  });

  it('registers Workbench-owned Agent tool definitions through standard hooks', () => {
    const functionTools = new AgentFunctionToolRegistry();
    const workbenches = createRegisteredMainWorkbenchRegistry();

    registerMainWorkbenchAgentFunctionTools({ functionTools, workbenches });

    expect(functionTools.get(PDF_READ_FUNCTION_TOOL_ID)).toBeDefined();
    expect(functionTools.get(VIDEO_READ_FUNCTION_TOOL_ID)).toBeDefined();
    expect(functionTools.get('html_begin_edit')).toBeDefined();
    expect(functionTools.get('html_replace_edit')).toBeDefined();
  });

  it('registers Workbench conversation context providers through the same Main catalog', () => {
    const definitions = new GenerationTaskDefinitionRegistry();
    const conversationContexts =
      new WorkbenchConversationContextProviderRegistry();
    const workbenches = createRegisteredMainWorkbenchRegistry();

    registerMainWorkbenchGeneration({
      definitions,
      conversationContexts,
      assets: {} as never,
      artifacts: {} as never,
      associations: {} as never,
      attachments: {} as never,
      externalLibraries: {} as never,
      projects: {} as never,
      workbenches,
    });

    for (const id of [
      DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
      EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
      IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
    ]) {
      expect(conversationContexts.require(id).id).toBe(id);
    }
    expect(
      conversationContexts.require(HTML_CONVERSATION_CONTEXT_PROVIDER_ID).id,
    ).toBe(HTML_CONVERSATION_CONTEXT_PROVIDER_ID);
    expect(
      definitions.require(
        WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
        WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      ).id,
    ).toBe(WORKBENCH_CONVERSATION_TASK_DEFINITION_ID);
    expect(
      definitions.require(
        SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
        SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
      ).id,
    ).toBe(SUBTITLE_TRANSLATION_TASK_DEFINITION_ID);
  });
});
