import type { ContentCapability } from '../../shared/workbench/manifest';

export interface ByteRange {
  readonly start: number;
  readonly endExclusive: number;
}

export interface ResolvedByteContent {
  readonly content: Uint8Array;
  readonly revision: string;
}

export interface ResolvedByteStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly byteLength: number;
  readonly revision?: string;
}

export interface WriteByteContentRequest {
  readonly content: Uint8Array;
  readonly expectedRevision: string;
}

export interface WriteByteContentResult {
  readonly revision: string;
}

export interface ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability>;
  readBytes?(): Promise<ResolvedByteContent>;
  getByteLength?(): Promise<number>;
  openByteStream?(range?: ByteRange): Promise<ResolvedByteStream>;
  writeBytes?(
    request: WriteByteContentRequest,
  ): Promise<WriteByteContentResult>;
  close(): Promise<void>;
}

export function hasContentCapabilities(
  handle: ContentHandle,
  required: readonly ContentCapability[],
): boolean {
  return required.every((capability) => handle.capabilities.has(capability));
}
