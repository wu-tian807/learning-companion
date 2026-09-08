// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LearningCompanionApi } from '../../shared/ipc';
import {
  useProjectSession,
  type ProjectSessionState,
} from './use-project-session';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useProjectSession', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  it('keeps a stale page cleanup scoped to the page that opened it', async () => {
    const oldWorkbenchCleanup = deferred();
    const opens: { projectId: string; sessionId: string }[] = [];
    const closes: { projectId: string; sessionId: string }[] = [];
    const onError = vi.fn();
    Object.assign(window, {
      learningCompanion: {
        openProject: vi.fn(async (request) => {
          opens.push(request);
          return [];
        }),
        closeProject: vi.fn(async (request) => {
          closes.push(request);
        }),
      } as unknown as LearningCompanionApi,
    });

    let currentSession: ProjectSessionState | undefined;
    function Probe() {
      currentSession = useProjectSession('project-1', onError);
      return null;
    }

    await act(async () => {
      root.render(<Probe key="old-page" />);
      await Promise.resolve();
    });
    expect(opens).toHaveLength(1);
    currentSession!.handleWorkbenchLifecycleTask(oldWorkbenchCleanup.promise);

    await act(async () => {
      root.render(<Probe key="new-page" />);
      await Promise.resolve();
    });
    expect(opens).toHaveLength(2);
    expect(opens[1]!.sessionId).not.toBe(opens[0]!.sessionId);

    await act(async () => {
      oldWorkbenchCleanup.resolve();
      await oldWorkbenchCleanup.promise;
      await Promise.resolve();
    });
    expect(closes).toEqual([
      { projectId: 'project-1', sessionId: opens[0]!.sessionId },
    ]);
  });
});
