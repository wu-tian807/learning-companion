import { AppError } from '../errors/app-error';
import { isSafeExternalLibraryPathSegment } from './external-library-definition';

export interface ExternalLibraryLifecycle {
  readonly libraryId: string;
  release(): Promise<void>;
}

export interface ExternalLibraryLifecycleRegistryApi {
  register(lifecycle: ExternalLibraryLifecycle): void;
  find(libraryId: string): ExternalLibraryLifecycle | undefined;
}

export class ExternalLibraryLifecycleRegistry
  implements ExternalLibraryLifecycleRegistryApi
{
  private readonly lifecycles = new Map<string, ExternalLibraryLifecycle>();

  register(lifecycle: ExternalLibraryLifecycle): void {
    const libraryId = lifecycle.libraryId.trim();
    if (
      !isSafeExternalLibraryPathSegment(libraryId) ||
      typeof lifecycle.release !== 'function'
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    if (this.lifecycles.has(libraryId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    this.lifecycles.set(libraryId, lifecycle);
  }

  find(libraryId: string): ExternalLibraryLifecycle | undefined {
    return this.lifecycles.get(libraryId.trim());
  }
}

export interface ExternalLibraryQuiescence {
  dispose(): void;
}

interface ExternalLibraryUsageState {
  controller: AbortController;
  readonly active: Set<Promise<unknown>>;
  quiescing: boolean;
}

export class ExternalLibraryUsageManager {
  private readonly states = new Map<string, ExternalLibraryUsageState>();

  run<T>(
    libraryId: string,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const state = this.resolveState(libraryId);
    if (state.quiescing) {
      return Promise.reject(new AppError('EXTERNAL_LIBRARY_CONFLICT'));
    }
    const operationSignal = signal
      ? AbortSignal.any([signal, state.controller.signal])
      : state.controller.signal;
    const task = Promise.resolve().then(() => {
      operationSignal.throwIfAborted();
      return operation(operationSignal);
    });
    state.active.add(task);
    return task.finally(() => {
      state.active.delete(task);
    });
  }

  async quiesce(
    libraryId: string,
    release?: () => Promise<void>,
  ): Promise<ExternalLibraryQuiescence> {
    const state = this.resolveState(libraryId);
    if (state.quiescing) {
      throw new AppError('EXTERNAL_LIBRARY_CONFLICT');
    }
    state.quiescing = true;
    state.controller.abort();

    try {
      await Promise.allSettled([...state.active]);
      await release?.();
    } catch (error) {
      this.resume(state);
      throw error;
    }

    let disposed = false;
    return Object.freeze({
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        this.resume(state);
      },
    });
  }

  private resolveState(libraryId: string): ExternalLibraryUsageState {
    const normalized = libraryId.trim();
    let state = this.states.get(normalized);
    if (!state) {
      state = {
        controller: new AbortController(),
        active: new Set(),
        quiescing: false,
      };
      this.states.set(normalized, state);
    }
    return state;
  }

  private resume(state: ExternalLibraryUsageState): void {
    state.controller = new AbortController();
    state.quiescing = false;
  }
}
