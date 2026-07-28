import { createReadStream, type ReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import writeFileAtomic from 'write-file-atomic';

import type { ContentCapability } from '../../../../shared/workbench/manifest';
import {
  DefaultLocalFileContentInspector,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import { AppError } from '../../../errors/app-error';
import type {
  ByteRange,
  ContentHandle,
  ResolvedByteContent,
  ResolvedByteStream,
  WriteByteContentRequest,
  WriteByteContentResult,
} from '../../content-handle';
import { createContentRevision } from '../../content-revision';
import {
  LOCAL_FILE_CONTENT_KIND,
} from '../../content-ref';
import type { ContentResolver } from '../../content-resolver-registry';

const localFileContentCapabilities = new Set<ContentCapability>([
  'read-bytes',
  'read-stream',
  'write-bytes',
]);

export class LocalFileContentHandle implements ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability> =
    localFileContentCapabilities;
  private readonly activeStreams = new Set<ReadStream>();

  constructor(readonly path: string) {}

  async getByteLength(): Promise<number> {
    try {
      return (await stat(this.path)).size;
    } catch (error) {
      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }
  }

  async readBytes(): Promise<ResolvedByteContent> {
    let content: Buffer;

    try {
      content = await readFile(this.path);
    } catch (error) {
      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }

    return {
      content,
      revision: createContentRevision(content),
    };
  }

  async openByteStream(
    range?: ByteRange,
  ): Promise<ResolvedByteStream> {
    const totalByteLength = await this.getByteLength();

    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.endExclusive) ||
        range.start < 0 ||
        range.endExclusive <= range.start ||
        range.endExclusive > totalByteLength)
    ) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    const nodeStream = createReadStream(this.path, {
      ...(range
        ? {
            start: range.start,
            end: range.endExclusive - 1,
          }
        : {}),
    });
    this.activeStreams.add(nodeStream);
    const release = () => {
      this.activeStreams.delete(nodeStream);
    };
    nodeStream.once('close', release);

    return {
      stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      byteLength: range
        ? range.endExclusive - range.start
        : totalByteLength,
    };
  }

  async writeBytes(
    request: WriteByteContentRequest,
  ): Promise<WriteByteContentResult> {
    let current: Buffer;

    try {
      current = await readFile(this.path);
    } catch (error) {
      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }

    if (createContentRevision(current) !== request.expectedRevision) {
      throw new AppError('CONTENT_CHANGED_EXTERNALLY');
    }

    const content = Buffer.from(request.content);

    try {
      await writeFileAtomic(this.path, content);
    } catch (error) {
      throw new AppError('CONTENT_WRITE_FAILED', { cause: error });
    }

    return { revision: createContentRevision(content) };
  }

  async close(): Promise<void> {
    for (const stream of this.activeStreams) {
      stream.destroy();
    }
    this.activeStreams.clear();
  }
}

export class LocalFileContentResolver implements ContentResolver {
  readonly kind = LOCAL_FILE_CONTENT_KIND;

  constructor(
    private readonly inspector: LocalFileContentInspector =
      new DefaultLocalFileContentInspector(),
  ) {}

  async resolve(ref: Parameters<ContentResolver['resolve']>[0]) {
    if (ref.kind !== LOCAL_FILE_CONTENT_KIND) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const inspection = await this.inspector.inspect(ref.path);

    return {
      contentRef: inspection.contentRef,
      contentStatus: inspection.contentStatus,
      handle:
        inspection.contentStatus.availability === 'available'
          ? new LocalFileContentHandle(inspection.contentRef.path)
          : undefined,
    };
  }
}
