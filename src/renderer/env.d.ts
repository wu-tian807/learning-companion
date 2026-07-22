import type { LearningCompanionApi } from '../shared/ipc';

declare global {
  interface Window {
    learningCompanion: LearningCompanionApi;
  }
}

export {};
