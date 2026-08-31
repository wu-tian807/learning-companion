import {
  cloneAssetLink,
  cloneAssetReference,
  cloneCreateAssetLinkInput,
  cloneCreateAssetReferenceInput,
  type AssetLink,
  type AssetReference,
  type CreateAssetLinkInput,
  type CreateAssetReferenceInput,
} from '../../shared/asset-associations';
import type { AssetLookup } from '../assets/asset-database';
import type { AssetDeletionObserver } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import type { AssetLinkDatabaseApi } from './asset-link-database';
import type { AssetReferenceDatabaseApi } from './asset-reference-database';

export interface AssetAssociationServiceApi {
  loadFromProject(projectId: string): void;
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  getReference(referenceId: string): AssetReference | undefined;
  listReferences(assetId: string): readonly AssetReference[];
  ensureReference(
    assetId: string,
    input: CreateAssetReferenceInput,
  ): AssetReference;
  deleteReference(referenceId: string): void;
  getLink(linkId: string): AssetLink | undefined;
  listLinks(assetId: string): readonly AssetLink[];
  ensureLink(assetId: string, input: CreateAssetLinkInput): AssetLink;
  deleteLink(linkId: string): void;
}

interface AssociationState {
  readonly referencesById: Map<string, AssetReference>;
  readonly referenceIdsByAsset: Map<string, Set<string>>;
  readonly referenceIdByPair: Map<string, string>;
  readonly linksById: Map<string, AssetLink>;
  readonly linkIdsByAsset: Map<string, Set<string>>;
  readonly linkIdByPair: Map<string, string>;
}

function createEmptyState(): AssociationState {
  return {
    referencesById: new Map(),
    referenceIdsByAsset: new Map(),
    referenceIdByPair: new Map(),
    linksById: new Map(),
    linkIdsByAsset: new Map(),
    linkIdByPair: new Map(),
  };
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`AssetAssociation ${field} 不能为空`);
  }

  return normalized;
}

function createPairKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

function addOwnedId(
  index: Map<string, Set<string>>,
  assetId: string,
  associationId: string,
): void {
  const current = index.get(assetId);

  if (current) {
    current.add(associationId);
    return;
  }

  index.set(assetId, new Set([associationId]));
}

function removeOwnedId(
  index: Map<string, Set<string>>,
  assetId: string,
  associationId: string,
): void {
  const current = index.get(assetId);

  if (!current) {
    return;
  }

  current.delete(associationId);
  if (current.size === 0) {
    index.delete(assetId);
  }
}

