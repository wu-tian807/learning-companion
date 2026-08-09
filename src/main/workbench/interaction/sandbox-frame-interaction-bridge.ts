import type {
  ContextMenuParams,
  Event,
  Input,
  MouseInputEvent,
  WebContents,
  WebFrameMain,
} from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc';
import {
  CORE_FACILITY_VERSION,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  isSandboxFrameTransportBindingPayload,
} from '../../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityDefinitionRegistry } from '../../../shared/workbench/facilities/facility-definition-registry';
import type { WorkbenchFacilityEvent } from '../../../shared/workbench/facilities/facility-event';
import type { MainFacilityAdapterRegistry } from './main-facility-adapter-registry';
import {
  SANDBOX_CONTEXT_MENU_TRIGGER,
  SANDBOX_SELECTION_SETTLED_TRIGGER,
} from './sandbox-frame-interaction-triggers';
import type {
  ActiveWorkbenchTransportBinding,
  WorkbenchTransportBindingRegistry,
} from './workbench-transport-binding-registry';

export interface SandboxFrameInteractionBridgeDependencies {
  readonly schedule: (task: () => void) => void;
  readonly logger: Pick<Console, 'error'>;
}

function defaultSchedule(task: () => void): void {
  setTimeout(task, 0);
}

export class SandboxFrameInteractionBridge {
  private readonly attachedWebContents = new Map<number, () => void>();
  private readonly lastPayloadByFacility = new Map<string, string>();
  private readonly schedule: (task: () => void) => void;
  private readonly logger: Pick<Console, 'error'>;
  private readonly unsubscribeBindings: () => void;

  constructor(
    private readonly bindingRegistry: WorkbenchTransportBindingRegistry,
    private readonly adapterRegistry: MainFacilityAdapterRegistry,
    private readonly facilityRegistry: WorkbenchFacilityDefinitionRegistry,
    dependencies: Partial<SandboxFrameInteractionBridgeDependencies> = {},
  ) {
    this.schedule = dependencies.schedule ?? defaultSchedule;
    this.logger = dependencies.logger ?? console;
    this.unsubscribeBindings = this.bindingRegistry.subscribe(
      (event) => {
        if (event.type === 'disposed') {
          this.clearSessionCache(event.sessionId);
        }
      },
    );
  }

  attach(webContents: WebContents): () => void {
    const existing = this.attachedWebContents.get(webContents.id);

    if (existing) {
      return existing;
    }

    const onContextMenu = (
      _event: Event,
      params: ContextMenuParams,
    ) => {
      if (params.frame) {
        void this.capture(
          webContents,
          params.frame,
          SANDBOX_CONTEXT_MENU_TRIGGER,
          params,
        );
      }
    };
    const scheduleFocusedSelection = () => {
      this.schedule(() => {
        if (webContents.isDestroyed()) {
          return;
        }

        const frame = webContents.focusedFrame;

        if (frame) {
          void this.capture(
            webContents,
            frame,
            SANDBOX_SELECTION_SETTLED_TRIGGER,
          );
        }
      });
    };
    const onBeforeMouseEvent = (
      _event: Event,
      mouse: MouseInputEvent,
    ) => {
      if (mouse.type === 'mouseUp') {
        scheduleFocusedSelection();
      }
    };
    const onBeforeInputEvent = (_event: Event, input: Input) => {
      if (input.type === 'keyUp') {
        scheduleFocusedSelection();
      }
    };
    const onDestroyed = () => {
      dispose();
    };
    let active = true;
    const dispose = () => {
      if (!active) {
        return;
      }

      active = false;
      webContents.off('context-menu', onContextMenu);
      webContents.off('before-mouse-event', onBeforeMouseEvent);
      webContents.off('before-input-event', onBeforeInputEvent);
      webContents.off('destroyed', onDestroyed);
      if (this.attachedWebContents.get(webContents.id) === dispose) {
        this.attachedWebContents.delete(webContents.id);
      }
    };

    webContents.on('context-menu', onContextMenu);
    webContents.on('before-mouse-event', onBeforeMouseEvent);
    webContents.on('before-input-event', onBeforeInputEvent);
    webContents.on('destroyed', onDestroyed);
    this.attachedWebContents.set(webContents.id, dispose);

    return dispose;
  }

