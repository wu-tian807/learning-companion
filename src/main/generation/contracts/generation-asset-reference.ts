export interface GenerationAssetReferenceInput {
  readonly assetId: string;
}

export type GenerationAssetReferenceBindings = Readonly<
  Record<string, readonly GenerationAssetReferenceInput[]>
>;

export interface GenerationAssetReferenceSlotSchema {
  readonly required: boolean;
  readonly cardinality: 'one' | 'many';
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly acceptedMediaTypes?: readonly string[];
}

export type GenerationAssetReferenceSchema = Readonly<
  Record<string, GenerationAssetReferenceSlotSchema>
>;

export interface PreparedGenerationAssetArtifact {
  readonly producerId: string;
  readonly artifactKey: string;
  readonly mediaType: string;
  readonly contentRevision: string;
  readonly relativePath: string;
}

export interface PreparedGenerationAssetReference {
  readonly alias: string;
  readonly assetId: string;
  readonly name: string;
  readonly mediaType: string;
  /** Asset Workbench selected while materializing this immutable snapshot. */
  readonly workbenchId?: string;
  readonly materializedMediaType?: string;
  readonly contentRevision: string;
  readonly relativePath: string;
  readonly artifacts?: readonly PreparedGenerationAssetArtifact[];
}

export type PreparedGenerationAssetReferenceBindings = Readonly<
  Record<string, readonly PreparedGenerationAssetReference[]>
>;

const slotKeyPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const maximumPreparedArtifactsPerReference = 128;

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Generation asset reference ${field} 不能为空`);
  }

  return normalized;
}

function requireSlotKey(value: string): string {
  const normalized = requireText(value, 'slot key');

  if (!slotKeyPattern.test(normalized)) {
    throw new Error('Generation asset reference slot key 数据无效');
  }

  return normalized;
}

function requirePortableRelativePath(value: string, field: string): string {
  const relativePath = requireText(value, field);

  if (
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    relativePath
      .split('/')
      .some(
        (segment) =>
          segment.length === 0 || segment === '.' || segment === '..',
      )
  ) {
    throw new Error(
      `Prepared generation asset reference ${field} 数据无效`,
    );
  }

  return relativePath;
}

export function cloneGenerationAssetReferenceBindings(
  bindings: GenerationAssetReferenceBindings,
): GenerationAssetReferenceBindings {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(bindings).map(([slot, references]) => [
        requireSlotKey(slot),
        Object.freeze(
          references.map((reference) =>
            Object.freeze({
              assetId: requireText(reference.assetId, 'assetId'),
            }),
          ),
        ),
      ]),
    ),
  );
}

export function cloneGenerationAssetReferenceSchema(
  schema: GenerationAssetReferenceSchema,
): GenerationAssetReferenceSchema {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(schema).map(([slot, definition]) => {
        const minItems = definition.minItems ?? (definition.required ? 1 : 0);
        const maxItems = definition.maxItems;

        if (
          typeof definition.required !== 'boolean' ||
          (definition.cardinality !== 'one' &&
            definition.cardinality !== 'many') ||
          !Number.isSafeInteger(minItems) ||
          minItems < 0 ||
          (definition.required && minItems < 1) ||
          (maxItems !== undefined &&
            (!Number.isSafeInteger(maxItems) || maxItems < minItems)) ||
          (definition.cardinality === 'one' &&
            (minItems > 1 || (maxItems !== undefined && maxItems > 1)))
        ) {
          throw new Error('Generation asset reference schema 数据无效');
        }

        return [
          requireSlotKey(slot),
          Object.freeze({
            required: definition.required,
            cardinality: definition.cardinality,
            ...(definition.minItems === undefined ? {} : { minItems }),
            ...(maxItems === undefined ? {} : { maxItems }),
            ...(definition.acceptedMediaTypes
              ? {
                  acceptedMediaTypes: Object.freeze(
                    definition.acceptedMediaTypes.map((mediaType) =>
                      requireText(mediaType, 'mediaType'),
                    ),
                  ),
                }
              : {}),
          }),
        ];
      }),
    ),
  );
}

export function validateGenerationAssetReferenceBindings(
  schema: GenerationAssetReferenceSchema,
  bindings: GenerationAssetReferenceBindings,
): GenerationAssetReferenceBindings {
  const normalizedSchema = cloneGenerationAssetReferenceSchema(schema);
  const normalizedBindings = cloneGenerationAssetReferenceBindings(bindings);
  const unknownSlots = Object.keys(normalizedBindings).filter(
    (slot) => normalizedSchema[slot] === undefined,
  );

  if (unknownSlots.length > 0) {
    throw new Error(
      `GenerationTask 包含未声明的 AssetReference slot：${unknownSlots.join(', ')}`,
    );
  }

  for (const [slot, slotSchema] of Object.entries(normalizedSchema)) {
    const references = normalizedBindings[slot] ?? [];
    const minItems = slotSchema.minItems ?? (slotSchema.required ? 1 : 0);
    const maxItems =
      slotSchema.maxItems ??
      (slotSchema.cardinality === 'one' ? 1 : Number.POSITIVE_INFINITY);

    if (
      references.length < minItems ||
      references.length > maxItems ||
      new Set(references.map(({ assetId }) => assetId)).size !==
        references.length
    ) {
      throw new Error(
        `GenerationTask AssetReference slot ${slot} 数量或重复项无效`,
      );
    }
  }

  return normalizedBindings;
}

export function clonePreparedGenerationAssetReferenceBindings(
  bindings: PreparedGenerationAssetReferenceBindings,
): PreparedGenerationAssetReferenceBindings {
  const cloned = Object.freeze(
    Object.fromEntries(
      Object.entries(bindings).map(([slot, references]) => [
        requireSlotKey(slot),
        Object.freeze(
          references.map((reference) => {
            const relativePath = requirePortableRelativePath(
              reference.relativePath,
              'relativePath',
            );
            const alias = requireText(reference.alias, 'alias');

            if (!relativePath.startsWith(`references/${alias}/`)) {
              throw new Error(
                'Prepared generation asset reference path 与 alias 不一致',
              );
            }

            const artifactInputs = reference.artifacts ?? [];

            if (
              !Array.isArray(artifactInputs) ||
              artifactInputs.length > maximumPreparedArtifactsPerReference
            ) {
              throw new Error(
                'Prepared generation asset reference artifacts 数据无效',
              );
            }

            const artifacts = Object.freeze(
              artifactInputs.map((artifact) => {
                const artifactRelativePath = requirePortableRelativePath(
                  artifact.relativePath,
                  'artifact relativePath',
                );

                if (
                  !artifactRelativePath.startsWith(
                    `references/${alias}/artifacts/`,
                  )
                ) {
                  throw new Error(
                    'Prepared generation asset artifact path 与 alias 不一致',
                  );
                }

                return Object.freeze({
                  producerId: requireText(
                    artifact.producerId,
                    'artifact producerId',
                  ),
                  artifactKey: requireText(
                    artifact.artifactKey,
                    'artifact artifactKey',
                  ),
                  mediaType: requireText(
                    artifact.mediaType,
                    'artifact mediaType',
                  ),
                  contentRevision: requireText(
                    artifact.contentRevision,
                    'artifact contentRevision',
                  ),
                  relativePath: artifactRelativePath,
                });
              }),
            );
            const artifactIdentities = artifacts.map((artifact) =>
              JSON.stringify([artifact.producerId, artifact.artifactKey]),
            );
            const artifactPaths = artifacts.map(
              ({ relativePath: artifactPath }) => artifactPath,
            );

            if (
              new Set(artifactIdentities).size !== artifactIdentities.length ||
              new Set(artifactPaths).size !== artifactPaths.length
            ) {
              throw new Error(
                'Prepared generation asset reference artifacts 包含重复项',
              );
            }

            return Object.freeze({
              alias,
              assetId: requireText(reference.assetId, 'assetId'),
              name: requireText(reference.name, 'name'),
              mediaType: requireText(reference.mediaType, 'mediaType'),
              ...(reference.workbenchId === undefined
                ? {}
                : {
                    workbenchId: requireText(
                      reference.workbenchId,
                      'workbenchId',
                    ),
                  }),
              ...(reference.materializedMediaType === undefined
                ? {}
                : {
                    materializedMediaType: requireText(
                      reference.materializedMediaType,
                      'materializedMediaType',
                    ),
                  }),
              contentRevision: requireText(
                reference.contentRevision,
                'contentRevision',
              ),
              relativePath,
              ...(artifacts.length === 0 ? {} : { artifacts }),
            });
          }),
        ),
      ]),
    ),
  );

  const aliases = Object.values(cloned).flatMap((references) =>
    references.map(({ alias }) => alias),
  );

  if (new Set(aliases).size !== aliases.length) {
    throw new Error('Prepared generation asset reference alias 重复');
  }

  return cloned;
}

export function validatePreparedGenerationAssetReferenceBindings(
  schema: GenerationAssetReferenceSchema,
  bindings: PreparedGenerationAssetReferenceBindings,
): PreparedGenerationAssetReferenceBindings {
  const normalizedSchema = cloneGenerationAssetReferenceSchema(schema);
  const normalizedBindings =
    clonePreparedGenerationAssetReferenceBindings(bindings);
  validateGenerationAssetReferenceBindings(
    normalizedSchema,
    Object.fromEntries(
      Object.entries(normalizedBindings).map(([slot, references]) => [
        slot,
        references.map(({ assetId }) => ({ assetId })),
      ]),
    ),
  );

  for (const [slot, references] of Object.entries(normalizedBindings)) {
    const acceptedMediaTypes = normalizedSchema[slot]!.acceptedMediaTypes;

    if (
      acceptedMediaTypes &&
      references.some(
        ({ mediaType }) => !acceptedMediaTypes.includes(mediaType),
      )
    ) {
      throw new Error(
        `Prepared generation asset reference slot ${slot} mediaType 无效`,
      );
    }
  }

  return normalizedBindings;
}
