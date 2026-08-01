import {
  cloneAssetLink,
  cloneAssetReference,
  type AssetLink,
  type AssetReference,
} from '../../shared/asset-associations';
import {
  cloneAssetTarget,
  type AssetTarget,
} from '../../shared/workbench/anchor';
import {
  cloneMindMapDocumentV1,
  type MindMapDocumentV1,
} from './shared';

export interface MindMapAssociationLookup {
  getReference(referenceId: string): AssetReference | undefined;
  getLink(linkId: string): AssetLink | undefined;
}

export interface ResolvedMindMapReferenceBinding {
  readonly reference: AssetReference;
  readonly sourceTarget: AssetTarget;
}

export interface ResolvedMindMapNodeAssociations {
  readonly references: readonly ResolvedMindMapReferenceBinding[];
  readonly links: readonly AssetLink[];
}

export interface StaleMindMapAssociationBinding {
  readonly nodeId: string;
  readonly kind: 'reference' | 'link';
  readonly associationId: string;
}

export interface ResolvedMindMapAssociations {
  readonly byNode: Readonly<
    Record<string, ResolvedMindMapNodeAssociations>
  >;
  readonly staleBindings: readonly StaleMindMapAssociationBinding[];
}

export function resolveMindMapAssociations(
  assetId: string,
  document: MindMapDocumentV1,
  lookup: MindMapAssociationLookup,
): ResolvedMindMapAssociations {
  const normalizedAssetId = assetId.trim();

  if (normalizedAssetId.length === 0) {
    throw new Error('Mind Map assetId 无效');
  }

  const normalizedDocument = cloneMindMapDocumentV1(document);
  const staleBindings: StaleMindMapAssociationBinding[] = [];
  const byNode = Object.fromEntries(
    Object.entries(normalizedDocument.nodeAssociations).map(
      ([nodeId, associations]) => {
        const references: ResolvedMindMapReferenceBinding[] = [];
        const links: AssetLink[] = [];

        for (const binding of associations.references) {
          const reference = lookup.getReference(binding.referenceId);

          if (!reference || reference.assetId !== normalizedAssetId) {
            staleBindings.push({
              nodeId,
              kind: 'reference',
              associationId: binding.referenceId,
            });
            continue;
          }

          references.push(
            Object.freeze({
              reference: cloneAssetReference(reference),
              sourceTarget: cloneAssetTarget(binding.sourceTarget),
            }),
          );
        }

        for (const linkId of associations.linkIds) {
          const link = lookup.getLink(linkId);

          if (!link || link.assetId !== normalizedAssetId) {
            staleBindings.push({
              nodeId,
              kind: 'link',
              associationId: linkId,
            });
            continue;
          }

          links.push(cloneAssetLink(link));
        }

        return [
          nodeId,
          Object.freeze({
            references: Object.freeze(references),
            links: Object.freeze(links),
          }),
        ];
      },
    ),
  );

  return Object.freeze({
    byNode: Object.freeze(byNode),
    staleBindings: Object.freeze(
      staleBindings.map((binding) => Object.freeze(binding)),
    ),
  });
}
