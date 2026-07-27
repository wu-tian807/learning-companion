import { createHash } from 'node:crypto';

import iconv from 'iconv-lite';

import { AppError } from '../errors/app-error';
import type {
  ResolvedTextContent,
  TextEncoding,
  TextLineEnding,
  WriteTextContentRequest,
} from './content-handle';

const UTF8_BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

export function createTextRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
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
