import type { WebFrameMain } from 'electron';

import type { JsonValue } from '../../../shared/workbench/protocol';
import { workbenchFacilityKey } from '../../../shared/workbench/facilities/facility-declaration';
import type { WorkbenchFacilityDefinitionRegistry } from '../../../shared/workbench/facilities/facility-definition-registry';
import { AppError } from '../../errors/app-error';

export interface MainFacilityCaptureContext {
  readonly sessionId: string;
  readonly workbenchId: string;
  readonly trigger: string;
  readonly frame: WebFrameMain;
  readonly source?: unknown;
}

export interface MainWorkbenchFacilityAdapter {
  readonly workbenchId: string;
  readonly facilityId: string;
  readonly facilityVersion: number;
  readonly triggers: readonly string[];
  readonly dedupe?: boolean;
  capture(
    context: MainFacilityCaptureContext,
  ): JsonValue | undefined | Promise<JsonValue | undefined>;
}

export class MainFacilityAdapterRegistry {
  private readonly adapters = new Map<
    string,
    MainWorkbenchFacilityAdapter
  >();

  constructor(
    private readonly facilityRegistry: WorkbenchFacilityDefinitionRegistry,
  ) {}

  register(adapter: MainWorkbenchFacilityAdapter): () => void {
    const definition = this.facilityRegistry.get(
      adapter.facilityId,
      adapter.facilityVersion,
    );
    const triggers = new Set(adapter.triggers);

    if (
      !definition?.validateEvent ||
      typeof adapter.workbenchId !== 'string' ||
      adapter.workbenchId.trim().length === 0 ||
      adapter.workbenchId !== adapter.workbenchId.trim() ||
      adapter.triggers.length === 0 ||
      triggers.size !== adapter.triggers.length ||
      adapter.triggers.some(
        (trigger) =>
          typeof trigger !== 'string' || trigger.trim().length === 0,
      )
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const key = this.adapterKey(
      adapter.workbenchId,
      adapter.facilityId,
      adapter.facilityVersion,
    );

    if (this.adapters.has(key)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.adapters.set(key, adapter);
    let active = true;

    return () => {
      if (!active) {
        return;
      }

      active = false;
      if (this.adapters.get(key) === adapter) {
        this.adapters.delete(key);
      }
    };
  }

  get(
    workbenchId: string,
    facilityId: string,
    facilityVersion: number,
    trigger: string,
  ): MainWorkbenchFacilityAdapter | undefined {
    const adapter = this.adapters.get(
      this.adapterKey(workbenchId, facilityId, facilityVersion),
    );

    return adapter?.triggers.includes(trigger) ? adapter : undefined;
  }

  private adapterKey(
    workbenchId: string,
    facilityId: string,
    facilityVersion: number,
  ): string {
    return `${workbenchId.trim()}:${workbenchFacilityKey(
      facilityId,
      facilityVersion,
    )}`;
  }
}
