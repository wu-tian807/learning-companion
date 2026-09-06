// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownEditorAdapter } from './markdown-editor-adapter';
import { useMarkdownVisualEditor } from './use-markdown-visual-editor';

function Harness({ resetKey = 0 }: { readonly resetKey?: number }) {
  const { hostRef, state } = useMarkdownVisualEditor({
    enabled: true,
    resetKey,
    initialValue: '# 笔记',
    initialScrollTop: 0,
    outlineVisible: false,
    onInput: vi.fn(),
    onScroll: vi.fn(),
    onOpenExternal: vi.fn(),
    onError: vi.fn(),
  });
  return <div ref={hostRef} data-state={state} />;
}

describe('useMarkdownVisualEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const adapters: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    adapters.length = 0;
    vi.spyOn(MarkdownEditorAdapter, 'create').mockImplementation(
      async (options) => {
        expect(options.host.parentElement).toBe(container.firstElementChild);
        expect(options.initialValue).toBe('# 笔记');
        const adapter = { destroy: vi.fn() };
        adapters.push(adapter);
        return adapter as unknown as MarkdownEditorAdapter;
      },
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('owns the shared adapter lifecycle and recreates it only for a reset', async () => {
    await act(async () => root.render(<Harness />));
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('ready');
    expect(MarkdownEditorAdapter.create).toHaveBeenCalledOnce();

    await act(async () => root.render(<Harness resetKey={1} />));
    expect(MarkdownEditorAdapter.create).toHaveBeenCalledTimes(2);
    expect(adapters[0]?.destroy).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(adapters[1]?.destroy).toHaveBeenCalledOnce();
    root = createRoot(container);
  });
});
