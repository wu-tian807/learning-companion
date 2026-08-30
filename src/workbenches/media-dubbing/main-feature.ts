import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import { mediaDubbingVoxCpm2Definition } from './external-libraries/voxcpm2-definition';
import { VoxCpm2DubbingRuntimeResolver } from './external-libraries/voxcpm2-runtime';
import { VoxCpm2RuntimeSetup } from './external-libraries/voxcpm2-runtime-setup';
import { DubbingSpeakerTrackArtifactProducer } from './dubbing-speaker-track-artifact';
import {
  MediaDubbingProgressHub,
  VoxCpm2DubbingProducer,
} from './voxcpm2-dubbing-producer';

export const mediaDubbingProgress = new MediaDubbingProgressHub();
export const mediaDubbingProducer = new VoxCpm2DubbingProducer(
  mediaDubbingProgress,
);
export const mediaDubbingSpeakerTrackProducer =
  new DubbingSpeakerTrackArtifactProducer();

const runtimeResolvers = new Map<
  ExternalLibraryServiceApi,
  VoxCpm2DubbingRuntimeResolver
>();

async function releaseMediaDubbingRuntimes(): Promise<void> {
  await Promise.all(
    [...runtimeResolvers.values()].map((runtime) => runtime.releaseRuntime()),
  );
}

export function resolveMediaDubbingRuntime(
  externalLibraries: ExternalLibraryServiceApi,
): VoxCpm2DubbingRuntimeResolver {
  const existing = runtimeResolvers.get(externalLibraries);
  if (existing) return existing;
  const created = new VoxCpm2DubbingRuntimeResolver(externalLibraries);
  runtimeResolvers.set(externalLibraries, created);
  return created;
}

export const mediaDubbingMainFeature = Object.freeze({
  id: 'builtin.media-dubbing',
  registerExternalLibraries({ libraries, lifecycles, runtimeSetups }): void {
    libraries.register(mediaDubbingVoxCpm2Definition);
    lifecycles.register({
      libraryId: mediaDubbingVoxCpm2Definition.id,
      release: releaseMediaDubbingRuntimes,
    });
    runtimeSetups.register(new VoxCpm2RuntimeSetup());
  },
  registerArtifactProducers({ artifacts }): void {
    artifacts.register(mediaDubbingProducer);
    artifacts.register(mediaDubbingSpeakerTrackProducer);
  },
  start({ externalLibraries }) {
    const runtime = resolveMediaDubbingRuntime(externalLibraries);
    return Object.freeze({
      shutdown(): Promise<void> {
        return runtime.shutdown();
      },
      dispose(): void {
        runtimeResolvers.delete(externalLibraries);
        void runtime.shutdown().catch(() => undefined);
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
