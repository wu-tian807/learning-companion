// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchCommand } from '../../shared/workbench/protocol';
import { createHtmlDomTarget, createHtmlQuoteTarget, htmlFrameCommands } from './shared';
import { HtmlWorkbenchProvider } from './main';
import { htmlAnchorCommands } from './anchor-commands';
import { createHtmlSourceCopyInstallFrameScript } from './html-source-copy-frame-script';

type ProviderCommandContext = Parameters<HtmlWorkbenchProvider['command']>[0];
type ProviderOpenContext = Parameters<HtmlWorkbenchProvider['open']>[0];

async function createProvider() {
  const frameScriptExecutor = {
    executeJavaScript: vi.fn(async (
      _sessionId: string,
      _script: string,
      _target?: { readonly frameUrl: string },
    ): Promise<unknown> => {
      void _sessionId;
      void _script;
      void _target;
      return { found: true };
    }),
  };
  const provider = new HtmlWorkbenchProvider(
    {
      register: vi.fn(() => 'learning-content://resource/token'),
      revokeSession: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    },
    frameScriptExecutor,
  );
  await provider.open({
    sessionId: 'session-1',
    asset: { id: 'asset-1', mediaType: 'text/html' },
    selectionReason: 'matched',
    content: {
      handle: {
        capabilities: new Set(['read-stream']),
        openByteStream: vi.fn(),
      },
    },
    attachments: [],
    state: undefined,
  } as unknown as ProviderOpenContext);
  const context = {
    sessionId: 'session-1',
    asset: { id: 'asset-1' },
  } as ProviderCommandContext;

  return { provider, context, frameScriptExecutor };
}

describe('HtmlWorkbenchProvider commands', () => {
  afterEach(() => {
    const root = globalThis as unknown as Record<string, unknown>;
    const visual = root.__learningCompanionHtmlEditVisualV1 as
      | { cleanup(): void }
      | undefined;
    visual?.cleanup();
    delete root.__learningCompanionHtmlEditVisualV1;
    document.body.replaceChildren();
  });

  it('registers the draft preview and routes applied events to the owning session', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const editingStatus = {
      editable: true,
      hasDraft: true,
      unsynced: true,
      syncRequested: false,
      pending: true,
      stepCount: 0,
      changeCount: 1,
      canUndo: false,
      canRedo: false,
      conflict: null,
      draftRevision: 'draft-1',
    };
    const editing = {
      subscribe: vi.fn((next: typeof listener) => {
        listener = next;
        return () => undefined;
      }),
      getDraft: vi.fn(async () => '<html><body>Draft</body></html>'),
      getDraftSnapshot: vi.fn(async () => ({ status: editingStatus })),
    };
    let registeredHandle: { readBytes?: () => Promise<{ content: Uint8Array }> } | undefined;
    const resourceService = {
      register: vi.fn((_sessionId, handle) => {
        registeredHandle = handle;
        return 'learning-content://resource/token';
      }),
      revokeSession: vi.fn(),
    };
    const events = { publish: vi.fn(), subscribe: vi.fn() };
    const provider = new HtmlWorkbenchProvider(
      resourceService as never,
      { executeJavaScript: vi.fn() },
      editing as never,
      events,
    );
    const sourceBytes = new TextEncoder().encode('Original');
    const opened = await provider.open({
      sessionId: 'session-1',
      asset: {
        id: 'asset-1',
        projectId: 'project-1',
        mediaType: 'text/html',
      },
      selectionReason: 'matched',
      content: {
        handle: {
          capabilities: new Set(['read-bytes', 'read-stream']),
          readBytes: vi.fn(async () => ({ content: sourceBytes, revision: 'source' })),
          openByteStream: vi.fn(),
          close: vi.fn(async () => undefined),
        },
      },
      attachments: [],
      state: undefined,
    } as never);

    expect(opened.payload).toMatchObject({ editing: editingStatus });
    expect(
      new TextDecoder().decode((await registeredHandle?.readBytes?.())?.content),
    ).toContain('Draft');

    listener?.({
      type: 'applied',
      projectId: 'project-1',
      assetId: 'asset-1',
      taskId: 'task-1',
      editId: 'edit-1',
      draftRevision: 'draft-1',
      target: {
        frameUrl: 'about:blank',
        element: { path: [1], tagName: 'body' },
      },
    });

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        type: 'html.agent-edit.applied',
        payload: expect.objectContaining({
          target: expect.objectContaining({
            anchorPayload: expect.objectContaining({
              frameUrl: 'learning-content://resource/token',
            }),
          }),
        }),
      }),
    );
  });

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

  it('renders and clears the agent edit visual on the resolved DOM target', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    document.body.innerHTML = '<main id="lesson">Before</main>';
    const lesson = document.getElementById('lesson')!;
    lesson.getBoundingClientRect = () => ({
      left: 24,
      top: 40,
      right: 344,
      bottom: 160,
      width: 320,
      height: 120,
      x: 24,
      y: 40,
      toJSON: () => ({}),
    });
    frameScriptExecutor.executeJavaScript.mockImplementation(
      async (_sessionId, script) => (0, eval)(script),
    );
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/html',
      element: { path: [1, 0], tagName: 'main', id: 'lesson' },
    });

    await expect(provider.command(context, {
      type: 'html.edit-visual.show',
      payload: { target, revision: 1, phase: 'scanning' },
    })).resolves.toEqual({ payload: { found: true } });
    const scanning = document.querySelector(
      '[data-learning-companion-html-agent-edit="scanning"]',
    );
    expect(scanning).not.toBeNull();
    expect((scanning as HTMLElement).style.left).toBe('24px');
    expect((scanning as HTMLElement).style.width).toBe('320px');
    expect(scanning?.querySelector('feTurbulence')).not.toBeNull();
    expect(scanning?.querySelector('feDisplacementMap')).not.toBeNull();
    expect(
      scanning?.querySelector<HTMLElement>('[data-html-edit-wave-sweep]')
        ?.style.filter,
    ).toContain('url(');

    await expect(provider.command(context, {
      type: 'html.edit-visual.show',
      payload: { target, revision: 2, phase: 'rejected' },
    })).resolves.toEqual({ payload: { found: true } });
    expect(document.querySelectorAll(
      '[data-learning-companion-html-agent-edit="rejected"]',
    )).toHaveLength(1);

    await expect(provider.command(context, {
      type: 'html.edit-visual.clear',
      payload: { target, revision: 3 },
    })).resolves.toEqual({ payload: { found: false } });
    expect(document.querySelector(
      '[data-learning-companion-html-agent-edit]',
    )).toBeNull();
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
});
