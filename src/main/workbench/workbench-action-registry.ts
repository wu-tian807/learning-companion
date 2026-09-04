import { AppError } from '../errors/app-error';
import type { JsonValue } from '../../shared/workbench/protocol';

export type WorkbenchActionHandler = (
  projectId: string,
  payload: JsonValue | undefined,
) => Promise<JsonValue> | JsonValue;

export interface WorkbenchActionRegistryApi {
  register(id: string, handler: WorkbenchActionHandler): void;
  invoke(
    id: string,
    projectId: string,
    payload: JsonValue | undefined,
  ): Promise<JsonValue>;
}

const ACTION_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

export class WorkbenchActionRegistry implements WorkbenchActionRegistryApi {
  private readonly handlers = new Map<string, WorkbenchActionHandler>();

  register(id: string, handler: WorkbenchActionHandler): void {
    if (!ACTION_ID_PATTERN.test(id) || this.handlers.has(id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    this.handlers.set(id, handler);
  }

  async invoke(
    id: string,
    projectId: string,
    payload: JsonValue | undefined,
  ): Promise<JsonValue> {
    const handler = this.handlers.get(id);
    if (!handler) throw new AppError('FEATURE_NOT_SUPPORTED');
    return handler(projectId, payload);
  }
}
