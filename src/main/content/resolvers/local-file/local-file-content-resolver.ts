import { readFile } from 'node:fs/promises';

import writeFileAtomic from 'write-file-atomic';

import type { ContentCapability } from '../../../../shared/workbench/manifest';
import {
  createTextEncodingDetector,
  detectTextEncoding,
  TEXT_CONTENT_SAMPLE_SIZE,
} from '../../../assets/asset-text-encoding';
import {
  DefaultLocalFileContentInspector,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import { AppError } from '../../../errors/app-error';
import type {
  ContentHandle,
  ReadTextContentRequest,
  ResolvedTextContent,
  WriteTextContentRequest,
  WriteTextContentResult,
} from '../../content-handle';
import {
  LOCAL_FILE_CONTENT_KIND,
} from '../../content-ref';
import type { ContentResolver } from '../../content-resolver-registry';
import {
  createTextRevision,
  decodeTextContent,
  encodeTextContent,
} from '../../text-content';

const localTextContentCapabilities = new Set<ContentCapability>([
  'read-text',
  'write-text',
]);

export class LocalFileContentHandle implements ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability> =
    localTextContentCapabilities;

  constructor(readonly path: string) {}

  async readText(
    request: ReadTextContentRequest = {},
  ): Promise<ResolvedTextContent> {
    let content: Buffer;

    try {
      content = await readFile(this.path);
    } catch (error) {
      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }

    const encoding =
      request.encoding ??
      detectTextEncoding(
        content.subarray(0, TEXT_CONTENT_SAMPLE_SIZE),
      );

    if (!encoding) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    if (
      request.encoding &&
      detectTextEncoding(content, [
        createTextEncodingDetector(request.encoding),
      ]) !== request.encoding
    ) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    return decodeTextContent(content, encoding);
  }

  async writeText(
    request: WriteTextContentRequest,
  ): Promise<WriteTextContentResult> {
    let current: Buffer;

    try {
      current = await readFile(this.path);
    } catch (error) {
      throw new AppError('ASSET_UNAVAILABLE', { cause: error });
    }

    if (createTextRevision(current) !== request.expectedRevision) {
      throw new AppError('CONTENT_CHANGED_EXTERNALLY');
    }

    const encoded = encodeTextContent(request);

    try {
      await writeFileAtomic(this.path, encoded);
    } catch (error) {
      throw new AppError('CONTENT_WRITE_FAILED', { cause: error });
    }

    return { revision: createTextRevision(encoded) };
  }

  async close(): Promise<void> {
    return undefined;
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
