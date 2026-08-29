import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import { mediaDubbingVoxCpm2Definition } from './external-libraries/voxcpm2-definition';
import { VoxCpm2DubbingRuntimeResolver } from './external-libraries/voxcpm2-runtime';
import {
  MediaDubbingProgressHub,
  VoxCpm2DubbingProducer,
} from './voxcpm2-dubbing-producer';

export const mediaDubbingProgress = new MediaDubbingProgressHub();
export const mediaDubbingProducer = new VoxCpm2DubbingProducer(
  mediaDubbingProgress,
);

const runtimeResolvers = new WeakMap<
  ExternalLibraryServiceApi,
  VoxCpm2DubbingRuntimeResolver
>();

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
  registerExternalLibraries({ libraries }): void {
    libraries.register(mediaDubbingVoxCpm2Definition);
  },
  registerArtifactProducers({ artifacts }): void {
    artifacts.register(mediaDubbingProducer);
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
