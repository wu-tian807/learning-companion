import type { VideoDubbingSnapshot } from '../shared';

export type VideoDubbingPlaybackSource =
  | { readonly kind: 'original' }
  | {
      readonly kind: 'preview';
      readonly audioUrl: string;
      readonly revision: number;
    }
  | { readonly kind: 'final'; readonly audioUrl: string };

export function isVideoDubbingPlaybackAvailable(
  snapshot: VideoDubbingSnapshot,
): boolean {
  if (snapshot.phase === 'ready') return Boolean(snapshot.audioUrl);
  return (
    (snapshot.phase === 'cloning' ||
      snapshot.phase === 'mixing' ||
      snapshot.phase === 'interrupted' ||
      snapshot.phase === 'failed') &&
    snapshot.completedPhrases > 0 &&
    Boolean(snapshot.previewAudioUrl)
  );
}

export function resolveVideoDubbingPlayback(
  snapshot: VideoDubbingSnapshot,
  requested: boolean,
  positionMs: number,
): VideoDubbingPlaybackSource {
  if (!requested || !Number.isFinite(positionMs) || positionMs < 0) {
    return { kind: 'original' };
  }
  if (snapshot.phase === 'ready' && snapshot.audioUrl) {
    return { kind: 'final', audioUrl: snapshot.audioUrl };
  }
  if (
    (snapshot.phase !== 'cloning' &&
      snapshot.phase !== 'mixing' &&
      snapshot.phase !== 'interrupted' &&
      snapshot.phase !== 'failed') ||
    !snapshot.previewAudioUrl ||
    snapshot.completedPhrases <= 0 ||
    positionMs < snapshot.readySuffixStartMs
  ) {
    return { kind: 'original' };
  }
  return {
    kind: 'preview',
    audioUrl: snapshot.previewAudioUrl,
    revision: snapshot.completedPhrases,
  };
}
