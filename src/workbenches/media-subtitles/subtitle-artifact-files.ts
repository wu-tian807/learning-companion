import { readFile } from 'node:fs/promises';

import { AppError } from '../../main/errors/app-error';
import {
  isSubtitleSourceTrackV1,
  isSubtitleTranslationTrackV1,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';

export async function readSubtitleSourceTrackFile(
  path: string,
): Promise<SubtitleSourceTrackV1> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isSubtitleSourceTrackV1(value)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return value;
}

export async function readSubtitleTranslationTrackFile(
  path: string,
  source: SubtitleSourceTrackV1,
  sourceTrackRevision: string,
): Promise<SubtitleTranslationTrackV1> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (
    !isSubtitleTranslationTrackV1(value) ||
    value.sourceTrackRevision !== sourceTrackRevision ||
    value.sourceLanguage !== source.language ||
    value.cues.length !== source.cues.length ||
    value.cues.some((cue, index) => cue.sourceCueId !== source.cues[index]?.id)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return value;
}
