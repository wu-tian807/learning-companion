import {
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from './translation-producer';

/**
 * App-lifetime translation collaborators shared by the subtitle task and the
 * workbenches that observe its progress. Keeping them outside either feature's
 * composition root avoids making one workbench bootstrap another one.
 */
export const mediaSubtitleTranslationRuntime = Object.freeze({
  producer: new MediaSubtitleTranslationProducer(),
  progress: new SubtitleTranslationProgressHub(),
});
