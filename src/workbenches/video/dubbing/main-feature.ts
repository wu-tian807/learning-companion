import type { MainWorkbenchFeatureContribution } from '../../../main/workbench/main-workbench-contribution';
import { videoDubbingVoxCpm2Definition } from './external-libraries/voxcpm2-definition';
import {
  VideoDubbingProgressHub,
  VoxCpm2DubbingProducer,
} from './voxcpm2-dubbing-producer';

export const videoDubbingProgress = new VideoDubbingProgressHub();
export const videoDubbingProducer = new VoxCpm2DubbingProducer(
  videoDubbingProgress,
);

export const videoDubbingMainFeature = Object.freeze({
  id: 'builtin.video.dubbing',
  registerExternalLibraries({ libraries }): void {
    libraries.register(videoDubbingVoxCpm2Definition);
  },
  registerArtifactProducers({ artifacts }): void {
    artifacts.register(videoDubbingProducer);
  },
} satisfies MainWorkbenchFeatureContribution);