export class AssetAssociationService
  implements AssetAssociationServiceApi, AssetDeletionObserver
{
  private activeProjectId: string | undefined;
  private state: AssociationState = createEmptyState();

  constructor(
    private readonly referenceDatabase: AssetReferenceDatabaseApi,
    private readonly linkDatabase: AssetLinkDatabaseApi,
    private readonly projectLookup: ProjectLookup,
    private readonly assetLookup: AssetLookup,
  ) {}

  loadFromProject(projectId: string): void {
    const normalizedProjectId = requireId(projectId, 'projectId');

    if (!this.projectLookup.get(normalizedProjectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    const references = this.referenceDatabase.listByProject(
      normalizedProjectId,
    );
    const links = this.linkDatabase.listByProject(normalizedProjectId);
    const nextState = this.createState(
      normalizedProjectId,
      references,
      links,
    );

    this.activeProjectId = normalizedProjectId;
    this.state = nextState;
  }

  unloadProject(): void {
    this.activeProjectId = undefined;
    this.state = createEmptyState();
  }

  getActiveProjectId(): string | undefined {
    return this.activeProjectId;
  }

  getReference(referenceId: string): AssetReference | undefined {
    this.requireActiveProjectId();
    const reference = this.state.referencesById.get(
      requireId(referenceId, 'referenceId'),
    );
    return reference ? cloneAssetReference(reference) : undefined;
  }

  listReferences(assetId: string): readonly AssetReference[] {
    const projectId = this.requireActiveProjectId();
    const normalizedAssetId = this.requireAsset(projectId, assetId);
    const ids = this.state.referenceIdsByAsset.get(normalizedAssetId);

    if (!ids) {
      return [];
    }

    return [...ids].map((id) => {
      const reference = this.state.referencesById.get(id);

      if (!reference) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneAssetReference(reference);
    });
  }

  ensureReference(
    assetId: string,
    input: CreateAssetReferenceInput,
  ): AssetReference {
    const projectId = this.requireActiveProjectId();
    const normalizedAssetId = this.requireAsset(projectId, assetId);
    const normalizedInput = cloneCreateAssetReferenceInput(input);
    const sourceAssetId = this.requireAsset(
      projectId,
      normalizedInput.sourceAssetId,
    );

    if (normalizedAssetId === sourceAssetId) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const pairKey = createPairKey(normalizedAssetId, sourceAssetId);
    const existingId = this.state.referenceIdByPair.get(pairKey);

    if (existingId) {
      const existing = this.state.referencesById.get(existingId);

      if (!existing) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneAssetReference(existing);
    }

    const reference = this.referenceDatabase.create(
      projectId,
      normalizedAssetId,
      { sourceAssetId },
    );
    this.addReference(reference);
    return cloneAssetReference(reference);
  }

  deleteReference(referenceId: string): void {
    const projectId = this.requireActiveProjectId();
    const normalizedReferenceId = requireId(referenceId, 'referenceId');
    const reference = this.state.referencesById.get(normalizedReferenceId);

    if (!reference) {
      return;
    }

    this.referenceDatabase.delete(projectId, normalizedReferenceId);
    this.removeReference(reference);
  }

  getLink(linkId: string): AssetLink | undefined {
    this.requireActiveProjectId();
    const link = this.state.linksById.get(requireId(linkId, 'linkId'));
    return link ? cloneAssetLink(link) : undefined;
  }

  listLinks(assetId: string): readonly AssetLink[] {
    const projectId = this.requireActiveProjectId();
    const normalizedAssetId = this.requireAsset(projectId, assetId);
    const ids = this.state.linkIdsByAsset.get(normalizedAssetId);

    if (!ids) {
      return [];
    }

    return [...ids].map((id) => {
      const link = this.state.linksById.get(id);

      if (!link) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneAssetLink(link);
    });
  }

  ensureLink(assetId: string, input: CreateAssetLinkInput): AssetLink {
    const projectId = this.requireActiveProjectId();
    const normalizedAssetId = this.requireAsset(projectId, assetId);
    const normalizedInput = cloneCreateAssetLinkInput(input);
    const targetAssetId = this.requireAsset(
      projectId,
      normalizedInput.targetAssetId,
    );

    if (normalizedAssetId === targetAssetId) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const pairKey = createPairKey(normalizedAssetId, targetAssetId);
    const existingId = this.state.linkIdByPair.get(pairKey);

    if (existingId) {
      const existing = this.state.linksById.get(existingId);

      if (!existing) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return cloneAssetLink(existing);
    }

    const link = this.linkDatabase.create(projectId, normalizedAssetId, {
      targetAssetId,
    });
    this.addLink(link);
    return cloneAssetLink(link);
  }

  deleteLink(linkId: string): void {
    const projectId = this.requireActiveProjectId();
    const normalizedLinkId = requireId(linkId, 'linkId');
    const link = this.state.linksById.get(normalizedLinkId);

    if (!link) {
      return;
    }

    this.linkDatabase.delete(projectId, normalizedLinkId);
    this.removeLink(link);
  }

  onAssetDeleted(projectId: string, assetId: string): void {
    if (this.activeProjectId !== requireId(projectId, 'projectId')) {
      return;
    }

    const normalizedAssetId = requireId(assetId, 'assetId');

    for (const reference of [...this.state.referencesById.values()]) {
      if (
        reference.assetId === normalizedAssetId ||
        reference.sourceAssetId === normalizedAssetId
      ) {
        this.removeReference(reference);
      }
    }

    for (const link of [...this.state.linksById.values()]) {
      if (
        link.assetId === normalizedAssetId ||
        link.targetAssetId === normalizedAssetId
      ) {
        this.removeLink(link);
      }
    }
  }

  private createState(
    projectId: string,
    references: readonly AssetReference[],
    links: readonly AssetLink[],
  ): AssociationState {
    const nextState = createEmptyState();

    try {
      for (const reference of references) {
        this.requireAssociationAssets(
          projectId,
          reference.projectId,
          reference.assetId,
          reference.sourceAssetId,
        );
        this.addReference(reference, nextState);
      }

      for (const link of links) {
        this.requireAssociationAssets(
          projectId,
          link.projectId,
          link.assetId,
          link.targetAssetId,
        );
        this.addLink(link, nextState);
      }

      return nextState;
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }
  }

  private requireAssociationAssets(
    expectedProjectId: string,
    actualProjectId: string,
    assetId: string,
    relatedAssetId: string,
  ): void {
    if (
      actualProjectId !== expectedProjectId ||
      assetId === relatedAssetId ||
      !this.assetLookup.get(expectedProjectId, assetId) ||
      !this.assetLookup.get(expectedProjectId, relatedAssetId)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
  }

  private requireActiveProjectId(): string {
    const projectId = this.activeProjectId;

    if (!projectId) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return projectId;
  }

  private requireAsset(projectId: string, assetId: string): string {
    const normalizedAssetId = requireId(assetId, 'assetId');

    if (!this.assetLookup.get(projectId, normalizedAssetId)) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    return normalizedAssetId;
  }

  private addReference(
    reference: AssetReference,
    state: AssociationState = this.state,
  ): void {
    const normalized = cloneAssetReference(reference);
    const pairKey = createPairKey(
      normalized.assetId,
      normalized.sourceAssetId,
    );

    if (
      state.referencesById.has(normalized.id) ||
      state.referenceIdByPair.has(pairKey)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    state.referencesById.set(normalized.id, normalized);
    state.referenceIdByPair.set(pairKey, normalized.id);
    addOwnedId(
      state.referenceIdsByAsset,
      normalized.assetId,
      normalized.id,
    );
  }

  private removeReference(reference: AssetReference): void {
    this.state.referencesById.delete(reference.id);
    this.state.referenceIdByPair.delete(
      createPairKey(reference.assetId, reference.sourceAssetId),
    );
    removeOwnedId(
      this.state.referenceIdsByAsset,
      reference.assetId,
      reference.id,
    );
  }

  private addLink(
    link: AssetLink,
    state: AssociationState = this.state,
  ): void {
    const normalized = cloneAssetLink(link);
    const pairKey = createPairKey(
      normalized.assetId,
      normalized.targetAssetId,
    );

    if (
      state.linksById.has(normalized.id) ||
      state.linkIdByPair.has(pairKey)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    state.linksById.set(normalized.id, normalized);
    state.linkIdByPair.set(pairKey, normalized.id);
    addOwnedId(state.linkIdsByAsset, normalized.assetId, normalized.id);
  }

  private removeLink(link: AssetLink): void {
    this.state.linksById.delete(link.id);
    this.state.linkIdByPair.delete(
      createPairKey(link.assetId, link.targetAssetId),
    );
    removeOwnedId(this.state.linkIdsByAsset, link.assetId, link.id);
  }
}
