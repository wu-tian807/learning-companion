import { AppError } from '../errors/app-error';
import {
  cloneExternalLibraryDefinition,
  type ExternalLibraryArchitecture,
  type ExternalLibraryDefinition,
  type ExternalLibraryPackageDefinition,
  type ExternalLibraryPlatform,
} from './external-library-definition';

export interface ExternalLibraryRegistryApi {
  register(definition: ExternalLibraryDefinition): void;
  list(): readonly ExternalLibraryDefinition[];
  get(libraryId: string): ExternalLibraryDefinition | undefined;
  require(libraryId: string): ExternalLibraryDefinition;
  findPackage(
    libraryId: string,
    platform: ExternalLibraryPlatform,
    architecture: ExternalLibraryArchitecture,
  ): ExternalLibraryPackageDefinition | undefined;
  selectPackage(
    libraryId: string,
    platform: ExternalLibraryPlatform,
    architecture: ExternalLibraryArchitecture,
  ): ExternalLibraryPackageDefinition;
}

export class ExternalLibraryRegistry
  implements ExternalLibraryRegistryApi
{
  private readonly definitions =
    new Map<string, ExternalLibraryDefinition>();

  register(definition: ExternalLibraryDefinition): void {
    let cloned: ExternalLibraryDefinition;

    try {
      cloned = cloneExternalLibraryDefinition(definition);
    } catch (error) {
      throw new AppError('INVALID_EXTENSION_DEFINITION', {
        cause: error,
      });
    }

    if (this.definitions.has(cloned.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(cloned.id, cloned);
  }

  list(): readonly ExternalLibraryDefinition[] {
    return [...this.definitions.values()].map(
      cloneExternalLibraryDefinition,
    );
  }

  get(libraryId: string): ExternalLibraryDefinition | undefined {
    const definition = this.definitions.get(libraryId.trim());
    return definition
      ? cloneExternalLibraryDefinition(definition)
      : undefined;
  }

  require(libraryId: string): ExternalLibraryDefinition {
    const definition = this.get(libraryId);

    if (!definition) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return definition;
  }

  selectPackage(
    libraryId: string,
    platform: ExternalLibraryPlatform,
    architecture: ExternalLibraryArchitecture,
  ): ExternalLibraryPackageDefinition {
    const packageDefinition = this.findPackage(
      libraryId,
      platform,
      architecture,
    );

    if (!packageDefinition) {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }

    return packageDefinition;
  }

  findPackage(
    libraryId: string,
    platform: ExternalLibraryPlatform,
    architecture: ExternalLibraryArchitecture,
  ): ExternalLibraryPackageDefinition | undefined {
    return this.require(libraryId).packages.find(
      (candidate) =>
        candidate.platform === platform &&
        candidate.architecture === architecture,
    );
  }
}
