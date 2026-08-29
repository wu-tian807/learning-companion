import { AppError } from "../errors/app-error";

export interface ExternalLibraryRuntimeSetup {
  readonly libraryId: string;
  isReady(runtimeDirectory: string): Promise<boolean>;
  prepare(
    runtimeDirectory: string,
    setupCacheDirectory: string,
    signal: AbortSignal,
    reportStatus: (statusDetail: string) => void,
  ): Promise<void>;
}

export interface ExternalLibraryRuntimeSetupRegistryApi {
  register(setup: ExternalLibraryRuntimeSetup): void;
  find(libraryId: string): ExternalLibraryRuntimeSetup | undefined;
}

function isSafeLibraryId(value: string): boolean {
  const normalized = value.trim();
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized) &&
    normalized !== "." &&
    normalized !== ".."
  );
}

export class ExternalLibraryRuntimeSetupRegistry implements ExternalLibraryRuntimeSetupRegistryApi {
  private readonly setups = new Map<string, ExternalLibraryRuntimeSetup>();

  register(setup: ExternalLibraryRuntimeSetup): void {
    const libraryId = setup.libraryId.trim();
    if (
      !isSafeLibraryId(libraryId) ||
      typeof setup.isReady !== "function" ||
      typeof setup.prepare !== "function"
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
