import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationOverlay } from './ConversationOverlay';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';

const entry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  messages: Object.freeze([
    Object.freeze({
      role: 'user',
      text: '什么是自注意力？',
      anchor: Object.freeze({
        anchorType: 'html.quote',
        anchorPayload: Object.freeze({ exact: '自注意力' }),
      }),
    }),
    Object.freeze({
      role: 'assistant',
      text: '自注意力允许任意两个位置直接交互。',
    }),
  ]),
  createdTime: 1_720_000_000_000,
  updatedTime: 1_720_000_000_100,
});

function createStore(entries: readonly HtmlConversationEntry[] = []) {
  const list = vi.fn(async () => entries);
  const save = vi.fn(async () => [...entries]);
  const remove = vi.fn(async () => [...entries]);
  const store: HtmlConversationStore = { list, save, remove };
  return { store, list, save, remove };
}

function renderMarkup(options: {
  readonly open?: boolean;
  readonly anchor?: unknown;
  readonly store?: HtmlConversationStore;
} = {}) {
  return renderToStaticMarkup(
    <ConversationOverlay
      open={options.open ?? true}
      anchor={options.anchor as never}
      store={options.store ?? createStore().store}
      onClose={vi.fn()}
      onAsk={vi.fn() as never}
    />,
  );
}

describe('ConversationOverlay', () => {
  it('renders nothing when closed', () => {
    const markup = renderMarkup({ open: false });
    expect(markup).toBe('');
  });

  it('renders the overlay shell with input and tabs', () => {
    const markup = renderMarkup();

    expect(markup).toContain('AI 对话');
    expect(markup).toContain('对话');
    expect(markup).toContain('历史');
    expect(markup).toContain('输入你的问题');
    expect(markup).toContain('首次提问会把');
  });

  it('shows the anchor-selected marker when an anchor is provided', () => {
    const markup = renderMarkup({
      anchor: {
        anchorType: 'html.quote',
        anchorPayload: { exact: '自注意力机制' },
      },
    });

    // 锚点 chip 由 effect 设置（SSR 不执行），静态渲染验证 header 的「锚点已选」标记
    expect(markup).toContain('锚点已选');
  });

  it('shows the anchor-selected marker for element anchors', () => {
    const markup = renderMarkup({
      anchor: {
        anchorType: 'html.element',
        anchorPayload: { id: 'btn-mha', tagName: 'button' },
      },
    });

    expect(markup).toContain('锚点已选');
  });

  it('renders the empty chat state before any conversation', () => {
    const { store } = createStore([entry]);
    const markup = renderMarkup({ store });

    // SSR 不执行 useEffect，历史列表的加载发生在挂载后；
    // 静态渲染只验证对话页签的空状态结构。
    expect(markup).toContain('选择一段内容，或直接输入你的问题。');
    expect(store.list).not.toHaveBeenCalled();
  });

  it('renders the history tab button', () => {
    const markup = renderMarkup();

    expect(markup).toContain('>历史</button>');
    // 默认渲染对话页签，历史内容在点击后由 React 状态切换渲染
    expect(markup).toContain('选择一段内容，或直接输入你的问题。');
  });
});
