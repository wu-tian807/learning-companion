import type { JsonValue } from '../protocol';
import {
  isAssetTarget,
  type ContentAnchorTarget,
} from '../anchor';
import type { WorkbenchFacilityDeclaration } from './facility-declaration';
import { WorkbenchFacilityDefinitionRegistry } from './facility-definition-registry';
import { defineWorkbenchFacility } from './facility-definition';

export const CORE_RENDERER_TRANSPORT_FACILITY_ID =
  'core.transport.renderer';
export const CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID =
  'core.transport.sandbox-frame';
export const CORE_OVERFLOW_SURFACE_FACILITY_ID =
  'core.surface.overflow';
export const CORE_CONTEXT_MENU_SURFACE_FACILITY_ID =
  'core.surface.context-menu';
export const CORE_GENERATION_CENTER_SURFACE_FACILITY_ID =
  'core.surface.generation-center';
export const CORE_TEXT_SELECTION_INPUT_FACILITY_ID =
  'core.input.text-selection';
export const CORE_FACILITY_VERSION = 1;
export const CORE_TEXT_SELECTION_MAX_LENGTH = 16_384;
export const CORE_FRAME_URL_MAX_LENGTH = 8_192;

export const coreContextMediaTypes = [
  'none',
  'image',
  'audio',
  'video',
  'canvas',
] as const;

export type CoreContextMediaType =
  (typeof coreContextMediaTypes)[number];

export type CoreWorkbenchTransportFacilityId =
  | typeof CORE_RENDERER_TRANSPORT_FACILITY_ID
  | typeof CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID;

interface CaptureFacilityOptions {
  readonly capture: CoreWorkbenchTransportFacilityId;
}

interface TextSelectionFacilityOptions extends CaptureFacilityOptions {
  readonly publish: 'settled' | 'explicit';
}

export interface CoreTextSelectionFacilityEvent {
  readonly text?: string;
  readonly frameUrl?: string;
  readonly target?: ContentAnchorTarget;
}

interface TextSelectionInputPayload {
  readonly text: string;
}

export interface SandboxFrameTransportBindingPayload {
  readonly rootUrl: string;
}

export interface CoreContextMenuFacilityEvent {
  readonly x: number;
  readonly y: number;
  readonly frameUrl: string;
  readonly selectionText?: string;
  readonly linkUrl?: string;
  readonly mediaType: CoreContextMediaType;
  readonly sourceUrl?: string;
  readonly target?: ContentAnchorTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);

  return (
    actualKeys.length === keys.length &&
    keys.every((key) => actualKeys.includes(key))
  );
}

function isTransportId(
  value: unknown,
): value is CoreWorkbenchTransportFacilityId {
  return (
    value === CORE_RENDERER_TRANSPORT_FACILITY_ID ||
    value === CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID
  );
}

function isBoundedUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CORE_FRAME_URL_MAX_LENGTH
  );
}

function isExternalHttpUrl(value: unknown): value is string {
  if (!isBoundedUrl(value)) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isContentAnchorTarget(
  value: unknown,
): value is ContentAnchorTarget {
  return isAssetTarget(value) && value.scope === 'content';
}

export function isSandboxFrameTransportBindingPayload(
  value: JsonValue,
): value is JsonValue & SandboxFrameTransportBindingPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['rootUrl']) ||
    !isBoundedUrl(value.rootUrl)
  ) {
    return false;
  }

  try {
    const url = new URL(value.rootUrl);
    const segments = url.pathname.split('/').filter(Boolean);

    return (
      url.protocol === 'learning-content:' &&
      url.hostname === 'resource' &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      !url.search &&
      !url.hash &&
      segments.length === 1
    );
  } catch {
    return false;
  }
}

function isCaptureFacilityOptions(
  value: JsonValue | undefined,
): value is JsonValue & CaptureFacilityOptions {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['capture']) &&
    isTransportId(value.capture)
  );
}

function isTextSelectionFacilityOptions(
  value: JsonValue | undefined,
): value is JsonValue & TextSelectionFacilityOptions {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['capture', 'publish']) &&
    isTransportId(value.capture) &&
    (value.publish === 'settled' || value.publish === 'explicit')
  );
}

export function isCoreTextSelectionFacilityEvent(
  value: JsonValue,
): value is JsonValue & CoreTextSelectionFacilityEvent {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) =>
        key === 'text' || key === 'frameUrl' || key === 'target',
    ) &&
    (value.text === undefined ||
      (typeof value.text === 'string' &&
        value.text.length <= CORE_TEXT_SELECTION_MAX_LENGTH)) &&
    (value.frameUrl === undefined ||
      isBoundedUrl(value.frameUrl)) &&
    (value.target === undefined ||
      isContentAnchorTarget(value.target))
  );
}

