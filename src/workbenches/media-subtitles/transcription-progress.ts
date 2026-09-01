import type { SubtitleSourceTrackV1 } from './contracts';

export type SubtitleTranscriptionProgressStage =
  | 'transcribing'
  | 'diarizing';

export interface SubtitleTranscriptionProgress {
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly stage: SubtitleTranscriptionProgressStage;
  readonly track: SubtitleSourceTrackV1;
}

export type SubtitleTranscriptionProgressListener = (
  progress: SubtitleTranscriptionProgress,
) => void;

export class SubtitleTranscriptionProgressHub {
  private readonly listeners = new Set<SubtitleTranscriptionProgressListener>();

  publish(progress: SubtitleTranscriptionProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: SubtitleTranscriptionProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
