import type { AssetAssociationService } from '../asset-associations/asset-association-service';
import type { AssetArtifactService } from '../artifacts/asset-artifact-service';
import type { AssetOwnerLookup } from '../assets/asset-database';
import type {
  AssetAggregateMutationListener,
  AssetAggregateMutationSource,
} from '../assets/asset-aggregate-mutation';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { AppError } from '../errors/app-error';

export interface AssetAggregateMutationSourceDependencies {
  readonly associations: Pick<AssetAssociationService, 'subscribe'>;
  readonly artifacts: Pick<AssetArtifactService, 'subscribe'>;
  readonly assets: AssetOwnerLookup;
  readonly attachments: Pick<AttachmentServiceApi, 'subscribe'>;
}

export function createAttachmentAggregateMutationSource(
  attachments: Pick<AttachmentServiceApi, 'subscribe'>,
): AssetAggregateMutationSource {
  return Object.freeze({
    subscribeAssetMutations: (listener: AssetAggregateMutationListener) =>
      attachments.subscribe(({ attachment }) =>
        listener({
          projectId: attachment.projectId,
          assetId: attachment.assetId,
          updatedTime: attachment.updatedTime,
        }),
      ),
  });
}

export function createAssociationAggregateMutationSource(
  associations: Pick<AssetAssociationService, 'subscribe'>,
): AssetAggregateMutationSource {
  return Object.freeze({
    subscribeAssetMutations: (listener: AssetAggregateMutationListener) =>
      associations.subscribe(({ projectId, assetId, updatedTime }) =>
        listener({ projectId, assetId, updatedTime }),
      ),
  });
}

export function createArtifactAggregateMutationSource(
  artifacts: Pick<AssetArtifactService, 'subscribe'>,
  assets: AssetOwnerLookup,
): AssetAggregateMutationSource {
  return Object.freeze({
    subscribeAssetMutations: (listener: AssetAggregateMutationListener) =>
      artifacts.subscribe(({ artifact }) => {
        const projectId = assets.getProjectId(artifact.assetId);
        if (!projectId) {
          throw new AppError('DATA_INTEGRITY_ERROR');
        }
        return listener({
          projectId,
          assetId: artifact.assetId,
          updatedTime: artifact.updatedTime,
        });
      }),
  });
}

export function createAssetAggregateMutationSources({
  associations,
  artifacts,
  assets,
  attachments,
}: AssetAggregateMutationSourceDependencies): readonly AssetAggregateMutationSource[] {
  return Object.freeze([
    createAttachmentAggregateMutationSource(attachments),
    createAssociationAggregateMutationSource(associations),
    createArtifactAggregateMutationSource(artifacts, assets),
  ]);
}
