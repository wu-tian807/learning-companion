import type { JsonValue } from '../protocol';
import type { WorkbenchFacilityDeclaration } from './facility-declaration';
import {
  isWorkbenchFacilityId,
  workbenchFacilityKey,
} from './facility-declaration';
import type { WorkbenchFacilityDefinition } from './facility-definition';
import { workbenchFacilityRoles } from './facility-definition';

export class WorkbenchFacilityDefinitionRegistry {
  private readonly definitions = new Map<
    string,
    WorkbenchFacilityDefinition
  >();

  register(definition: WorkbenchFacilityDefinition): () => void {
    if (
      !isWorkbenchFacilityId(definition.id) ||
      !Number.isSafeInteger(definition.version) ||
      definition.version <= 0 ||
      !workbenchFacilityRoles.includes(definition.role) ||
      typeof definition.validateOptions !== 'function' ||
      (definition.validateEvent !== undefined &&
        typeof definition.validateEvent !== 'function') ||
      (definition.validateDependencies !== undefined &&
        typeof definition.validateDependencies !== 'function') ||
      (definition.inputCardinality !== undefined &&
        definition.inputCardinality !== 'one' &&
        definition.inputCardinality !== 'many') ||
      (definition.role !== 'input' &&
        definition.inputCardinality !== undefined)
    ) {
      throw new Error('Workbench Facility Definition 无效');
    }

    const key = workbenchFacilityKey(
      definition.id,
      definition.version,
    );

    if (this.definitions.has(key)) {
      throw new Error(`Workbench Facility 重复注册：${key}`);
    }

    this.definitions.set(key, definition);
    let active = true;

    return () => {
      if (!active) {
        return;
      }

      active = false;
      if (this.definitions.get(key) === definition) {
        this.definitions.delete(key);
      }
    };
  }

  get(
    id: string,
    version: number,
  ): WorkbenchFacilityDefinition | undefined {
    return this.definitions.get(workbenchFacilityKey(id, version));
  }

  validateDeclarations(
    declarations: readonly WorkbenchFacilityDeclaration[],
  ): boolean {
    const keys = new Set<string>();

    for (const declaration of declarations) {
      const key = workbenchFacilityKey(
        declaration.id,
        declaration.version,
      );
      const definition = this.definitions.get(key);

      if (
        keys.has(key) ||
        !definition ||
        !definition.validateOptions(declaration.options)
      ) {
        return false;
      }

      keys.add(key);
    }

    return declarations.every((declaration) => {
      const definition = this.get(
        declaration.id,
        declaration.version,
      );

      return (
        definition !== undefined &&
        (definition.validateDependencies?.(
          declaration.options,
          declarations,
        ) ??
          true)
      );
    });
  }

  validateEvent(
    id: string,
    version: number,
    payload: JsonValue,
  ): boolean {
    const definition = this.get(id, version);

    return definition?.validateEvent?.(payload) ?? false;
  }
}
