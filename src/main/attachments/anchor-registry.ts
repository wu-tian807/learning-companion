import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';

export interface AnchorTypeDefinition {
  readonly anchorType: string;
  readonly version: number;
  isPayload(value: JsonValue): boolean;
}

function definitionKey(anchorType: string, version: number): string {
  return `${anchorType}@${version}`;
}

function validateDefinition(definition: AnchorTypeDefinition): void {
  if (
    definition.anchorType.trim().length === 0 ||
    !Number.isSafeInteger(definition.version) ||
    definition.version <= 0
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export class AnchorRegistry {
  private readonly definitions = new Map<string, AnchorTypeDefinition>();

  register(definition: AnchorTypeDefinition): void {
    validateDefinition(definition);
    const key = definitionKey(definition.anchorType, definition.version);

    if (this.definitions.has(key)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(key, definition);
  }

  get(
    anchorType: string,
    version: number,
  ): AnchorTypeDefinition | undefined {
    return this.definitions.get(definitionKey(anchorType, version));
  }
}
