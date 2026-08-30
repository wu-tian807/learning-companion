import { describe, expect, it, vi } from 'vitest';

import type { ContentHandle } from '../../main/content/content-handle';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import type { WorkbenchCommand } from '../../shared/workbench/protocol';
import { HtmlWorkbenchProvider } from './main';
import { htmlAnchorCommands } from './anchor-commands';
import {
  createHtmlDomTarget,
  createHtmlQuoteTarget,
  htmlEditCommands,
  htmlFrameCommands,
} from './shared';
import { htmlEditIndicatorCommands } from './html-edit-indicator-commands';
import { createHtmlSourceCopyInstallFrameScript } from './html-source-copy-frame-script';

type ProviderCommandContext = Parameters<HtmlWorkbenchProvider['command']>[0];
type ProviderOpenContext = Parameters<HtmlWorkbenchProvider['open']>[0];

async function createProvider(
  editing?: ConstructorParameters<typeof HtmlWorkbenchProvider>[2],
  events?: ConstructorParameters<typeof HtmlWorkbenchProvider>[3],
) {
  const frameScriptExecutor = {
    executeJavaScript: vi.fn(async () => ({ found: true })),
  };
  const register = vi.fn<ContentResourceServiceApi['register']>();
  register.mockReturnValue('learning-content://resource/token');
  const resourceService = {
    register,
    revokeSession: vi.fn(),
    handle: vi.fn(),
    dispose: vi.fn(),
  };
  const provider = new HtmlWorkbenchProvider(
    resourceService,
    frameScriptExecutor,
    editing,
    events,
  );
  await provider.open({
    sessionId: 'session-1',
    asset: { id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' },
    selectionReason: 'matched',
    content: {
      handle: {
        capabilities: new Set(['read-bytes', 'read-stream']),
        readBytes: vi.fn(async () => ({
          content: new Uint8Array(),
          revision: 'original',
        })),
        openByteStream: vi.fn(),
      },
    },
    attachments: [],
    state: undefined,
  } as unknown as ProviderOpenContext);
  const context = {
    sessionId: 'session-1',
    asset: { id: 'asset-1', projectId: 'project-1' },
  } as ProviderCommandContext;

  return { provider, context, frameScriptExecutor, resourceService };
}

describe('HtmlWorkbenchProvider commands', () => {
  it('rejects commands outside the current HTML Workbench surface', async () => {
    const { provider, context } = await createProvider();

    await expect(
      provider.command(context, { type: 'unknown.command' } as WorkbenchCommand),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' });

    await expect(
      provider.command(
        { ...context, sessionId: 'expired-session' },
        { type: htmlFrameCommands.installSourceCopy },
      ),
    ).rejects.toThrow();
  });

  it('executes validated anchor highlight and clear commands in the session frame', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    const target = createHtmlDomTarget({
      frameUrl: 'https://widgets.example.com/chapter',
      element: { path: [1], tagName: 'p', textQuote: '锚点正文' },
    });

    await expect(
      provider.command(context, {
        type: htmlAnchorCommands.highlight,
        payload: {
          target,
          revision: 1,
          reveal: true,
          durationMs: 2_800,
        },
      }),
    ).resolves.toEqual({ payload: { found: true } });
    await expect(
      provider.command(context, {
        type: htmlAnchorCommands.clear,
        payload: { target, revision: 1 },
      }),
    ).resolves.toEqual({ payload: { found: true } });

    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.stringContaining('"action":"highlight"'),
      { frameUrl: 'https://widgets.example.com/chapter' },
    );
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.stringContaining('"action":"clear"'),
      { frameUrl: 'https://widgets.example.com/chapter' },
    );
  });

  it('installs source-aware copy behavior in the session root frame', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    frameScriptExecutor.executeJavaScript.mockResolvedValueOnce({
      installed: true,
    } as never);

    await expect(
      provider.command(context, {
        type: htmlFrameCommands.installSourceCopy,
      }),
    ).resolves.toEqual({ payload: { installed: true } });
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenCalledWith(
      'session-1',
      createHtmlSourceCopyInstallFrameScript(),
    );
  });

  it('rejects malformed source-copy and anchor results', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();

    await expect(
      provider.command(context, {
        type: htmlFrameCommands.installSourceCopy,
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    expect(frameScriptExecutor.executeJavaScript).not.toHaveBeenCalled();

    frameScriptExecutor.executeJavaScript.mockResolvedValueOnce(null as never);
    await expect(
      provider.command(context, {
        type: htmlAnchorCommands.clear,
        payload: {
          target: createHtmlQuoteTarget('锚点正文'),
          revision: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('materializes an existing draft and otherwise keeps the original source', async () => {
    const draftEditing = {
      subscribe: vi.fn(() => vi.fn()),
      getDraftSnapshot: vi.fn(async () => ({
        absolutePath: 'D:\\recovery\\draft.html',
        content: '<p>draft</p>',
        status: {},
      })),
    };
    const draftProvider = new HtmlWorkbenchProvider(
      {} as never,
      {} as never,
      draftEditing as never,
    );
    const context = {
      asset: { id: 'asset-1', projectId: 'project-1' },
      content: { location: { absolutePath: 'D:\\source\\lesson.html' } },
    } as never;

    await expect(draftProvider.materializeContent(context)).resolves.toEqual({
      absolutePath: 'D:\\recovery\\draft.html',
      mediaType: 'text/html',
    });

    draftEditing.getDraftSnapshot.mockResolvedValueOnce(undefined as never);
    await expect(draftProvider.materializeContent(context)).resolves.toEqual({
      absolutePath: 'D:\\source\\lesson.html',
      mediaType: 'text/html',
    });
  });

  it('rejects materialization when recovery state cannot be read', async () => {
    const editing = {
      subscribe: vi.fn(() => vi.fn()),
      getDraftSnapshot: vi.fn(async () => {
        throw new Error('damaged recovery');
      }),
    };
    const provider = new HtmlWorkbenchProvider(
      {} as never,
      {} as never,
      editing as never,
    );

    await expect(
      provider.materializeContent({
        asset: { id: 'asset-1', projectId: 'project-1' },
        content: { location: { absolutePath: 'D:\\source\\lesson.html' } },
      } as never),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('rejects opening a preview when recovery state cannot be read', async () => {
    const editing = {
      subscribe: vi.fn(() => vi.fn()),
      getDraftSnapshot: vi.fn(async () => {
        throw new Error('damaged recovery');
      }),
      getDraft: vi.fn(async () => undefined),
    };

    await expect(createProvider(editing as never)).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });
  });

  it('keeps one preview handle that switches from original to the first draft', async () => {
    const state: { draft?: string } = {};
    const editing = {
      subscribe: vi.fn(() => vi.fn()),
      getDraftSnapshot: vi.fn(async () => undefined),
      getDraft: vi.fn(async () => state.draft),
    };
    const { resourceService } = await createProvider(editing as never);
    const registered = resourceService.register.mock.calls[0]?.[1] as
      | ContentHandle
      | undefined;
    if (!registered?.readBytes) throw new Error('Expected preview handle');

    const before = await registered.readBytes();
    state.draft = '<p>first draft</p>';
    const after = await registered.readBytes();

    expect(new TextDecoder().decode(before.content)).toBe('');
    expect(new TextDecoder().decode(after.content)).toBe('<p>first draft</p>');
  });

  it('routes edit commands and preserves structured AppErrors', async () => {
    const status = {
      editable: true,
      hasDraft: true,
      unsynced: true,
      syncRequested: false,
      pending: false,
      stepCount: 1,
      changeCount: 1,
      canUndo: true,
      canRedo: false,
      conflict: null,
      draftRevision: 'draft-1',
    };
    const editing = {
      subscribe: vi.fn(() => vi.fn()),
      getDraftSnapshot: vi.fn(async () => ({
        content: '<p>draft</p>',
        absolutePath: 'D:\\recovery\\draft.html',
        status,
      })),
      requestSync: vi.fn(async () => ({ disposition: 'ready', status })),
    };
    const { provider, context } = await createProvider(editing as never);

    await expect(
      provider.command(context, { type: htmlEditCommands.status }),
    ).resolves.toEqual({ payload: status });
    await expect(
      provider.command(context, { type: htmlEditCommands.sync }),
    ).resolves.toEqual({ payload: { disposition: 'ready', status } });

    const { AppError } = await import('../../main/errors/app-error');
    editing.requestSync.mockRejectedValueOnce(
      new AppError('CONTENT_CHANGED_EXTERNALLY'),
    );
    await expect(
      provider.command(context, { type: htmlEditCommands.sync }),
    ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
  });

  it('executes the independent edit indicator command path', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: { path: [1], tagName: 'p' },
    });

    await expect(
      provider.command(context, {
        type: htmlEditIndicatorCommands.show,
        payload: { target, revision: 1, phase: 'editing' },
      }),
    ).resolves.toEqual({ payload: { found: true } });
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('"channel":"editing"'),
      { frameUrl: 'learning-content://resource/token' },
    );

    const selectorTarget = createHtmlDomTarget({
      frameUrl: 'about:blank',
      element: { path: [1], tagName: 'p' },
    });
    await provider.command(context, {
      type: htmlEditIndicatorCommands.show,
      payload: { target: selectorTarget, revision: 2, phase: 'editing' },
    });
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenLastCalledWith(
      'session-1',
      expect.stringContaining('"channel":"editing"'),
      undefined,
    );

    await expect(
      provider.command(context, {
        type: htmlEditIndicatorCommands.show,
        payload: {
          target: createHtmlQuoteTarget('not allowed'),
          revision: 1,
          phase: 'editing',
        },
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('publishes edit events only to the matching Workbench session', async () => {
    let listener:
      | ((event: {
          type: 'started' | 'ended';
          projectId: string;
          assetId: string;
          editId: string;
          executionId: string;
          target: ReturnType<typeof createHtmlDomTarget>['anchorPayload'];
        }) => void)
      | undefined;
    const editing = {
      subscribe: vi.fn((next: typeof listener) => {
        listener = next;
        return vi.fn();
      }),
      getDraftSnapshot: vi.fn(async () => undefined),
      getDraft: vi.fn(async () => undefined),
    };
    const events = { publish: vi.fn() };
    await createProvider(editing as never, events as never);
    const target = {
      frameUrl: 'learning-content://resource/token',
      element: { path: [1], tagName: 'p' },
    } as const;

    listener?.({
      type: 'started',
      projectId: 'project-1',
      assetId: 'other-asset',
      editId: 'edit-1',
      executionId: 'turn-1',
      target,
    });
    expect(events.publish).not.toHaveBeenCalled();

    listener?.({
      type: 'ended',
      projectId: 'project-1',
      assetId: 'asset-1',
      editId: 'edit-1',
      executionId: 'turn-1',
      target,
    });
    expect(events.publish).toHaveBeenCalledWith({
      sessionId: 'session-1',
      type: 'html.agent-edit.ended',
      payload: expect.objectContaining({
        editId: 'edit-1',
        executionId: 'turn-1',
      }),
    });
  });
});
