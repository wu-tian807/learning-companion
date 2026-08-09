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
} from '../../../workbenches/html/main-facility-adapters';
import { MainFacilityAdapterRegistry } from './main-facility-adapter-registry';
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
  const executeJavaScript = vi.fn(async () => selection);
  const frame = {
    url,
    parent,
    detached: false,
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
  const adapterRegistry = new MainFacilityAdapterRegistry(
    facilityRegistry,
  );
  adapterRegistry.register(new HtmlContextMenuFacilityAdapter());
  adapterRegistry.register(new HtmlTextSelectionFacilityAdapter());
  const logger = { error: vi.fn() };
  const bridge = new SandboxFrameInteractionBridge(
    bindingRegistry,
    adapterRegistry,
    facilityRegistry,
    {
      schedule: (task) => task(),
      logger,
    },
  );
  const webContents = new TestWebContents(1);
  bridge.attach(webContents as unknown as WebContents);

  return {
    adapterRegistry,
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
});
