import type { ContentCapability } from '../../shared/workbench/manifest';

export type TextLineEnding = 'lf' | 'crlf';

export interface ResolvedTextContent {
  readonly content: string;
  readonly encoding: string;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly revision: string;
}

export interface WriteTextContentRequest {
  readonly content: string;
  readonly encoding: string;
  readonly lineEnding: TextLineEnding;
  readonly hasByteOrderMark: boolean;
  readonly expectedRevision: string;
}

export interface WriteTextContentResult {
  readonly revision: string;
}

export interface ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability>;
  readText?(): Promise<ResolvedTextContent>;
  writeText?(
    request: WriteTextContentRequest,
  ): Promise<WriteTextContentResult>;
  readBytes?(): Promise<Uint8Array>;
  writeBytes?(content: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export function hasContentCapabilities(
  handle: ContentHandle,
  required: readonly ContentCapability[],
): boolean {
  return required.every((capability) => handle.capabilities.has(capability));
}
