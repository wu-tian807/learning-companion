import type {
  ContentHandle,
  WriteByteContentResult,
} from '../../main/content/content-handle';
import { AppError } from '../../main/errors/app-error';
import {
  cloneMindMapDocument,
  isMindMapDocument,
  type MindMapDocument,
} from './document';

export interface ResolvedMindMapContent {
  readonly document: MindMapDocument;
  readonly revision: string;
}

export interface WriteMindMapContentRequest {
  readonly document: MindMapDocument;
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
): MindMapDocument {
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

  if (!isMindMapDocument(value)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return cloneMindMapDocument(value);
}

export function encodeMindMapDocument(
  document: MindMapDocument,
): Uint8Array {
  let normalized: MindMapDocument;

  try {
    normalized = cloneMindMapDocument(document);
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
