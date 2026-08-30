import { describe, expect, it, vi } from 'vitest';

import {
  ApplicationRuntime,
  type ApplicationRuntimeResources,
} from './application-runtime';

function createResources(
  closeActive: () => Promise<void> = async () => undefined,
) {
  return {
    agentProviderService: {
      dispose: vi.fn(async () => undefined),
    },
    databaseContext: { close: vi.fn() },
    codexRuntimeService: {
      shutdown: vi.fn(async () => undefined),
    },
    contentResourceService: { dispose: vi.fn() },
    externalLibraryService: {
      shutdown: vi.fn(async () => undefined),
    },
    generationTaskService: { unloadProject: vi.fn() },
    sandboxFrameInteractionBridge: { dispose: vi.fn() },
    workbenchSessionService: {
      closeActive: vi.fn(closeActive),
    },
    disposeContentProtocol: vi.fn(),
    disposeIpc: vi.fn(),
    shutdownWorkbenchFeatures: vi.fn(async () => undefined),
    disposeWorkbenchFeatures: vi.fn(),
    disposeAssetAggregateTracking: vi.fn(),
  };
}

describe('ApplicationRuntime', () => {
  it('coalesces concurrent Workbench close requests', async () => {
    let finishClose: (() => void) | undefined;
    const resources = createResources(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );

    const first = runtime.closeActiveWorkbench();
    const second = runtime.closeActiveWorkbench();

    expect(second).toBe(first);
    expect(
      resources.workbenchSessionService.closeActive,
    ).toHaveBeenCalledOnce();
    finishClose?.();
    await first;
  });

  it('shuts down Workbench and external tasks only once', async () => {
    const resources = createResources();
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );

    const first = runtime.shutdown();
    const second = runtime.shutdown();

    expect(second).toBe(first);
    await first;
    expect(
      resources.workbenchSessionService.closeActive,
    ).toHaveBeenCalledOnce();
    expect(
      resources.externalLibraryService.shutdown,
    ).toHaveBeenCalledOnce();
    expect(resources.shutdownWorkbenchFeatures).toHaveBeenCalledOnce();
    expect(
      resources.generationTaskService.unloadProject,
    ).toHaveBeenCalledOnce();
    expect(
      resources.codexRuntimeService.shutdown,
    ).toHaveBeenCalledOnce();
    expect(
      resources.agentProviderService.dispose,
    ).toHaveBeenCalledOnce();
    expect(
      resources.agentProviderService.dispose.mock.invocationCallOrder[0],
    ).toBeLessThan(
      resources.codexRuntimeService.shutdown.mock.invocationCallOrder[0]!,
    );
    expect(
      resources.workbenchSessionService.closeActive.mock.invocationCallOrder[0],
    ).toBeLessThan(
      resources.shutdownWorkbenchFeatures.mock.invocationCallOrder[0]!,
    );
  });

  it('still shuts down Workbench features when closing the active session fails', async () => {
    const closeFailure = new Error('close failed');
    const resources = createResources(async () => {
      throw closeFailure;
    });
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );

    await expect(runtime.shutdown()).rejects.toBe(closeFailure);

    expect(resources.shutdownWorkbenchFeatures).toHaveBeenCalledOnce();
    expect(resources.externalLibraryService.shutdown).toHaveBeenCalledOnce();
    expect(resources.agentProviderService.dispose).toHaveBeenCalledOnce();
  });

  it('waits for GenerationTask shutdown before completing', async () => {
    const resources = createResources();
    let finishGenerationShutdown: (() => void) | undefined;
    resources.generationTaskService.unloadProject.mockImplementationOnce(
      () =>
        new Promise<void>((resolvePromise) => {
          finishGenerationShutdown = resolvePromise;
        }),
    );
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );
    let shutdownSettled = false;

    const shutdown = runtime.shutdown().then(() => {
      shutdownSettled = true;
    });
    await vi.waitFor(() =>
      expect(finishGenerationShutdown).toBeTypeOf('function'),
    );
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    finishGenerationShutdown!();
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });

  it('disposes application resources idempotently', () => {
    const resources = createResources();
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );

    expect(runtime.interactionBridge).toBe(
      resources.sandboxFrameInteractionBridge,
    );
    expect(runtime.codexRuntime).toBe(
      resources.codexRuntimeService,
    );
    expect(runtime.agentProviders).toBe(
      resources.agentProviderService,
    );
    runtime.dispose();
    runtime.dispose();

    expect(resources.disposeContentProtocol).toHaveBeenCalledOnce();
    expect(
      resources.disposeAssetAggregateTracking,
    ).toHaveBeenCalledOnce();
    expect(
      resources.contentResourceService.dispose,
    ).toHaveBeenCalledOnce();
    expect(resources.disposeIpc).toHaveBeenCalledOnce();
    expect(
      resources.disposeWorkbenchFeatures,
    ).toHaveBeenCalledOnce();
    expect(
      resources.sandboxFrameInteractionBridge.dispose,
    ).toHaveBeenCalledOnce();
    expect(resources.databaseContext.close).toHaveBeenCalledOnce();
  });
});
