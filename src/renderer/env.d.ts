import type { LearningCompanionApi } from '../shared/ipc';
import type { WorkbenchFeaturePreloadApi } from '../workbenches/catalog/register-preload-workbench-features';

declare global {
  interface Window {
    learningCompanion: LearningCompanionApi & WorkbenchFeaturePreloadApi;
  }
}

export {};
