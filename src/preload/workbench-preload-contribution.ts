import type { IpcRenderer } from 'electron';

export interface WorkbenchFeatureIpcInvoke {
  <Response>(channel: string, ...args: unknown[]): Promise<Response>;
}

export interface WorkbenchPreloadContext {
  readonly ipcRenderer: IpcRenderer;
  readonly invoke: WorkbenchFeatureIpcInvoke;
}

export interface WorkbenchPreloadContribution<
  TApi extends object = object,
> {
  readonly id: string;
  createApi(context: WorkbenchPreloadContext): TApi;
}

type ContributionApi<TContribution> =
  TContribution extends WorkbenchPreloadContribution<infer TApi>
    ? TApi
    : never;

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (value: TValue) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

export type ComposedWorkbenchPreloadApi<
  TContributions extends readonly WorkbenchPreloadContribution[],
> = UnionToIntersection<ContributionApi<TContributions[number]>>;

export function defineWorkbenchPreloadContribution<
  const TId extends string,
  TApi extends object,
>(
  contribution: WorkbenchPreloadContribution<TApi> & { readonly id: TId },
): WorkbenchPreloadContribution<TApi> & { readonly id: TId } {
  return Object.freeze(contribution);
}

export function emptyWorkbenchPreloadContribution<const TId extends string>(
  id: TId,
): WorkbenchPreloadContribution<Record<never, never>> & { readonly id: TId } {
  return defineWorkbenchPreloadContribution({
    id,
    createApi: () => Object.freeze({}),
  });
}

function isApiObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function composeWorkbenchPreloadApi<
  const TContributions extends readonly WorkbenchPreloadContribution[],
>(
  contributions: TContributions,
  context: WorkbenchPreloadContext,
): ComposedWorkbenchPreloadApi<TContributions> {
  const contributionIds = new Set<string>();
  for (const contribution of contributions) {
    if (!contribution.id.trim() || contributionIds.has(contribution.id)) {
      throw new Error('Workbench Preload contribution ID 无效或重复');
    }
    contributionIds.add(contribution.id);
  }

  const api = Object.create(null) as Record<string, unknown>;
  for (const contribution of contributions) {
    const fragment = contribution.createApi(context);
    if (!isApiObject(fragment)) {
      throw new Error(`Workbench Preload API 无效: ${contribution.id}`);
    }
    for (const [key, value] of Object.entries(fragment)) {
      if (
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ||
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor' ||
        Object.hasOwn(api, key)
      ) {
        throw new Error(`Workbench Preload API 名称冲突: ${key}`);
      }
      api[key] = value;
    }
  }

  return Object.freeze(api) as ComposedWorkbenchPreloadApi<TContributions>;
}
