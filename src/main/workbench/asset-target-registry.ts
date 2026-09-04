import type {
  AssetTarget,
  ContentAssetTarget,
} from '../../shared/workbench/asset-target';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';

export interface AgentAssetTargetDefinition {
  /** Explains when this Target should be used and what it points to. */
  readonly description: string;
  /** JSON Schema for targetPayload. It is guidance; isPayload is authoritative. */
  readonly payloadSchema: JsonValue;
  readonly examplePayloads: readonly JsonValue[];
}

export interface AssetTargetDefinition {
  readonly workbenchId: string;
  readonly targetType: string;
  readonly version: number;
  readonly agent: AgentAssetTargetDefinition;
  isPayload(value: JsonValue): boolean;
  describe(payload: JsonValue): string;
}

export interface AssetTargetRegistryApi {
  register(definition: AssetTargetDefinition): void;
  get(targetType: string, version: number): AssetTargetDefinition | undefined;
  listForWorkbench(workbenchId: string): readonly AssetTargetDefinition[];
  validate(workbenchId: string, target: AssetTarget): boolean;
  describe(workbenchId: string, target: AssetTarget): string | undefined;
  assertManifest(manifest: AssetWorkbenchManifest): void;
}

function definitionKey(targetType: string, version: number): string {
  return `${targetType}@${version}`;
}

function requiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDefinition(
  definition: AssetTargetDefinition,
): AssetTargetDefinition {
  const workbenchId = requiredText(definition.workbenchId);
  const targetType = requiredText(definition.targetType);
  const description = requiredText(definition.agent?.description);

  if (
    !workbenchId ||
    !targetType ||
    !description ||
    typeof definition.isPayload !== 'function' ||
    typeof definition.describe !== 'function'
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  let examples: readonly JsonValue[];
  const isPayload = (value: JsonValue): boolean => {
    try {
      return definition.isPayload(value);
    } catch {
      return false;
    }
  };
  const describe = (value: JsonValue): string => {
    try {
      return definition.describe(value);
    } catch {
      return '';
    }
  };
  try {
    if (
      !Number.isSafeInteger(definition.version) ||
      definition.version <= 0 ||
      !isJsonValue(definition.agent?.payloadSchema) ||
      !Array.isArray(definition.agent?.examplePayloads) ||
      definition.agent.examplePayloads.length === 0 ||
      definition.agent.examplePayloads.some(
        (example) =>
          !isJsonValue(example) ||
          !isPayload(example) ||
          !requiredText(describe(example)),
      )
    ) {
      throw new Error('invalid Target definition');
    }
    examples = Object.freeze(
      definition.agent.examplePayloads.map(cloneJsonValue),
    );
  } catch {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({
    ...definition,
    workbenchId,
    targetType,
    isPayload,
    describe,
    agent: Object.freeze({
      description,
      payloadSchema: cloneJsonValue(definition.agent.payloadSchema),
      examplePayloads: examples,
    }),
  });
}

function contentTargetDefinition(
  registry: AssetTargetRegistry,
  workbenchId: string,
  target: ContentAssetTarget,
): AssetTargetDefinition | undefined {
  const definition = registry.get(target.targetType, target.targetVersion);
  return definition?.workbenchId === workbenchId.trim()
    ? definition
    : undefined;
}

export class AssetTargetRegistry implements AssetTargetRegistryApi {
  private readonly definitions = new Map<string, AssetTargetDefinition>();
  private readonly definitionsByWorkbench = new Map<
    string,
    AssetTargetDefinition[]
  >();

  register(input: AssetTargetDefinition): void {
    const definition = normalizeDefinition(input);
    const key = definitionKey(definition.targetType, definition.version);

    if (this.definitions.has(key)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.definitions.set(key, definition);
    const owned = this.definitionsByWorkbench.get(definition.workbenchId) ?? [];
    owned.push(definition);
    owned.sort(
      (left, right) =>
        left.targetType.localeCompare(right.targetType) ||
        left.version - right.version,
    );
    this.definitionsByWorkbench.set(definition.workbenchId, owned);
  }

  get(
    targetType: string,
    version: number,
  ): AssetTargetDefinition | undefined {
    return this.definitions.get(definitionKey(targetType.trim(), version));
  }

  listForWorkbench(workbenchId: string): readonly AssetTargetDefinition[] {
    return Object.freeze([
      ...(this.definitionsByWorkbench.get(workbenchId.trim()) ?? []),
    ]);
  }

  validate(workbenchId: string, target: AssetTarget): boolean {
    if (target.scope === 'asset') {
      return workbenchId.trim().length > 0;
    }

    return Boolean(
      contentTargetDefinition(this, workbenchId, target)?.isPayload(
        target.targetPayload,
      ),
    );
  }

  describe(workbenchId: string, target: AssetTarget): string | undefined {
    if (target.scope === 'asset') {
      return workbenchId.trim() ? '整份资料' : undefined;
    }

    const definition = contentTargetDefinition(this, workbenchId, target);
    if (!definition || !definition.isPayload(target.targetPayload)) {
      return undefined;
    }

    const description = requiredText(definition.describe(target.targetPayload));
    return description ? `${definition.agent.description}：${description}` : undefined;
  }

  assertManifest(manifest: AssetWorkbenchManifest): void {
    const registeredTypes = [
      ...new Set(
        this.listForWorkbench(manifest.id).map(({ targetType }) => targetType),
      ),
    ].sort();
    const declaredTypes = [...manifest.supportedTargetTypes].sort();

    if (
      registeredTypes.length !== declaredTypes.length ||
      registeredTypes.some((targetType, index) => targetType !== declaredTypes[index])
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
  }
}
