import type {
  WorkbenchInteractionContext,
  WorkbenchInteractionSnapshot,
  WorkbenchInvocationContext,
  WorkbenchInvocationOrigin,
} from '../../../shared/workbench/interaction';
import type { WorkbenchActionBundle } from '../actions/workbench-action';
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

export type WorkbenchErrorReporter = (
  error: unknown,
  fallback: string,
) => void;

export class WorkbenchRuntime {
  readonly store: WorkbenchRuntimeStore;
  private readonly registry = new WorkbenchActionRegistry();
  private readonly invoker: WorkbenchActionInvoker;
  private reportError: WorkbenchErrorReporter;

  constructor(reportError: WorkbenchErrorReporter) {
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

  activate(identity: WorkbenchRuntimeIdentity): void {
    const current = this.store.getState().identity;

    if (
      current?.projectId === identity.projectId &&
      current.assetId === identity.assetId &&
      current.workbenchId === identity.workbenchId &&
      current.sessionId === identity.sessionId
    ) {
      return;
    }

    this.registry.clear();
    this.store.getState().activate(identity);
    this.store.getState().bumpContributions();
  }

  deactivate(sessionId?: string): void {
    const identity = this.store.getState().identity;

    if (sessionId && identity?.sessionId !== sessionId) {
      return;
    }

    this.registry.clear();
    this.store.getState().deactivate(sessionId);
    this.store.getState().bumpContributions();
  }

  registerContributions(
    ownerId: string,
    bundle: WorkbenchActionBundle,
  ): () => void {
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

    if (!identity || identity.sessionId !== sessionId) {
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
    onWheel?: (event: WorkbenchContextMenuWheelEvent) => void,
  ): boolean {
    const identity = this.store.getState().identity;

    if (!identity || identity.sessionId !== sessionId) {
      return false;
    }

    const state = this.store.getState();
    state.publishInteraction({
      ...identity,
      ...interaction,
    });

    return state.openContextMenu({
      ...position,
      onWheel,
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
}
