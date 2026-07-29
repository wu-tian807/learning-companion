import type { WebFrameMain } from 'electron';

import type { JsonValue } from '../../../shared/workbench/protocol';
import { workbenchFacilityKey } from '../../../shared/workbench/facilities/facility-declaration';
import type { WorkbenchFacilityDefinitionRegistry } from '../../../shared/workbench/facilities/facility-definition-registry';
import { AppError } from '../../errors/app-error';

export interface MainFacilityCaptureContext {
  readonly trigger: string;
  readonly frame: WebFrameMain;
  readonly source?: unknown;
}

export interface MainWorkbenchFacilityAdapter {
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
      adapter.triggers.length === 0 ||
      triggers.size !== adapter.triggers.length ||
      adapter.triggers.some(
        (trigger) =>
          typeof trigger !== 'string' || trigger.trim().length === 0,
      )
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const key = workbenchFacilityKey(
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
    facilityId: string,
    facilityVersion: number,
    trigger: string,
  ): MainWorkbenchFacilityAdapter | undefined {
    const adapter = this.adapters.get(
      workbenchFacilityKey(facilityId, facilityVersion),
    );

    return adapter?.triggers.includes(trigger) ? adapter : undefined;
  }
}
