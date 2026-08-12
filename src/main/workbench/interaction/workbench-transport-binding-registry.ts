import type { AssetWorkbenchManifest } from '../../../shared/workbench/manifest';
import {
  isWorkbenchFacilityDeclaration,
  workbenchFacilityKey,
} from '../../../shared/workbench/facilities/facility-declaration';
import type { WorkbenchFacilityDefinitionRegistry } from '../../../shared/workbench/facilities/facility-definition-registry';
import {
  isWorkbenchTransportBinding,
  WORKBENCH_TRANSPORT_BINDING_MAX_SIZE,
  type WorkbenchTransportBinding,
} from '../../../shared/workbench/facilities/transport-binding';
import { AppError } from '../../errors/app-error';
import type { MainWorkbenchFacilityAdapter } from './main-workbench-facility-adapter';

export interface ActiveWorkbenchTransportBinding {
  readonly sessionId: string;
  readonly workbenchId: string;
  readonly binding: WorkbenchTransportBinding;
  readonly adapters: readonly MainWorkbenchFacilityAdapter[];
}

export interface WorkbenchTransportBindingRegistryEvent {
  readonly type: 'registered' | 'disposed';
  readonly sessionId: string;
}

export type WorkbenchTransportBindingRegistryListener = (
  event: WorkbenchTransportBindingRegistryEvent,
) => void;

export interface WorkbenchTransportBindingRegistryApi {
  registerSession(
    sessionId: string,
    manifest: AssetWorkbenchManifest,
    bindings: readonly WorkbenchTransportBinding[],
    adapters?: readonly MainWorkbenchFacilityAdapter[],
  ): () => void;
  disposeSession(sessionId: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function bindingIdentity(binding: WorkbenchTransportBinding): string {
  return `${workbenchFacilityKey(
    binding.transportId,
    binding.transportVersion,
  )}:${JSON.stringify(binding.payload)}`;
}

export class WorkbenchTransportBindingRegistry
  implements WorkbenchTransportBindingRegistryApi
{
  private readonly sessions = new Map<
    string,
    readonly ActiveWorkbenchTransportBinding[]
  >();
  private readonly bindingIdentities = new Set<string>();
  private readonly listeners =
    new Set<WorkbenchTransportBindingRegistryListener>();

  constructor(
    private readonly facilityRegistry: WorkbenchFacilityDefinitionRegistry,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {}

  registerSession(
    sessionId: string,
    manifest: AssetWorkbenchManifest,
    bindings: readonly WorkbenchTransportBinding[],
    adapters: readonly MainWorkbenchFacilityAdapter[] = [],
  ): () => void {
    if (!sessionId.trim() || this.sessions.has(sessionId)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    if (
      bindings.length > WORKBENCH_TRANSPORT_BINDING_MAX_SIZE ||
      !this.facilityRegistry.validateDeclarations(
        manifest.facilities,
      )
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    if (bindings.length === 0) {
      return () => undefined;
    }

    const identities = new Set<string>();
    const activeBindings: ActiveWorkbenchTransportBinding[] = [];

    for (const binding of bindings) {
      if (!isWorkbenchTransportBinding(binding)) {
        throw new AppError('INVALID_EXTENSION_DEFINITION');
      }

      const transportDefinition = this.facilityRegistry.get(
        binding.transportId,
        binding.transportVersion,
      );
      const transportDeclared = manifest.facilities.some(
        (facility) =>
          facility.id === binding.transportId &&
          facility.version === binding.transportVersion,
      );
      const identity = bindingIdentity(binding);

      if (
        identities.has(identity) ||
        this.bindingIdentities.has(identity) ||
        !transportDeclared ||
        transportDefinition?.role !== 'transport' ||
        !this.facilityRegistry.validateBinding(
          binding.transportId,
          binding.transportVersion,
          binding.payload,
        ) ||
        !binding.facilities.every((facilityRef) =>
          this.isAuthorizedFacility(
            manifest,
            binding,
            facilityRef,
          ),
        )
      ) {
        throw new AppError('INVALID_EXTENSION_DEFINITION');
      }

      identities.add(identity);
      activeBindings.push({
        sessionId,
        workbenchId: manifest.id,
        binding,
        adapters: adapters.filter((adapter) =>
          binding.facilities.some(
            (facility) =>
              facility.id === adapter.facilityId &&
              facility.version === adapter.facilityVersion,
          ),
        ),
      });
    }

    this.sessions.set(sessionId, activeBindings);
    for (const identity of identities) {
      this.bindingIdentities.add(identity);
    }
    this.emit({ type: 'registered', sessionId });

    let active = true;

    return () => {
      if (!active) {
        return;
      }

      active = false;
      this.disposeSession(sessionId);
    };
  }

  disposeSession(sessionId: string): void {
    const bindings = this.sessions.get(sessionId);

    if (!bindings) {
      return;
    }

    this.sessions.delete(sessionId);
    for (const active of bindings) {
      this.bindingIdentities.delete(bindingIdentity(active.binding));
    }
    this.emit({ type: 'disposed', sessionId });
  }

  listByTransport(
    transportId: string,
    transportVersion: number,
  ): readonly ActiveWorkbenchTransportBinding[] {
    const bindings: ActiveWorkbenchTransportBinding[] = [];

    for (const sessionBindings of this.sessions.values()) {
      for (const active of sessionBindings) {
        if (
          active.binding.transportId === transportId &&
          active.binding.transportVersion === transportVersion
        ) {
          bindings.push(active);
        }
      }
    }

    return bindings;
  }

  isActive(active: ActiveWorkbenchTransportBinding): boolean {
    return (
      this.sessions
        .get(active.sessionId)
        ?.some((candidate) => candidate === active) ?? false
    );
  }

  subscribe(
    listener: WorkbenchTransportBindingRegistryListener,
  ): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private isAuthorizedFacility(
    manifest: AssetWorkbenchManifest,
    binding: WorkbenchTransportBinding,
    facilityRef: WorkbenchTransportBinding['facilities'][number],
  ): boolean {
    const declaration = manifest.facilities.find(
      (facility) =>
        facility.id === facilityRef.id &&
        facility.version === facilityRef.version,
    );
    const definition = this.facilityRegistry.get(
      facilityRef.id,
      facilityRef.version,
    );

    if (
      !declaration ||
      !isWorkbenchFacilityDeclaration(declaration) ||
      !definition?.validateEvent ||
      (definition.role !== 'input' &&
        definition.role !== 'surface' &&
        definition.role !== 'capture')
    ) {
      return false;
    }

    return (
      isRecord(declaration.options) &&
      declaration.options.capture === binding.transportId
    );
  }

  private emit(event: WorkbenchTransportBindingRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(
          'Workbench Transport Binding 监听器执行失败',
          error,
        );
      }
    }
  }
}
