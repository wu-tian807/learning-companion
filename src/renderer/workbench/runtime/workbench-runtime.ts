import type {
  WorkbenchInteractionContext,
  WorkbenchInteractionSnapshot,
  WorkbenchInvocationContext,
  WorkbenchInvocationOrigin,
} from '../../../shared/workbench/interaction';
import { isWorkbenchInteractionSnapshot } from '../../../shared/workbench/interaction';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_HEADER_SURFACE_FACILITY_ID,
  CORE_OVERFLOW_SURFACE_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityDefinitionRegistry } from '../../../shared/workbench/facilities/facility-definition-registry';
import {
  isAssetWorkbenchManifest,
  type AssetWorkbenchManifest,
} from '../../../shared/workbench/manifest';
import type { WorkbenchActionBundle } from '../actions/workbench-action-bundle';
import type { WorkbenchSurface } from '../actions/workbench-contribution';
import {
  WorkbenchActionRegistry,
  type ResolvedWorkbenchContribution,
} from './workbench-action-registry';
import {
  createWorkbenchInvocationContext,
  WorkbenchActionInvoker,
  type WorkbenchActionInvocationResult,
} from './workbench-invocation';
import {
  createWorkbenchRuntimeStore,
  type WorkbenchRuntimeIdentity,
  type WorkbenchRuntimeStore,
  type WorkbenchContextMenuWheelEvent,
} from './workbench-runtime-store';

export interface WorkbenchContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface WorkbenchContextMenuOptions {
  readonly onWheel?: (event: WorkbenchContextMenuWheelEvent) => void;
  readonly captureOutsidePointer?: boolean;
}

export type WorkbenchErrorReporter = (
  error: unknown,
  fallback: string,
) => void;

export class WorkbenchRuntime {
  readonly store: WorkbenchRuntimeStore;
  private readonly registry = new WorkbenchActionRegistry();
  private readonly invoker: WorkbenchActionInvoker;
  private reportError: WorkbenchErrorReporter;
  private activeManifest: AssetWorkbenchManifest | undefined;

  constructor(
    reportError: WorkbenchErrorReporter,
    private readonly facilityRegistry:
      WorkbenchFacilityDefinitionRegistry =
        createCoreWorkbenchFacilityDefinitionRegistry(),
  ) {
    this.reportError = reportError;
    this.store = createWorkbenchRuntimeStore();
    this.invoker = new WorkbenchActionInvoker(
      this.registry,
      this.store,
      {
        reportError: (error, fallback) =>
          this.reportError(error, fallback),
      },
    );
  }

  setErrorReporter(reportError: WorkbenchErrorReporter): void {
    this.reportError = reportError;
  }

  activate(
    identity: WorkbenchRuntimeIdentity,
    manifest: AssetWorkbenchManifest,
  ): void {
    if (
      !isAssetWorkbenchManifest(manifest) ||
      manifest.id !== identity.workbenchId ||
      !this.facilityRegistry.validateDeclarations(
        manifest.facilities,
      )
    ) {
      throw new Error('Workbench Runtime Manifest 无效');
    }

    const current = this.store.getState().identity;

    if (
      current?.projectId === identity.projectId &&
      current.assetId === identity.assetId &&
      current.workbenchId === identity.workbenchId &&
      current.sessionId === identity.sessionId &&
      this.activeManifest === manifest
    ) {
      return;
    }

    this.registry.clear();
    this.activeManifest = manifest;
    this.store.getState().activate(identity);
    this.store.getState().bumpContributions();
  }

  deactivate(sessionId?: string): void {
    const identity = this.store.getState().identity;

    if (sessionId && identity?.sessionId !== sessionId) {
      return;
    }

    this.registry.clear();
    this.activeManifest = undefined;
    this.store.getState().deactivate(sessionId);
    this.store.getState().bumpContributions();
  }

  registerContributions(
    ownerId: string,
    bundle: WorkbenchActionBundle,
  ): () => void {
    this.requireValidContributionFacilities(bundle);
    const dispose = this.registry.register(ownerId, bundle);
    this.store.getState().bumpContributions();
    let active = true;

    return () => {
      if (!active) {
        return;
      }

      active = false;
      dispose();
      this.store.getState().bumpContributions();
    };
  }

  contributions(
    surface: WorkbenchSurface,
  ): readonly ResolvedWorkbenchContribution[] {
    return this.registry.getContributions(surface);
  }

