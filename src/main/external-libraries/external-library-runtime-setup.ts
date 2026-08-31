import { AppError } from "../errors/app-error";
import type { ExternalLibraryProgress } from "../../shared/external-libraries";
import { isSafeExternalLibraryPathSegment } from "./external-library-definition";

export interface ExternalLibraryRuntimeSetup {
  readonly libraryId: string;
  readonly expectedSetupBytes?: number;
  isReady(runtimeDirectory: string): Promise<boolean>;
  prepare(
    runtimeDirectory: string,
    setupCacheDirectory: string,
    signal: AbortSignal,
    reportStatus: (
      statusDetail: string,
      progress?: ExternalLibraryProgress,
    ) => void,
  ): Promise<void>;
  finalizeInstallation?(
    runtimeDirectory: string,
    signal: AbortSignal,
    reportStatus: (
      statusDetail: string,
      progress?: ExternalLibraryProgress,
    ) => void,
  ): Promise<void>;
}

export interface ExternalLibraryRuntimeSetupRegistryApi {
  register(setup: ExternalLibraryRuntimeSetup): void;
  find(libraryId: string): ExternalLibraryRuntimeSetup | undefined;
}

export class ExternalLibraryRuntimeSetupRegistry implements ExternalLibraryRuntimeSetupRegistryApi {
  private readonly setups = new Map<string, ExternalLibraryRuntimeSetup>();

  register(setup: ExternalLibraryRuntimeSetup): void {
    const libraryId = setup.libraryId.trim();
    if (
      !isSafeExternalLibraryPathSegment(libraryId) ||
      (setup.expectedSetupBytes !== undefined &&
        (!Number.isSafeInteger(setup.expectedSetupBytes) ||
          setup.expectedSetupBytes <= 0)) ||
      typeof setup.isReady !== "function" ||
      typeof setup.prepare !== "function" ||
      (setup.finalizeInstallation !== undefined &&
        typeof setup.finalizeInstallation !== "function")
    ) {
      throw new AppError("INVALID_EXTENSION_DEFINITION");
    }
    if (this.setups.has(libraryId)) {
      throw new AppError("REGISTRATION_CONFLICT");
    }
    this.setups.set(libraryId, setup);
  }

  find(libraryId: string): ExternalLibraryRuntimeSetup | undefined {
    return this.setups.get(libraryId.trim());
  }
}
