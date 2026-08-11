import { describe, expect, it } from 'vitest';

import { createWorkbenchPanelStore } from './workbench-panel-store';

describe('workbench-panel-store', () => {
  it('初始状态为关闭', () => {
    const store = createWorkbenchPanelStore();
    expect(store.getState().open).toBe(false);
  });

  it('openPanel 打开面板', () => {
    const store = createWorkbenchPanelStore();
    store.getState().openPanel();
    expect(store.getState().open).toBe(true);
  });

  it('closePanel 关闭面板', () => {
    const store = createWorkbenchPanelStore();
    store.getState().openPanel();
    store.getState().closePanel();
    expect(store.getState().open).toBe(false);
  });

  it('支持订阅状态变化（宿主据此切换面板渲染）', () => {
    const store = createWorkbenchPanelStore();
    const seen: boolean[] = [];
    store.subscribe((state) => {
      seen.push(state.open);
    });
    store.getState().openPanel();
    store.getState().closePanel();
    expect(seen).toEqual([true, false]);
  });
});
