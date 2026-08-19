import { describe, expect, it, vi } from 'vitest';

import {
  composeWorkbenchPreloadApi,
  defineWorkbenchPreloadContribution,
  type WorkbenchPreloadContext,
} from './workbench-preload-contribution';

const context = {
  ipcRenderer: {} as never,
  invoke: vi.fn(),
} satisfies WorkbenchPreloadContext;

describe('Workbench Preload contribution composition', () => {
  it('combines statically allowlisted Workbench APIs into one frozen surface', () => {
    const first = vi.fn();
    const second = vi.fn();
    const api = composeWorkbenchPreloadApi(
      [
        defineWorkbenchPreloadContribution({
          id: 'test.first',
          createApi: (received) => {
            expect(received).toBe(context);
            return { first };
          },
        }),
        defineWorkbenchPreloadContribution({
          id: 'test.second',
          createApi: () => ({ second }),
        }),
      ] as const,
      context,
    );

    api.first();
    api.second();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('rejects duplicate contribution identities before creating any API', () => {
    const createApi = vi.fn(() => ({}));
    expect(() =>
      composeWorkbenchPreloadApi(
        [
          { id: 'test.duplicate', createApi },
          { id: 'test.duplicate', createApi },
        ],
        context,
      )).toThrow(/ID/u);
    expect(createApi).not.toHaveBeenCalled();
  });

  it('rejects API name collisions instead of silently overwriting a feature', () => {
    expect(() =>
      composeWorkbenchPreloadApi(
        [
          { id: 'test.first', createApi: () => ({ invokeFeature: vi.fn() }) },
          { id: 'test.second', createApi: () => ({ invokeFeature: vi.fn() }) },
        ],
        context,
      )).toThrow(/名称冲突/u);
  });

  it('rejects prototype-sensitive API names', () => {
    const fragment = Object.create(null) as Record<string, unknown>;
    fragment.__proto__ = { polluted: true };

    expect(() =>
      composeWorkbenchPreloadApi(
        [{ id: 'test.unsafe', createApi: () => fragment }],
        context,
      )).toThrow(/名称冲突/u);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
