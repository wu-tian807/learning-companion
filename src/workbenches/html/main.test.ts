import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchCommand } from '../../shared/workbench/protocol';
import { createHtmlDomTarget, createHtmlQuoteTarget, htmlFrameCommands } from './shared';
import { HtmlWorkbenchProvider } from './main';
import { htmlAnchorCommands } from './anchor-commands';
import { createHtmlSourceCopyInstallFrameScript } from './html-source-copy-frame-script';

type ProviderCommandContext = Parameters<HtmlWorkbenchProvider['command']>[0];
type ProviderOpenContext = Parameters<HtmlWorkbenchProvider['open']>[0];

async function createProvider() {
  const frameScriptExecutor = {
    executeJavaScript: vi.fn(async () => ({ found: true })),
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
