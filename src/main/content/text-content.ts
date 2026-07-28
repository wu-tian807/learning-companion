import iconv from 'iconv-lite';

import {
  createTextEncodingDetector,
  detectTextEncoding,
  TEXT_CONTENT_SAMPLE_SIZE,
} from '../assets/asset-text-encoding';
import { AppError } from '../errors/app-error';
import type {
  ContentHandle,
  WriteByteContentResult,
} from './content-handle';
import { createContentRevision } from './content-revision';

const UTF8_BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

export type TextLineEnding = 'lf' | 'crlf';
export type TextEncoding = 'utf-8' | 'gbk';

export interface ReadTextContentRequest {
  readonly encoding?: TextEncoding;
}

export interface ResolvedTextContent {
  readonly content: string;
  readonly encoding: TextEncoding;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
}

export interface WriteTextContentRequest {
  readonly content: string;
  readonly encoding: TextEncoding;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly expectedRevision: string;
}

export type WriteTextContentResult = WriteByteContentResult;

export interface TextContentAdapter {
  read(
    handle: ContentHandle,
    request?: ReadTextContentRequest,
  ): Promise<ResolvedTextContent>;
  write(
    handle: ContentHandle,
    request: WriteTextContentRequest,
  ): Promise<WriteTextContentResult>;
}

export function createTextRevision(content: Uint8Array): string {
  return createContentRevision(content);
}

export function detectTextLineEnding(content: string): TextLineEnding {
  let crlfCount = 0;
  let lfCount = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') {
      continue;
    }

    if (index > 0 && content[index - 1] === '\r') {
      crlfCount += 1;
    } else {
      lfCount += 1;
    }
  }

  return crlfCount > lfCount ? 'crlf' : 'lf';
}

export function normalizeTextLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function decodeTextContent(
  content: Uint8Array,
  encoding: TextEncoding,
): ResolvedTextContent {
  if (!iconv.encodingExists(encoding)) {
    throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
  }

  const bytes = Buffer.from(content);
  const decoded = iconv.decode(bytes, encoding, { stripBOM: true });

  return {
    content: normalizeTextLineEndings(decoded),
    encoding,
    lineEnding: detectTextLineEnding(decoded),
    hasByteOrderMark:
      encoding.toLowerCase().replace(/[^a-z0-9]/g, '') === 'utf8' &&
      bytes.subarray(0, UTF8_BYTE_ORDER_MARK.length).equals(
        UTF8_BYTE_ORDER_MARK,
      ),
    revision: createTextRevision(bytes),
  };
}

export function encodeTextContent(
  request: Omit<WriteTextContentRequest, 'expectedRevision'>,
): Buffer {
  if (!iconv.encodingExists(request.encoding)) {
    throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
  }

  const normalized = normalizeTextLineEndings(request.content);
  const withOriginalLineEndings =
    request.lineEnding === 'crlf'
      ? normalized.replace(/\n/g, '\r\n')
      : normalized;
  const encoded = iconv.encode(withOriginalLineEndings, request.encoding, {
    addBOM: request.hasByteOrderMark,
  });
  const decoded = iconv.decode(encoded, request.encoding, { stripBOM: true });

  if (decoded !== withOriginalLineEndings) {
    throw new AppError('CONTENT_ENCODING_LOSS');
  }

  return encoded;
}

export class DefaultTextContentAdapter implements TextContentAdapter {
  async read(
    handle: ContentHandle,
    request: ReadTextContentRequest = {},
  ): Promise<ResolvedTextContent> {
    if (!handle.readBytes) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const resolved = await handle.readBytes();
    const encoding =
      request.encoding ??
      detectTextEncoding(
        resolved.content.subarray(0, TEXT_CONTENT_SAMPLE_SIZE),
      );

    if (!encoding) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    if (
      request.encoding &&
      detectTextEncoding(resolved.content, [
        createTextEncodingDetector(request.encoding),
      ]) !== request.encoding
    ) {
      throw new AppError('CONTENT_ENCODING_UNSUPPORTED');
    }

    return {
      ...decodeTextContent(resolved.content, encoding),
      revision: resolved.revision,
    };
  }

  async write(
    handle: ContentHandle,
    request: WriteTextContentRequest,
  ): Promise<WriteTextContentResult> {
    if (!handle.writeBytes) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return handle.writeBytes({
      content: encodeTextContent(request),
      expectedRevision: request.expectedRevision,
    });
  }
}
