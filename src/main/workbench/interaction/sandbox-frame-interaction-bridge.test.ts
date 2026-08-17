import { EventEmitter } from 'node:events';

import type {
  ContextMenuParams,
  WebContents,
  WebFrameMain,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../../shared/ipc';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import type { WorkbenchTransportBinding } from '../../../shared/workbench/facilities/transport-binding';
import { htmlWorkbenchManifest } from '../../../workbenches/html/shared';
import {
  HtmlContextMenuFacilityAdapter,
  HtmlTextSelectionFacilityAdapter,
  READ_HTML_CONTEXT_SELECTION_SCRIPT,
  READ_HTML_FRAME_SELECTION_SCRIPT,
} from '../../../workbenches/html/main-facility-adapters';
import { SandboxFrameInteractionBridge } from './sandbox-frame-interaction-bridge';
import { WorkbenchTransportBindingRegistry } from './workbench-transport-binding-registry';

interface TestFrame {
  readonly frame: WebFrameMain;
  readonly executeJavaScript: ReturnType<typeof vi.fn>;
  destroy(): void;
}

class TestWebContents extends EventEmitter {
  readonly id: number;
  readonly send = vi.fn();
  readonly mainFrame = {
    framesInSubtree: [] as WebFrameMain[],
  };
  focusedFrame: WebFrameMain | null = null;
  private destroyed = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function createFrame(
  url: string,
  parent: WebFrameMain | null = null,
  selection = '选中的文字',
): TestFrame {
  let destroyed = false;
  const executeJavaScript = vi.fn(async (script: string) =>
    script === READ_HTML_FRAME_SELECTION_SCRIPT ||
    script === READ_HTML_CONTEXT_SELECTION_SCRIPT
      ? {
          text: selection,
          element: { path: [1], tagName: 'p', textQuote: selection },
          rect: { x: 10, y: 20, width: 80, height: 18 },
        }
      : null,
  );
  const frame = {
    url,
    parent,
    detached: false,
    framesInSubtree: [] as WebFrameMain[],
    isDestroyed: () => destroyed,
    executeJavaScript,
  } as unknown as WebFrameMain;

  return {
    frame,
    executeJavaScript,
    destroy() {
      destroyed = true;
    },
  };
}

function binding(rootUrl: string): WorkbenchTransportBinding {
  return {
    transportId: CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
    transportVersion: CORE_FACILITY_VERSION,
    facilities: [
      {
        id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        version: CORE_FACILITY_VERSION,
      },
      {
        id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        version: CORE_FACILITY_VERSION,
      },
    ],
    payload: { rootUrl },
  };
}

function contextMenuParams(
  frame: WebFrameMain,
): ContextMenuParams {
  return {
    x: 12,
    y: 24,
    frame,
    frameURL: frame.url,
    selectionText: '右键选区',
    linkURL: 'https://example.com/chapter',
    mediaType: 'image',
    srcURL: 'https://example.com/figure.png',
  } as ContextMenuParams;
}

function createFixture() {
  const facilityRegistry =
    createCoreWorkbenchFacilityDefinitionRegistry();
  const bindingRegistry = new WorkbenchTransportBindingRegistry(
    facilityRegistry,
  );
  const adapters = [
    new HtmlContextMenuFacilityAdapter(),
    new HtmlTextSelectionFacilityAdapter(),
  ];
  const logger = { error: vi.fn() };
  const bridge = new SandboxFrameInteractionBridge(
    bindingRegistry,
    facilityRegistry,
    {
      schedule: (task) => task(),
      logger,
    },
  );
  const webContents = new TestWebContents(1);
  bridge.attach(webContents as unknown as WebContents);

  return {
    adapters,
    bindingRegistry,
    bridge,
    logger,
    webContents,
  };
}

describe('SandboxFrameInteractionBridge', () => {
  it('emits generic context and selection events for an owned nested frame', async () => {
    const fixture = createFixture();
    const rootUrl = 'learning-content://resource/token';
    const root = createFrame(rootUrl);
    const child = createFrame(
      'https://widgets.example.com/embed',
      root.frame,
      '嵌套帧选区',
    );
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(rootUrl)],
      fixture.adapters,
    );

    fixture.webContents.emit(
      'context-menu',
      {},
      contextMenuParams(child.frame),
    );

    await vi.waitFor(() =>
      expect(fixture.webContents.send).toHaveBeenCalledTimes(2),
    );
    expect(fixture.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.workbenchFacilityEvent,
      expect.objectContaining({
        sessionId: 'session-1',
        facilityId: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        payload: expect.objectContaining({
          selectionText: '右键选区',
          frameUrl: child.frame.url,
        }),
      }),
    );
    expect(fixture.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.workbenchFacilityEvent,
      expect.objectContaining({
        sessionId: 'session-1',
        facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        payload: expect.objectContaining({
          text: '嵌套帧选区',
          frameUrl: child.frame.url,
        }),
      }),
    );
  });

  it('rejects a similar URL and ambiguous cross-session ownership', async () => {
    const fixture = createFixture();
    const firstRoot =
      createFrame('learning-content://resource/token');
    const similar = createFrame(
      'learning-content://resource/token-copy',
    );
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(firstRoot.frame.url)],
      fixture.adapters,
    );
    fixture.webContents.emit(
      'context-menu',
      {},
      contextMenuParams(similar.frame),
    );
    await Promise.resolve();

    expect(fixture.webContents.send).not.toHaveBeenCalled();

    const nestedRoot = createFrame(
      'learning-content://resource/nested',
      firstRoot.frame,
    );
    fixture.bindingRegistry.registerSession(
      'session-2',
      htmlWorkbenchManifest,
      [binding(nestedRoot.frame.url)],
      fixture.adapters,
    );
    fixture.webContents.emit(
      'context-menu',
      {},
      contextMenuParams(nestedRoot.frame),
    );
    await Promise.resolve();

    expect(fixture.webContents.send).not.toHaveBeenCalled();
  });

  it('captures settled selections once and clears cache with the session', async () => {
    const fixture = createFixture();
    const root = createFrame(
      'learning-content://resource/token',
      null,
      '稳定选区',
    );
    const dispose = fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
      fixture.adapters,
    );
    fixture.webContents.focusedFrame = root.frame;

    fixture.webContents.emit(
      'before-mouse-event',
      {},
      { type: 'mouseUp' },
    );
    await vi.waitFor(() =>
      expect(fixture.webContents.send).toHaveBeenCalledTimes(1),
    );
    fixture.webContents.emit(
      'before-input-event',
      {},
      { type: 'keyUp' },
    );
    await Promise.resolve();

    expect(fixture.webContents.send).toHaveBeenCalledTimes(1);

    dispose();
    fixture.bindingRegistry.registerSession(
      'session-2',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
      fixture.adapters,
    );
    fixture.webContents.emit(
      'before-mouse-event',
      {},
      { type: 'mouseUp' },
    );

    await vi.waitFor(() =>
      expect(fixture.webContents.send).toHaveBeenCalledTimes(2),
    );
  });

  it('drops capture results after disposal and contains adapter errors', async () => {
    const fixture = createFixture();
    const root = createFrame('learning-content://resource/token');
    let release!: (value: string) => void;
    root.executeJavaScript.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const dispose = fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
      fixture.adapters,
    );
    fixture.webContents.focusedFrame = root.frame;
    fixture.webContents.emit(
      'before-mouse-event',
      {},
      { type: 'mouseUp' },
    );
    dispose();
    release('过期选区');
    await Promise.resolve();

    expect(fixture.webContents.send).not.toHaveBeenCalled();

    fixture.bindingRegistry.registerSession(
      'session-2',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
      fixture.adapters,
    );
    root.executeJavaScript.mockRejectedValueOnce(
      new Error('frame destroyed'),
    );
    fixture.webContents.emit(
      'before-mouse-event',
      {},
      { type: 'mouseUp' },
    );

    await vi.waitFor(() =>
      expect(fixture.logger.error).toHaveBeenCalledOnce(),
    );
    expect(fixture.webContents.send).not.toHaveBeenCalled();
  });

  it('removes window listeners when the web contents is destroyed', () => {
    const fixture = createFixture();

    expect(fixture.webContents.listenerCount('context-menu')).toBe(1);
    fixture.webContents.destroy();

    expect(fixture.webContents.listenerCount('context-menu')).toBe(0);
    expect(
      fixture.webContents.listenerCount('before-mouse-event'),
    ).toBe(0);
  });

  it('executes a trusted script only in the exact session root frame', async () => {
    const fixture = createFixture();
    const root = createFrame('learning-content://resource/token');
    const similar = createFrame(
      'learning-content://resource/token-copy',
    );
    fixture.webContents.mainFrame.framesInSubtree.push(
      similar.frame,
      root.frame,
    );
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
    );
    root.executeJavaScript.mockResolvedValueOnce({ found: true });

    await expect(
      fixture.bridge.executeJavaScript(
        'session-1',
        'trusted-anchor-script',
      ),
    ).resolves.toEqual({ found: true });
    expect(root.executeJavaScript).toHaveBeenCalledWith(
      'trusted-anchor-script',
    );
    expect(similar.executeJavaScript).not.toHaveBeenCalled();
  });

  it('executes only in a uniquely addressed descendant of the session root', async () => {
    const fixture = createFixture();
    const root = createFrame('learning-content://resource/token');
    const child = createFrame(
      'https://widgets.example.com/chapter',
      root.frame,
    );
    const unrelated = createFrame(child.frame.url);
    root.frame.framesInSubtree.push(child.frame);
    fixture.webContents.mainFrame.framesInSubtree.push(
      root.frame,
      unrelated.frame,
    );
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
    );
    child.executeJavaScript.mockResolvedValueOnce({ found: true });

    await expect(
      fixture.bridge.executeJavaScript(
        'session-1',
        'trusted-anchor-script',
        { frameUrl: child.frame.url },
      ),
    ).resolves.toEqual({ found: true });
    expect(child.executeJavaScript).toHaveBeenCalledWith(
      'trusted-anchor-script',
    );
    expect(unrelated.executeJavaScript).not.toHaveBeenCalled();

    root.frame.framesInSubtree.push(
      createFrame(child.frame.url, root.frame).frame,
    );
    await expect(
      fixture.bridge.executeJavaScript(
        'session-1',
        'script',
        { frameUrl: child.frame.url },
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });
  });

  it('rejects missing, ambiguous, detached, and destroyed root frames', async () => {
    const fixture = createFixture();
    const rootUrl = 'learning-content://resource/token';
    const first = createFrame(rootUrl);
    const second = createFrame(rootUrl);
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(rootUrl)],
    );

    await expect(
      fixture.bridge.executeJavaScript('session-1', 'script'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });

    fixture.webContents.mainFrame.framesInSubtree.push(
      first.frame,
      second.frame,
    );
    await expect(
      fixture.bridge.executeJavaScript('session-1', 'script'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });

    fixture.webContents.mainFrame.framesInSubtree.splice(1);
    Object.defineProperty(first.frame, 'detached', { value: true });
    await expect(
      fixture.bridge.executeJavaScript('session-1', 'script'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });

    Object.defineProperty(first.frame, 'detached', { value: false });
    first.destroy();
    await expect(
      fixture.bridge.executeJavaScript('session-1', 'script'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });
  });

  it('stops exposing root frames when the web contents is destroyed', async () => {
    const fixture = createFixture();
    const root = createFrame('learning-content://resource/token');
    fixture.webContents.mainFrame.framesInSubtree.push(root.frame);
    fixture.bindingRegistry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding(root.frame.url)],
    );
    fixture.webContents.destroy();

    await expect(
      fixture.bridge.executeJavaScript('session-1', 'script'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });
  });
});
