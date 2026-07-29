import type { JsonValue } from '../protocol';
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

export type CoreWorkbenchTransportFacilityId =
  | typeof CORE_RENDERER_TRANSPORT_FACILITY_ID
  | typeof CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID;

interface CaptureFacilityOptions {
  readonly capture: CoreWorkbenchTransportFacilityId;
}

interface TextSelectionFacilityOptions extends CaptureFacilityOptions {
  readonly publish: 'settled' | 'explicit';
}

interface TextSelectionFacilityEvent {
  readonly text?: string;
  readonly frameUrl?: string;
}

interface TextSelectionInputPayload {
  readonly text: string;
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

function isTextSelectionFacilityEvent(
  value: JsonValue,
): value is JsonValue & TextSelectionFacilityEvent {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === 'text' || key === 'frameUrl',
    ) &&
    (value.text === undefined ||
      (typeof value.text === 'string' &&
        value.text.length <= 16_384)) &&
    (value.frameUrl === undefined ||
      (typeof value.frameUrl === 'string' &&
        value.frameUrl.length > 0 &&
        value.frameUrl.length <= 8_192))
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
    value.text.length <= 16_384
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
  validateEvent: isTextSelectionFacilityEvent,
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
