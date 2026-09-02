import {
  cloneAssetLink,
  cloneAssetReference,
  type AssetLink,
  type AssetReference,
} from '../../shared/asset-associations';
import {
  cloneAssetTarget,
  type AssetTarget,
} from '../../shared/workbench/asset-target';
import {
  cloneMindMapAgentLocatorV1,
  cloneMindMapDocument,
  type MindMapAgentLocatorV1,
  type MindMapDocument,
  type MindMapSubjectAssociationsV1,
  type MindMapSubjectAssociationsV2,
  type MindMapSubjectAssociationsV3,
} from './document';

export interface MindMapAssociationLookup {
  getReference(referenceId: string): AssetReference | undefined;
  getLink(linkId: string): AssetLink | undefined;
}

export interface ResolvedMindMapLegacyReferenceBinding {
  readonly reference: AssetReference;
  readonly sourceTarget: AssetTarget;
}

export interface ResolvedMindMapAgentReferenceBinding {
  readonly reference: AssetReference;
  readonly sourceRevision: string;
  readonly agentLocator: MindMapAgentLocatorV1;
}

export interface ResolvedMindMapTargetReferenceBinding {
  readonly reference: AssetReference;
  readonly sourceRevision: string;
  readonly target: AssetTarget;
}

export type ResolvedMindMapReferenceBinding =
  | ResolvedMindMapLegacyReferenceBinding
  | ResolvedMindMapAgentReferenceBinding
  | ResolvedMindMapTargetReferenceBinding;

export interface ResolvedMindMapSubjectAssociations {
  readonly references: readonly ResolvedMindMapReferenceBinding[];
  readonly links: readonly AssetLink[];
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
    Record<
      string,
      | MindMapSubjectAssociationsV1
      | MindMapSubjectAssociationsV2
      | MindMapSubjectAssociationsV3
    >
  >,
  lookup: MindMapAssociationLookup,
  staleBindings: StaleMindMapAssociationBinding[],
): Readonly<Record<string, ResolvedMindMapSubjectAssociations>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(subjectAssociations).map(
        ([subjectId, associations]) => {
          const references: ResolvedMindMapReferenceBinding[] = [];
          const links: AssetLink[] = [];

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

            if ('sourceTarget' in binding) {
              references.push(Object.freeze({
                reference: cloneAssetReference(reference),
                sourceTarget: cloneAssetTarget(binding.sourceTarget),
              }));
            } else if ('target' in binding) {
              references.push(Object.freeze({
                reference: cloneAssetReference(reference),
                sourceRevision: binding.sourceRevision,
                target: cloneAssetTarget(binding.target),
              }));
            } else {
              references.push(Object.freeze({
                reference: cloneAssetReference(reference),
                sourceRevision: binding.sourceRevision,
                agentLocator: cloneMindMapAgentLocatorV1(binding.agentLocator),
              }));
            }
          }

          for (const linkId of associations.linkIds) {
            const link = lookup.getLink(linkId);

            if (!link || link.assetId !== assetId) {
              staleBindings.push({
                subjectKind,
                subjectId,
                kind: 'link',
                associationId: linkId,
              });
              continue;
            }

            links.push(cloneAssetLink(link));
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
