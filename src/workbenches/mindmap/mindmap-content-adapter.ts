import type {
  ContentHandle,
  WriteByteContentResult,
} from '../../main/content/content-handle';
import { AppError } from '../../main/errors/app-error';
import {
  cloneMindMapDocumentV1,
  isMindMapDocumentV1,
  type MindMapDocumentV1,
} from './document';

export interface ResolvedMindMapContent {
  readonly document: MindMapDocumentV1;
  readonly revision: string;
}

export interface WriteMindMapContentRequest {
  readonly document: MindMapDocumentV1;
  readonly expectedRevision: string;
}

export type WriteMindMapContentResult = WriteByteContentResult;

export interface MindMapContentAdapter {
  read(handle: ContentHandle): Promise<ResolvedMindMapContent>;
  write(
    handle: ContentHandle,
    request: WriteMindMapContentRequest,
  ): Promise<WriteMindMapContentResult>;
}

export function decodeMindMapDocument(
  content: Uint8Array,
): MindMapDocumentV1 {
  let source: string;

  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch (error) {
    throw new AppError('CONTENT_ENCODING_UNSUPPORTED', { cause: error });
  }

  let value: unknown;

  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }

  if (!isMindMapDocumentV1(value)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return cloneMindMapDocumentV1(value);
}

export function encodeMindMapDocument(
  document: MindMapDocumentV1,
): Uint8Array {
  let normalized: MindMapDocumentV1;

  try {
    normalized = cloneMindMapDocumentV1(document);
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }

  return new TextEncoder().encode(
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
}

export class DefaultMindMapContentAdapter
  implements MindMapContentAdapter
{
  async read(handle: ContentHandle): Promise<ResolvedMindMapContent> {
    if (!handle.readBytes) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const resolved = await handle.readBytes();

    return Object.freeze({
      document: decodeMindMapDocument(resolved.content),
      revision: resolved.revision,
    });
  }

  async write(
    handle: ContentHandle,
    request: WriteMindMapContentRequest,
  ): Promise<WriteMindMapContentResult> {
    if (!handle.writeBytes || request.expectedRevision.trim().length === 0) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return handle.writeBytes({
      content: encodeMindMapDocument(request.document),
      expectedRevision: request.expectedRevision,
    });
  }
}
