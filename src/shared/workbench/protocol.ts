import type { AssetAvailability } from '../ipc';

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface WorkbenchOpenRequest {
  readonly assetId: string;
}

export interface WorkbenchBootstrap {
  readonly sessionId: string;
  readonly workbenchId: string;
  readonly protocolVersion: number;
  readonly assetId: string;
  readonly mediaType: string;
  readonly availability: AssetAvailability;
  readonly payload: JsonValue;
}

export interface WorkbenchCommand {
  readonly type: string;
  readonly payload?: JsonValue;
}

export interface WorkbenchCommandRequest {
  readonly sessionId: string;
  readonly command: WorkbenchCommand;
}

export interface WorkbenchCommandResult {
  readonly payload: JsonValue;
}

export interface WorkbenchCloseRequest {
  readonly sessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isJsonValue(entry))
  );
}

export function isWorkbenchOpenRequest(
  value: unknown,
): value is WorkbenchOpenRequest {
  return isRecord(value) && isRequiredText(value.assetId);
}

export function isWorkbenchCommandRequest(
  value: unknown,
): value is WorkbenchCommandRequest {
  if (!isRecord(value) || !isRequiredText(value.sessionId)) {
    return false;
  }

  const command = value.command;

  return (
    isRecord(command) &&
    isRequiredText(command.type) &&
    (command.payload === undefined || isJsonValue(command.payload))
  );
}

export function isWorkbenchCloseRequest(
  value: unknown,
): value is WorkbenchCloseRequest {
  return isRecord(value) && isRequiredText(value.sessionId);
}
