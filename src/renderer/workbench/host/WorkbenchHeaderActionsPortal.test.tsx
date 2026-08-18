// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkbenchHeaderActionsPortal } from './WorkbenchHeaderActionsPortal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkbenchHeaderActionsPortal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('renders workbench-owned controls into the title-bar action slot', () => {
    const slot = document.createElement('div');
    slot.setAttribute('data-workbench-header-actions', '');
    document.body.append(slot);
    act(() => root.render(
      <WorkbenchHeaderActionsPortal>
        <button type="button">图片操作</button>
      </WorkbenchHeaderActionsPortal>,
    ));
    expect(slot.textContent).toBe('图片操作');
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the host has no title-bar slot', () => {
    act(() => root.render(
      <WorkbenchHeaderActionsPortal>
        <button type="button">图片操作</button>
      </WorkbenchHeaderActionsPortal>,
    ));
    expect(document.body.textContent).toBe('');
  });
});
