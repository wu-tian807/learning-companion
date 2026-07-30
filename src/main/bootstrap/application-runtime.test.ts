import { describe, expect, it, vi } from 'vitest';

import {
  ApplicationRuntime,
  type ApplicationRuntimeResources,
} from './application-runtime';

function createResources(
  closeActive: () => Promise<void> = async () => undefined,
) {
  return {
    databaseContext: { close: vi.fn() },
    contentResourceService: { dispose: vi.fn() },
    externalLibraryService: {
      shutdown: vi.fn(async () => undefined),
    },
    sandboxFrameInteractionBridge: { dispose: vi.fn() },
    workbenchSessionManager: {
      closeActive: vi.fn(closeActive),
    },
    disposeContentProtocol: vi.fn(),
    disposeIpc: vi.fn(),
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
      resources.workbenchSessionManager.closeActive,
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
      resources.workbenchSessionManager.closeActive,
    ).toHaveBeenCalledOnce();
    expect(
      resources.externalLibraryService.shutdown,
    ).toHaveBeenCalledOnce();
  });

  it('disposes application resources idempotently', () => {
    const resources = createResources();
    const runtime = new ApplicationRuntime(
      resources as unknown as ApplicationRuntimeResources,
    );

    expect(runtime.interactionBridge).toBe(
      resources.sandboxFrameInteractionBridge,
    );
    runtime.dispose();
    runtime.dispose();

    expect(resources.disposeContentProtocol).toHaveBeenCalledOnce();
    expect(
      resources.contentResourceService.dispose,
    ).toHaveBeenCalledOnce();
    expect(resources.disposeIpc).toHaveBeenCalledOnce();
    expect(
      resources.sandboxFrameInteractionBridge.dispose,
    ).toHaveBeenCalledOnce();
    expect(resources.databaseContext.close).toHaveBeenCalledOnce();
  });
});
