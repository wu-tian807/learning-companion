import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';

export interface AttachmentTypeDefinition {
  readonly typeId: string;
  readonly version: number;
  isPayload(value: JsonValue): boolean;
}

function definitionKey(typeId: string, version: number): string {
  return `${typeId}@${version}`;
}

function validateDefinition(definition: AttachmentTypeDefinition): void {
  if (
    definition.typeId.trim().length === 0 ||
    !Number.isSafeInteger(definition.version) ||
    definition.version <= 0
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export class AttachmentRegistry {
  private readonly definitions = new Map<string, AttachmentTypeDefinition>();

  register(definition: AttachmentTypeDefinition): void {
    validateDefinition(definition);
    const key = definitionKey(definition.typeId, definition.version);

    if (this.definitions.has(key)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(key, definition);
  }

  get(
    typeId: string,
    version: number,
  ): AttachmentTypeDefinition | undefined {
    return this.definitions.get(definitionKey(typeId, version));
  }
}