export function isCoreContextMenuFacilityEvent(
  value: JsonValue,
): value is JsonValue & CoreContextMenuFacilityEvent {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) =>
      [
        'x',
        'y',
        'frameUrl',
        'selectionText',
        'linkUrl',
        'mediaType',
        'sourceUrl',
        'target',
      ].includes(key),
    )
  ) {
    return false;
  }

  return (
    Number.isSafeInteger(value.x) &&
    Number(value.x) >= 0 &&
    Number(value.x) <= 1_000_000 &&
    Number.isSafeInteger(value.y) &&
    Number(value.y) >= 0 &&
    Number(value.y) <= 1_000_000 &&
    isBoundedUrl(value.frameUrl) &&
    (value.selectionText === undefined ||
      (typeof value.selectionText === 'string' &&
        value.selectionText.trim().length > 0 &&
        value.selectionText.length <=
          CORE_TEXT_SELECTION_MAX_LENGTH)) &&
    (value.linkUrl === undefined ||
      isExternalHttpUrl(value.linkUrl)) &&
    typeof value.mediaType === 'string' &&
    coreContextMediaTypes.includes(
      value.mediaType as CoreContextMediaType,
    ) &&
    (value.sourceUrl === undefined ||
      isExternalHttpUrl(value.sourceUrl)) &&
    (value.target === undefined ||
      isContentAnchorTarget(value.target))
  );
}

function isTextSelectionInputPayload(
  value: JsonValue,
): value is JsonValue & TextSelectionInputPayload {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['text']) &&
    typeof value.text === 'string' &&
    value.text.trim().length > 0 &&
    value.text.length <= CORE_TEXT_SELECTION_MAX_LENGTH
  );
}

function capturesDeclaredTransport(
  options: JsonValue | undefined,
  declarations: readonly WorkbenchFacilityDeclaration[],
): boolean {
  if (!isRecord(options) || !isTransportId(options.capture)) {
    return false;
  }

  return declarations.some(
    (declaration) =>
      declaration.id === options.capture &&
      declaration.version === CORE_FACILITY_VERSION,
  );
}

const noOptions = (value: JsonValue | undefined): value is undefined =>
  value === undefined;

const rendererTransportDefinition = defineWorkbenchFacility({
  id: CORE_RENDERER_TRANSPORT_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'transport',
  validateOptions: noOptions,
});

const sandboxFrameTransportDefinition = defineWorkbenchFacility({
  id: CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'transport',
  validateOptions: noOptions,
  validateBinding: isSandboxFrameTransportBindingPayload,
});

const overflowSurfaceDefinition = defineWorkbenchFacility({
  id: CORE_OVERFLOW_SURFACE_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'surface',
  validateOptions: noOptions,
});

const contextMenuSurfaceDefinition = defineWorkbenchFacility({
  id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'surface',
  validateOptions: isCaptureFacilityOptions,
  validateEvent: isCoreContextMenuFacilityEvent,
  validateDependencies: capturesDeclaredTransport,
});

const generationCenterSurfaceDefinition = defineWorkbenchFacility({
  id: CORE_GENERATION_CENTER_SURFACE_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'surface',
  validateOptions: noOptions,
});

const textSelectionInputDefinition = defineWorkbenchFacility({
  id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  version: CORE_FACILITY_VERSION,
  role: 'input',
  validateOptions: isTextSelectionFacilityOptions,
  validateEvent: isCoreTextSelectionFacilityEvent,
  validateInput: isTextSelectionInputPayload,
  inputCardinality: 'one',
  validateDependencies: capturesDeclaredTransport,
});

export function createCoreWorkbenchFacilityDefinitionRegistry(): WorkbenchFacilityDefinitionRegistry {
  const registry = new WorkbenchFacilityDefinitionRegistry();

  registry.register(rendererTransportDefinition);
  registry.register(sandboxFrameTransportDefinition);
  registry.register(overflowSurfaceDefinition);
  registry.register(contextMenuSurfaceDefinition);
  registry.register(generationCenterSurfaceDefinition);
  registry.register(textSelectionInputDefinition);

  return registry;
}

export const rendererTransportFacilityDeclaration:
  WorkbenchFacilityDeclaration = Object.freeze({
    id: CORE_RENDERER_TRANSPORT_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
  });

export const sandboxFrameTransportFacilityDeclaration:
  WorkbenchFacilityDeclaration = Object.freeze({
    id: CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
  });

export const overflowSurfaceFacilityDeclaration:
  WorkbenchFacilityDeclaration = Object.freeze({
    id: CORE_OVERFLOW_SURFACE_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
  });

export const generationCenterSurfaceFacilityDeclaration:
  WorkbenchFacilityDeclaration = Object.freeze({
    id: CORE_GENERATION_CENTER_SURFACE_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
  });

export function createContextMenuSurfaceFacilityDeclaration(
  capture: CoreWorkbenchTransportFacilityId,
): WorkbenchFacilityDeclaration {
  return {
    id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
    options: { capture },
  };
}

export function createTextSelectionInputFacilityDeclaration(
  capture: CoreWorkbenchTransportFacilityId,
  publish: TextSelectionFacilityOptions['publish'] = 'settled',
): WorkbenchFacilityDeclaration {
  return {
    id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
    version: CORE_FACILITY_VERSION,
    options: { capture, publish },
  };
}
