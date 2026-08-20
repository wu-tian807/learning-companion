// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageWorkbenchManifest } from '../../../workbenches/image/shared';
import type { WorkbenchActionBundle } from '../actions/workbench-action-bundle';
import { WorkbenchRuntime } from '../runtime/workbench-runtime';
import { WorkbenchRuntimeContext } from '../runtime/workbench-runtime-context';
import { WorkbenchHeaderActionsHost } from './WorkbenchHeaderActionsHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const identity = {
  projectId: 'project-1',
  assetId: 'asset-1',
  workbenchId: imageWorkbenchManifest.id,
  sessionId: 'session-1',
};

describe('WorkbenchHeaderActionsHost', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders ordered controlled contributions and invokes them from the header', async () => {
    const invokeFirst = vi.fn();
    const invokeSecond = vi.fn();
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity, imageWorkbenchManifest);
    runtime.registerContributions('test.header', {
      actions: [
        { id: 'test.first', enabled: true, execute: invokeFirst },
        { id: 'test.second', enabled: false, execute: invokeSecond },
      ],
      contributions: [
        {
          id: 'test.second.header',
          actionId: 'test.second',
          surface: 'header',
          group: '20-secondary',
          order: 10,
          presentation: {
            kind: 'checkbox',
            label: '标注',
            ariaLabel: '切换标注',
            badge: '2',
            checked: true,
            disabledReason: '暂不可用',
          },
        },
        {
          id: 'test.first.header',
          actionId: 'test.first',
          surface: 'header',
          group: '10-primary',
          order: 10,
          presentation: {
            kind: 'action',
            label: '框选解释',
            tone: 'accent',
          },
        },
      ],
    } satisfies WorkbenchActionBundle);

    act(() =>
      root.render(
        <WorkbenchRuntimeContext.Provider value={runtime}>
          <WorkbenchHeaderActionsHost />
        </WorkbenchRuntimeContext.Provider>,
      ));

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '框选解释',
      '标注2',
    ]);
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[1]?.title).toBe('暂不可用');

    await act(async () => buttons[0]?.click());
    expect(invokeFirst).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'header' }),
    );
    expect(invokeSecond).not.toHaveBeenCalled();
  });

  it('renders nothing without header contributions', () => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate(identity, imageWorkbenchManifest);

    act(() =>
      root.render(
        <WorkbenchRuntimeContext.Provider value={runtime}>
          <WorkbenchHeaderActionsHost />
        </WorkbenchRuntimeContext.Provider>,
      ));

    expect(container.textContent).toBe('');
  });
});
