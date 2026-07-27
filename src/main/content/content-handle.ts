import type { ContentCapability } from '../../shared/workbench/manifest';

export interface ResolvedTextContent {
  readonly content: string;
  readonly encoding: string;
}

export interface ContentHandle {
  readonly capabilities: ReadonlySet<ContentCapability>;
  readText?(): Promise<ResolvedTextContent>;
  writeText?(content: string): Promise<void>;
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
