import {
  isAssetAvailability,
  type AssetAvailability,
} from '../assets';

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
  readonly workbenchVersion: number;
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

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error('JsonValue 数据无效');
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneJsonValue));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          cloneJsonValue(entry),
        ]),
      ),
    );
  }

  return value;
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

export function isWorkbenchBootstrap(
  value: unknown,
): value is WorkbenchBootstrap {
  return (
    isRecord(value) &&
    isRequiredText(value.sessionId) &&
    isRequiredText(value.workbenchId) &&
    typeof value.workbenchVersion === 'number' &&
    Number.isSafeInteger(value.workbenchVersion) &&
    value.workbenchVersion > 0 &&
    typeof value.protocolVersion === 'number' &&
    Number.isSafeInteger(value.protocolVersion) &&
    value.protocolVersion > 0 &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.mediaType) &&
    isAssetAvailability(value.availability) &&
    isJsonValue(value.payload)
  );
}
