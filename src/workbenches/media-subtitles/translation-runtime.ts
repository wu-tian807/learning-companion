import {
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from './translation-producer';
import { MediaSubtitleTranslationChunkProducer } from './translation-chunk-artifact';

/**
 * App-lifetime translation collaborators shared by the subtitle task and the
 * workbenches that observe its progress. Keeping them outside either feature's
 * composition root avoids making one workbench bootstrap another one.
 */
export const mediaSubtitleTranslationRuntime = Object.freeze({
  producer: new MediaSubtitleTranslationProducer(),
  chunkProducer: new MediaSubtitleTranslationChunkProducer(),
  progress: new SubtitleTranslationProgressHub(),
});
