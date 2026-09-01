import { SubtitleTranscriptionProgressHub } from './transcription-progress';

/** App-lifetime progress channel shared by the source producer and media services. */
export const mediaSubtitleTranscriptionRuntime = Object.freeze({
  progress: new SubtitleTranscriptionProgressHub(),
});
