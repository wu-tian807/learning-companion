import { describe, expect, it, vi } from 'vitest';

import { cloneAssetArtifact } from '../artifacts/asset-artifact';
import type { AssetArtifactServiceListener } from '../artifacts/asset-artifact-service';
import { trackAssetAggregateMutations } from '../assets/asset-aggregate-mutation';
import { createAssetAttachment } from '../attachments/attachment';
import type { AttachmentServiceListener } from '../attachments/attachment-service';
import type { AssetAssociationServiceListener } from '../asset-associations/asset-association-service';
import {
  createArtifactAggregateMutationSource,
  createAssetAggregateMutationSources,
} from './asset-aggregate-mutation-sources';

function createEventSource<
  Event,
  Listener extends (event: Event) => void | Promise<void>,
>() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event: Event): void {
      for (const listener of listeners) {
        void listener(event);
      }
    },
  };
}

describe('Asset aggregate mutation source adapters', () => {
  it('concentrates domain-event mapping at the Bootstrap boundary', () => {
    const attachmentEvents = createEventSource<
      Parameters<AttachmentServiceListener>[0],
      AttachmentServiceListener
    >();
    const associationEvents = createEventSource<
      Parameters<AssetAssociationServiceListener>[0],
      AssetAssociationServiceListener
    >();
    const artifactEvents = createEventSource<
      Parameters<AssetArtifactServiceListener>[0],
      AssetArtifactServiceListener
    >();
    const assets = {
      getProjectId: vi.fn((assetId: string) =>
        assetId === 'artifact-asset' ? 'project' : undefined,
      ),
    };
    const touchPort = { touch: vi.fn() };
    const dispose = trackAssetAggregateMutations(
      touchPort,
      createAssetAggregateMutationSources({
        associations: associationEvents,
        artifacts: artifactEvents,
        assets,
        attachments: attachmentEvents,
      }),
    );

    attachmentEvents.emit({
      type: 'changed',
      attachment: createAssetAttachment({
        id: 'attachment',
        projectId: 'project',
        assetId: 'attachment-asset',
        typeId: 'note',
        typeVersion: 1,
        target: { scope: 'asset' },
        metadata: {},
        createdTime: 10,
        updatedTime: 10,
      }),
    });
    associationEvents.emit({
      type: 'changed',
      projectId: 'project',
      assetId: 'association-asset',
      updatedTime: 20,
    });
    artifactEvents.emit({
      type: 'committed',
      artifact: cloneAssetArtifact({
        assetId: 'artifact-asset',
        producerId: 'producer',
        artifactKey: 'key',
        relativePath: '.learning-companion/artifacts/artifact.json',
        mediaType: 'application/json',
        sourceRevision: 'source',
        producerVersion: '1',
        artifactRevision: 'artifact',
        updatedTime: 30,
      }),
    });

    expect(touchPort.touch).toHaveBeenNthCalledWith(
      1,
      'project',
      'attachment-asset',
      10,
    );
    expect(touchPort.touch).toHaveBeenNthCalledWith(
      2,
      'project',
      'association-asset',
      20,
    );
    expect(touchPort.touch).toHaveBeenNthCalledWith(
      3,
      'project',
      'artifact-asset',
      30,
    );
    dispose();
  });

  it('rejects an Artifact event whose owner Asset no longer exists', () => {
    const artifactEvents = createEventSource<
      Parameters<AssetArtifactServiceListener>[0],
      AssetArtifactServiceListener
    >();
    const source = createArtifactAggregateMutationSource(
      artifactEvents,
      { getProjectId: () => undefined },
    );
    source.subscribeAssetMutations(vi.fn());

    expect(() =>
      artifactEvents.emit({
        type: 'committed',
        artifact: cloneAssetArtifact({
          assetId: 'missing',
          producerId: 'producer',
          artifactKey: 'key',
          relativePath: '.learning-companion/artifacts/artifact.json',
          mediaType: 'application/json',
          sourceRevision: 'source',
          producerVersion: '1',
          artifactRevision: 'artifact',
          updatedTime: 30,
        }),
      }),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