  publishInteraction(
    sessionId: string,
    interaction: WorkbenchInteractionSnapshot,
  ): boolean {
    const identity = this.store.getState().identity;

    if (
      !identity ||
      identity.sessionId !== sessionId ||
      !this.validateInteraction(interaction)
    ) {
      return false;
    }

    return this.store.getState().publishInteraction({
      ...identity,
      ...interaction,
    });
  }

  interactionContext(): WorkbenchInteractionContext | undefined {
    const state = this.store.getState();

    if (!state.identity) {
      return undefined;
    }

    return {
      ...state.identity,
      ...state.interaction,
    };
  }

  createInvocation(
    origin: WorkbenchInvocationOrigin,
    interaction: WorkbenchInteractionSnapshot = this.store.getState()
      .interaction,
  ): WorkbenchInvocationContext | undefined {
    const identity = this.store.getState().identity;

    return identity
      ? createWorkbenchInvocationContext(
          identity,
          origin,
          interaction,
        )
      : undefined;
  }

  openContextMenu(
    sessionId: string,
    position: WorkbenchContextMenuPosition,
    interaction: WorkbenchInteractionSnapshot,
    options: WorkbenchContextMenuOptions = {},
  ): boolean {
    const identity = this.store.getState().identity;

    if (
      !identity ||
      identity.sessionId !== sessionId ||
      !this.hasFacility(CORE_CONTEXT_MENU_SURFACE_FACILITY_ID) ||
      !this.validateInteraction(interaction)
    ) {
      return false;
    }

    const state = this.store.getState();
    state.publishInteraction({
      ...identity,
      ...interaction,
    });

    return state.openContextMenu({
      ...position,
      ...options,
      invocation: createWorkbenchInvocationContext(
        identity,
        'context-menu',
        interaction,
      ),
    });
  }

  closeContextMenu(): void {
    this.store.getState().closeContextMenu();
  }

  async invokeCurrent(
    actionId: string,
    origin: Exclude<WorkbenchInvocationOrigin, 'context-menu'>,
  ): Promise<WorkbenchActionInvocationResult> {
    const invocation = this.createInvocation(origin);

    return invocation
      ? this.invoker.invoke(actionId, invocation)
      : 'stale';
  }

  invoke(
    actionId: string,
    invocation: WorkbenchInvocationContext,
  ): Promise<WorkbenchActionInvocationResult> {
    return this.invoker.invoke(actionId, invocation);
  }

  private validateInteraction(
    interaction: WorkbenchInteractionSnapshot,
  ): boolean {
    const manifest = this.activeManifest;

    if (!manifest || !isWorkbenchInteractionSnapshot(interaction)) {
      return false;
    }

    const isSupportedTarget = (
      target: WorkbenchInteractionSnapshot['focus'],
    ): boolean =>
      target === undefined ||
      manifest.supportedAnchorTypes.includes(target.anchorType);

    if (!isSupportedTarget(interaction.focus)) {
      return false;
    }

    const counts = new Map<string, number>();

    for (const input of interaction.inputs) {
      const declaration = manifest.facilities.find(
        (facility) =>
          facility.id === input.type &&
          facility.version === input.version,
      );
      const definition = this.facilityRegistry.get(
        input.type,
        input.version,
      );

      if (
        !declaration ||
        definition?.role !== 'input' ||
        !isSupportedTarget(input.target) ||
        !this.facilityRegistry.validateInput(
          input.type,
          input.version,
          input.payload,
        )
      ) {
        return false;
      }

      const key = `${input.type}@${input.version}`;
      const count = (counts.get(key) ?? 0) + 1;

      if (definition.inputCardinality === 'one' && count > 1) {
        return false;
      }
      counts.set(key, count);
    }

    return true;
  }

  private hasFacility(id: string, version = 1): boolean {
    return (
      this.activeManifest?.facilities.some(
        (facility) =>
          facility.id === id && facility.version === version,
      ) ?? false
    );
  }

  private requireValidContributionFacilities(
    bundle: WorkbenchActionBundle,
  ): void {
    const requiredFacilityBySurface: Readonly<
      Record<WorkbenchSurface, string>
    > = {
      header: CORE_HEADER_SURFACE_FACILITY_ID,
      overflow: CORE_OVERFLOW_SURFACE_FACILITY_ID,
      'context-menu': CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
    };

    for (const contribution of bundle.contributions) {
      if (
        !this.hasFacility(
          requiredFacilityBySurface[contribution.surface],
        )
      ) {
        throw new Error(
          `Workbench 未声明 ${contribution.surface} Facility`,
        );
      }
    }
  }
}
