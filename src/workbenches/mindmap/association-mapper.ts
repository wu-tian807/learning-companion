import {
  cloneAssetLink,
  cloneAssetReference,
  cloneAssetLinkTarget,
  cloneAssetReferenceTarget,
  type AssetLink,
  type AssetReference,
  type AssetLinkTarget,
  type AssetReferenceTarget,
} from '../../shared/asset-associations';
import {
  cloneMindMapDocument,
  type MindMapDocument,
  type MindMapSubjectAssociations,
} from './document';

export interface MindMapAssociationLookup {
  getReference(referenceId: string): AssetReference | undefined;
  getLink(linkId: string): AssetLink | undefined;
}

export interface ResolvedMindMapReferenceBinding {
  readonly reference: AssetReference;
  readonly binding: AssetReferenceTarget;
}

export interface ResolvedMindMapLinkBinding {
  readonly link: AssetLink;
  readonly binding: AssetLinkTarget;
}

export interface ResolvedMindMapSubjectAssociations {
  readonly references: readonly ResolvedMindMapReferenceBinding[];
  readonly links: readonly ResolvedMindMapLinkBinding[];
}

export type MindMapAssociationSubjectKind = 'node' | 'frame';

export interface StaleMindMapAssociationBinding {
  readonly subjectKind: MindMapAssociationSubjectKind;
  readonly subjectId: string;
  readonly kind: 'reference' | 'link';
  readonly associationId: string;
}

export interface ResolvedMindMapAssociations {
  readonly byNode: Readonly<
    Record<string, ResolvedMindMapSubjectAssociations>
  >;
  readonly byFrame: Readonly<
    Record<string, ResolvedMindMapSubjectAssociations>
  >;
  readonly staleBindings: readonly StaleMindMapAssociationBinding[];
}

function resolveSubjectAssociationMap(
  assetId: string,
  subjectKind: MindMapAssociationSubjectKind,
  subjectAssociations: Readonly<
    Record<string, MindMapSubjectAssociations>
  >,
  lookup: MindMapAssociationLookup,
  staleBindings: StaleMindMapAssociationBinding[],
): Readonly<Record<string, ResolvedMindMapSubjectAssociations>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(subjectAssociations).map(
        ([subjectId, associations]) => {
          const references: ResolvedMindMapReferenceBinding[] = [];
          const links: ResolvedMindMapLinkBinding[] = [];

          for (const binding of associations.references) {
            const reference = lookup.getReference(binding.referenceId);

            if (!reference || reference.assetId !== assetId) {
              staleBindings.push({
                subjectKind,
                subjectId,
                kind: 'reference',
                associationId: binding.referenceId,
              });
              continue;
            }

            references.push(Object.freeze({
              reference: cloneAssetReference(reference),
              binding: cloneAssetReferenceTarget(binding),
            }));
          }

          for (const binding of associations.links) {
            const link = lookup.getLink(binding.linkId);

            if (!link || link.assetId !== assetId) {
              staleBindings.push({
                subjectKind,
                subjectId,
                kind: 'link',
                associationId: binding.linkId,
              });
              continue;
            }

            links.push(Object.freeze({
              link: cloneAssetLink(link),
              binding: cloneAssetLinkTarget(binding),
            }));
          }

          return [
            subjectId,
            Object.freeze({
              references: Object.freeze(references),
              links: Object.freeze(links),
            }),
          ];
        },
      ),
    ),
  );
}

export function resolveMindMapAssociations(
  assetId: string,
  document: MindMapDocument,
  lookup: MindMapAssociationLookup,
): ResolvedMindMapAssociations {
  const normalizedAssetId = assetId.trim();

  if (normalizedAssetId.length === 0) {
    throw new Error('Mind Map assetId 无效');
  }

  const normalizedDocument = cloneMindMapDocument(document);
  const staleBindings: StaleMindMapAssociationBinding[] = [];
  const byNode = resolveSubjectAssociationMap(
    normalizedAssetId,
    'node',
    normalizedDocument.associations.nodes,
    lookup,
    staleBindings,
  );
  const byFrame = resolveSubjectAssociationMap(
    normalizedAssetId,
    'frame',
    normalizedDocument.associations.frames,
    lookup,
    staleBindings,
  );

  return Object.freeze({
    byNode,
    byFrame,
    staleBindings: Object.freeze(
      staleBindings.map((binding) => Object.freeze(binding)),
    ),
  });
}
