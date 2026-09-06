// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectRightPanelSlot } from './ProjectRightPanelSlot';

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 600,
    top: 0,
    right: width,
    bottom: 600,
    left: 0,
    toJSON: () => ({}),
  };
}

describe('ProjectRightPanelSlot resizing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('drags the learning-note left border while preserving a readable workbench width', () => {
    act(() => {
      root.render(
        <div data-layout>
          <div data-workbench />
          <ProjectRightPanelSlot
            panel="learning-note"
            inline
            generation={null}
            conversation={null}
            learningNote={<div>note</div>}
          />
        </div>,
      );
    });
    const layout = container.querySelector<HTMLElement>('[data-layout]')!;
    const workbench = container.querySelector<HTMLElement>('[data-workbench]')!;
    const panel = container.querySelector<HTMLElement>('#project-right-panel')!;
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!;
    layout.getBoundingClientRect = () => rect(1_200);
    workbench.getBoundingClientRect = () => rect(600);
    panel.getBoundingClientRect = () => rect(
      Number.parseFloat(panel.style.width) || 390,
    );

    act(() => {
      separator.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 400,
      }));
      window.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 100,
      }));
    });

    // Only 180px can be taken from the 600px workbench because it must keep
    // the configured 420px readable area.
    expect(panel.style.width).toBe('570px');
    expect(separator.getAttribute('aria-valuenow')).toBe('570');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
  });

  it('supports keyboard resizing and clamps to the minimum width', () => {
    act(() => {
      root.render(
        <ProjectRightPanelSlot
          panel="learning-note"
          inline={false}
          generation={null}
          conversation={null}
          learningNote={<div>note</div>}
        />,
      );
    });
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!;
    const panel = container.querySelector<HTMLElement>('#project-right-panel')!;

    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Home',
      }));
    });

    expect(panel.style.width).toBe('318px');
    expect(separator.getAttribute('aria-valuenow')).toBe('318');
  });
});
