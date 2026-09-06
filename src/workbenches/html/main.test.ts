// @vitest-environment jsdom
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTextRevision } from '../../main/content/text-content';
import type { WorkbenchCommand } from '../../shared/workbench/protocol';
import { createHtmlDomTarget, createHtmlQuoteTarget, htmlFrameCommands } from './shared';
import { HtmlAgentEditingService } from './editing/html-agent-editing-service';
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
        openByteStream: vi.fn(async () => ({
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
          byteLength: 0,
        })),
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
    vi.unstubAllGlobals();
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
          openByteStream: vi.fn(async () => ({
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(sourceBytes);
                controller.close();
              },
            }),
            byteLength: sourceBytes.byteLength,
          })),
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
            targetPayload: expect.objectContaining({
              frameUrl: 'learning-content://resource/token',
            }),
          }),
        }),
      }),
    );
  });

  it('materializes a writable Workbench reference before the first draft exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'html-reference-'));
    const sourcePath = join(root, 'lesson.html');
    const source = '<html><body><p>Original</p></body></html>';
    const bytes = new TextEncoder().encode(source);
    await writeFile(sourcePath, bytes);
    await chmod(sourcePath, 0o400);
    const editing = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({
          id: 'asset-1',
          projectId: 'project-1',
          mediaType: 'text/html',
        }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: vi.fn() } as never,
    );
    const provider = new HtmlWorkbenchProvider(
      {} as never,
      {} as never,
      editing,
    );

    try {
      const materialized = await provider.materializeContent({
        asset: {
          id: 'asset-1',
          projectId: 'project-1',
          mediaType: 'text/html',
        },
        content: { location: { absolutePath: sourcePath } },
      } as never);

      expect(materialized.absolutePath).not.toBe(sourcePath);
      await expect(readFile(materialized.absolutePath, 'utf8')).resolves.toBe(
        source,
      );
      expect((await stat(materialized.absolutePath)).mode & 0o200).not.toBe(0);
    } finally {
      await editing.discard('project-1', 'asset-1').catch(() => undefined);
      await chmod(sourcePath, 0o600).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
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

  it('disables continuous edit animation when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const { provider, context, frameScriptExecutor } = await createProvider();
    document.body.innerHTML = '<main id="lesson">Before</main>';
    document.getElementById('lesson')!.getBoundingClientRect = () => ({
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

    await provider.command(context, {
      type: 'html.edit-visual.show',
      payload: { target, revision: 1, phase: 'scanning' },
    });

    const visual = document.querySelector(
      '[data-learning-companion-html-agent-edit="scanning"]',
    );
    expect(
      visual?.querySelector<HTMLElement>('[data-html-edit-wave-sweep]')?.style
        .animation,
    ).toBe('none');
    expect(visual?.querySelector('feTurbulence animate')).toBeNull();
  });

  it('routes stable and legacy root anchors to the current session root', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    const stable = createHtmlDomTarget({
      element: { path: [1], tagName: 'p', textQuote: '当前根文档' },
    });
    const legacy = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/expired-token',
      element: { path: [2], tagName: 'p', textQuote: '旧会话根文档' },
    });

    for (const [target, revision] of [[stable, 1], [legacy, 2]] as const) {
      await provider.command(context, {
        type: htmlAnchorCommands.highlight,
        payload: { target, revision, reveal: true, durationMs: 2_800 },
      });
    }

    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      1, 'session-1', expect.any(String), undefined,
    );
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      2, 'session-1', expect.any(String), undefined,
    );
  });

  it('routes edit visuals through the same stable root and nested-frame policy', async () => {
    const { provider, context, frameScriptExecutor } = await createProvider();
    const stableRoot = createHtmlDomTarget({
      element: { path: [1], tagName: 'p', textQuote: '当前根文档' },
    });
    const legacyRoot = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/expired-token',
      element: { path: [2], tagName: 'p', textQuote: '旧会话根文档' },
    });
    const nestedFrame = createHtmlDomTarget({
      frameUrl: 'https://widgets.example.com/chapter',
      element: { path: [3], tagName: 'p', textQuote: '嵌套文档' },
    });

    for (const [target, revision] of [
      [stableRoot, 1],
      [legacyRoot, 2],
      [nestedFrame, 3],
    ] as const) {
      await provider.command(context, {
        type: 'html.edit-visual.show',
        payload: { target, revision, phase: 'scanning' },
      });
    }

    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.any(String),
      undefined,
    );
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.any(String),
      undefined,
    );
    expect(frameScriptExecutor.executeJavaScript).toHaveBeenNthCalledWith(
      3,
      'session-1',
      expect.any(String),
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
});
