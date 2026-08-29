import { LocalFileContentHandle } from '../../main/content/resolvers/local-file/local-file-content-resolver';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import type { JsonValue } from '../../shared/workbench/protocol';
import {
  cloneMediaDubbingSnapshot,
  type MediaDubbingSnapshot,
} from './contracts';
import type { MediaDubbingServiceSnapshot } from './media-dubbing-service';

interface PreviewResource {
  readonly path: string;
  readonly handle: LocalFileContentHandle;
  readonly url: string;
}

function toPublicSnapshot(
  snapshot: MediaDubbingServiceSnapshot,
  resources: {
    readonly audioUrl?: string;
    readonly previewAudioUrl?: string;
  } = {},
): JsonValue & MediaDubbingSnapshot {
  return cloneMediaDubbingSnapshot({
    phase: snapshot.phase,
    completedPhrases: snapshot.completedPhrases,
    totalPhrases: snapshot.totalPhrases,
    completedDurationMs: snapshot.completedDurationMs,
    durationMs: snapshot.durationMs,
    readySuffixStartMs: snapshot.readySuffixStartMs,
    ...(resources.audioUrl ? { audioUrl: resources.audioUrl } : {}),
    ...(resources.previewAudioUrl
      ? { previewAudioUrl: resources.previewAudioUrl }
      : {}),
    ...(snapshot.message ? { message: snapshot.message } : {}),
  });
}

export class MediaDubbingSessionResources {
  private artifactHandle?: LocalFileContentHandle;
  private artifactRevision?: string;
  private audioUrl?: string;
  private preview?: PreviewResource;
  private snapshot: JsonValue & MediaDubbingSnapshot;

  constructor(
    private readonly sessionId: string,
    private readonly resources: ContentResourceServiceApi,
    initialSnapshot: MediaDubbingSnapshot,
  ) {
    this.snapshot = cloneMediaDubbingSnapshot(initialSnapshot);
  }

  attach(
    snapshot: MediaDubbingServiceSnapshot,
  ): JsonValue & MediaDubbingSnapshot {
    if (
      snapshot.phase === 'ready' &&
      snapshot.artifactPath &&
      snapshot.artifactRevision &&
      this.artifactRevision !== snapshot.artifactRevision
    ) {
      void this.artifactHandle?.close();
      const handle = new LocalFileContentHandle(snapshot.artifactPath);
      this.audioUrl = this.resources.register(
        this.sessionId,
        handle,
        'audio/mp4',
      );
      this.artifactHandle = handle;
      this.artifactRevision = snapshot.artifactRevision;
    }

    if (snapshot.phase === 'ready' && this.audioUrl) {
      void this.preview?.handle.close();
      this.preview = undefined;
      this.snapshot = toPublicSnapshot(snapshot, { audioUrl: this.audioUrl });
    } else if (
      (snapshot.phase === 'cloning' ||
        snapshot.phase === 'mixing' ||
        snapshot.phase === 'interrupted' ||
        snapshot.phase === 'failed') &&
      snapshot.previewAudioPath
    ) {
      if (this.preview?.path !== snapshot.previewAudioPath) {
        void this.preview?.handle.close();
        const handle = new LocalFileContentHandle(snapshot.previewAudioPath);
        this.preview = {
          path: snapshot.previewAudioPath,
          handle,
          url: this.resources.register(this.sessionId, handle, 'audio/wav'),
        };
      }
      this.snapshot = toPublicSnapshot(snapshot, {
        previewAudioUrl: this.preview.url,
      });
    } else {
      this.snapshot = toPublicSnapshot(snapshot);
    }

    return cloneMediaDubbingSnapshot(this.snapshot);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.artifactHandle?.close(),
      this.preview?.handle.close(),
    ]);
  }
}
