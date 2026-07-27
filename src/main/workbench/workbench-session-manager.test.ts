import { describe, expect, it, vi } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
  type AssetContentAvailability,
  type ResolvedAssetContent,
} from '../content/content-ref';
import { createAssetSnapshot } from '../assets/asset';
import type {
  AssetRuntimeSnapshot,
  AssetServiceApi,
} from '../assets/asset-service';
import { EmptyAttachmentService } from '../attachments/attachment-service';
import type { MainWorkbenchProvider } from './workbench-session';
import { WorkbenchSessionManager } from './workbench-session-manager';
import { WorkbenchRegistry } from './workbench-registry';
import { EmptyWorkbenchStateRepository } from './workbench-state-repository';

function createProvider(
  id: string,
  supportedMediaTypes: readonly string[],
  requiredContentCapabilities: readonly ContentCapability[] = [],
): MainWorkbenchProvider {
  const manifest: AssetWorkbenchManifest = {
    id,
    version: 1,
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    supportedMediaTypes,
    requiredContentCapabilities,
    supportedAnchorTypes: [],
  };

  return {
    manifest,
    open: vi.fn(async () => ({ payload: { ready: true } })),
    command: vi.fn(async (_context, command) => ({
      payload: { command: command.type },
    })),
    close: vi.fn(async () => undefined),
  };
}

function createAssetRuntime(): AssetRuntimeSnapshot {
  const contentRef = createLocalFileContentRef('/tmp/notes.txt');
  const status = createAssetContentStatus(
    'available',
    new Date('2026-07-27T01:00:00.000Z'),
  );

  return {
    asset: createAssetSnapshot({
      id: 'asset',
      projectId: 'project',
      name: '资料',
      mediaType: 'text/plain',
      contentRef,
      createdTime: new Date('2026-07-27T01:00:00.000Z'),
      lastUsedTime: new Date('2026-07-27T01:00:00.000Z'),
    }),
    content: { ref: contentRef, status },
  };
}

function createAssetService(
  availability: AssetContentAvailability = 'available',
) {
  const snapshot = createAssetRuntime();
  const handles: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const resolveContent = vi.fn(async (): Promise<ResolvedAssetContent> => {
    const handle =
      availability === 'available'
        ? {
            capabilities: new Set<ContentCapability>(['read-text']),
            close: vi.fn(async () => undefined),
          }
        : undefined;

    if (handle) {
      handles.push(handle);
    }

    return {
      ref: snapshot.asset.contentRef,
      status: createAssetContentStatus(
        availability,
        new Date('2026-07-27T02:00:00.000Z'),
      ),
      handle,
    };
  });
  const service = {
    get: vi.fn((assetId: string) =>
      assetId === snapshot.asset.id ? snapshot : undefined,
    ),
    resolveContent,
  } as unknown as AssetServiceApi;

  return { handles, resolveContent, service };
}

function createManager(
  assetService: AssetServiceApi,
  fallback: MainWorkbenchProvider,
  provider?: MainWorkbenchProvider,
) {
  const registry = new WorkbenchRegistry(fallback);

  if (provider) {
    registry.register(provider);
  }

  return new WorkbenchSessionManager(
    assetService,
    registry,
    new EmptyAttachmentService(),
    new EmptyWorkbenchStateRepository(),
    { createId: () => 'session' },
  );
}

describe('WorkbenchSessionManager', () => {
  it('opens a matched provider, forwards commands and closes resources', async () => {
    const fallback = createProvider('fallback', ['*/*']);
    const plainText = createProvider(
      'plain-text',
      ['text/plain'],
      ['read-text'],
    );
    const { handles, service } = createAssetService();
    const manager = createManager(service, fallback, plainText);

    await expect(manager.open('asset')).resolves.toMatchObject({
      sessionId: 'session',
      workbenchId: 'plain-text',
      availability: 'available',
      payload: { ready: true },
    });
    await expect(
      manager.command('session', { type: 'navigate' }),
    ).resolves.toEqual({ payload: { command: 'navigate' } });

    await manager.close('session');
    await manager.close('session');

    expect(plainText.close).toHaveBeenCalledOnce();
    expect(handles[0]?.close).toHaveBeenCalledOnce();
    expect(manager.getActiveSessionId()).toBeUndefined();
  });

  it('uses fallback for unavailable content', async () => {
    const fallback = createProvider('fallback', ['*/*']);
    const plainText = createProvider('plain-text', ['text/plain']);
    const { service } = createAssetService('missing');
    const manager = createManager(service, fallback, plainText);

    await expect(manager.open('asset')).resolves.toMatchObject({
      workbenchId: 'fallback',
      availability: 'missing',
    });
    expect(fallback.open).toHaveBeenCalledWith(
      expect.objectContaining({ selectionReason: 'content-unavailable' }),
    );
    expect(plainText.open).not.toHaveBeenCalled();
  });

  it('rejects commands for missing and expired sessions', async () => {
    const fallback = createProvider('fallback', ['*/*']);
    const { service } = createAssetService();
    const manager = createManager(service, fallback);

    await expect(
      manager.command('missing', { type: 'noop' }),
    ).rejects.toThrow('WORKBENCH_SESSION_NOT_FOUND');
    await manager.open('asset');
    await expect(
      manager.command('old', { type: 'noop' }),
    ).rejects.toThrow('WORKBENCH_SESSION_EXPIRED');
  });

  it('releases a pending open superseded by closeActive', async () => {
    const fallback = createProvider('fallback', ['*/*']);
    const snapshot = createAssetRuntime();
    let finishResolve: (() => void) | undefined;
    const close = vi.fn(async () => undefined);
    const service = {
      get: vi.fn(() => snapshot),
      resolveContent: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finishResolve = resolve;
        });
        return {
          ref: snapshot.asset.contentRef,
          status: createAssetContentStatus(
            'available',
            new Date('2026-07-27T02:00:00.000Z'),
          ),
          handle: {
            capabilities: new Set<ContentCapability>(),
            close,
          },
        };
      }),
    } as unknown as AssetServiceApi;
    const manager = createManager(service, fallback);

    const opening = manager.open('asset');
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));
    await manager.closeActive();
    finishResolve?.();

    await expect(opening).rejects.toThrow('OPERATION_SUPERSEDED');
    expect(close).toHaveBeenCalledOnce();
    expect(manager.getActiveSessionId()).toBeUndefined();
  });
});