  dispose(): void {
    for (const dispose of [...this.attachedWebContents.values()]) {
      dispose();
    }
    this.lastPayloadByFacility.clear();
    this.unsubscribeBindings();
  }

  private async capture(
    webContents: WebContents,
    frame: WebFrameMain,
    trigger: string,
    source?: unknown,
  ): Promise<void> {
    const activeBinding = this.resolveBinding(frame);

    if (!activeBinding) {
      return;
    }

    for (const facility of activeBinding.binding.facilities) {
      const adapter = this.adapterRegistry.get(
        activeBinding.workbenchId,
        facility.id,
        facility.version,
        trigger,
      );

      if (!adapter) {
        continue;
      }

      try {
        const payload = await adapter.capture({
          sessionId: activeBinding.sessionId,
          workbenchId: activeBinding.workbenchId,
          trigger,
          frame,
          source,
        });

        if (
          payload === undefined ||
          webContents.isDestroyed() ||
          !this.bindingRegistry.isActive(activeBinding) ||
          this.resolveBinding(frame) !== activeBinding ||
          !this.facilityRegistry.validateEvent(
            facility.id,
            facility.version,
            payload,
          )
        ) {
          continue;
        }

        const dedupeKey = `${activeBinding.sessionId}:${facility.id}@${facility.version}`;
        const serializedPayload = JSON.stringify(payload);

        if (
          adapter.dedupe &&
          this.lastPayloadByFacility.get(dedupeKey) ===
            serializedPayload
        ) {
          continue;
        }
        if (adapter.dedupe) {
          this.lastPayloadByFacility.set(
            dedupeKey,
            serializedPayload,
          );
        }

        const event: WorkbenchFacilityEvent = {
          sessionId: activeBinding.sessionId,
          facilityId: facility.id,
          facilityVersion: facility.version,
          payload,
        };

        webContents.send(
          IPC_CHANNELS.workbenchFacilityEvent,
          event,
        );
      } catch (error) {
        this.logger.error('采集 Workbench Facility 事件失败', error);
      }
    }
  }

  private resolveBinding(
    frame: WebFrameMain,
  ): ActiveWorkbenchTransportBinding | undefined {
    const ancestorUrls = this.readAncestorUrls(frame);

    if (!ancestorUrls) {
      return undefined;
    }

    const matches =
      this.bindingRegistry
        .listByTransport(
          CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
          CORE_FACILITY_VERSION,
        )
        .filter((active) => {
          const payload = active.binding.payload;

          return (
            isSandboxFrameTransportBindingPayload(payload) &&
            ancestorUrls.has(payload.rootUrl)
          );
        });

    return matches.length === 1 ? matches[0] : undefined;
  }

  private readAncestorUrls(
    initialFrame: WebFrameMain,
  ): ReadonlySet<string> | undefined {
    const urls = new Set<string>();
    let frame: WebFrameMain | null = initialFrame;
    let remainingDepth = 64;

    try {
      while (frame && remainingDepth > 0) {
        if (frame.isDestroyed() || frame.detached) {
          return undefined;
        }

        urls.add(frame.url);
        frame = frame.parent;
        remainingDepth -= 1;
      }
    } catch {
      return undefined;
    }

    return frame === null ? urls : undefined;
  }

  private clearSessionCache(sessionId: string): void {
    const prefix = `${sessionId}:`;

    for (const key of this.lastPayloadByFacility.keys()) {
      if (key.startsWith(prefix)) {
        this.lastPayloadByFacility.delete(key);
      }
    }
  }
}
