import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationOverlay } from './ConversationOverlay';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';

const entry: HtmlConversationEntry = Object.freeze({
  id: 'c-1',
  anchor: Object.freeze({
    anchorType: 'html.quote',
    anchorPayload: Object.freeze({ exact: '自注意力' }),
  }),
  question: '什么是自注意力？',
  answer: '自注意力允许任意两个位置直接交互。',
  createdTime: 1_720_000_000_000,
});

function createStore(entries: readonly HtmlConversationEntry[] = []) {
  const list = vi.fn(async () => entries);
  const append = vi.fn(async () => [...entries]);
  const store: HtmlConversationStore = { list, append };
  return { store, list, append };
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

  it('renders the anchor chip when an anchor is provided', () => {
    const markup = renderMarkup({
      anchor: {
        anchorType: 'html.quote',
        anchorPayload: { exact: '自注意力机制' },
      },
    });

    expect(markup).toContain('选中文本');
    expect(markup).toContain('自注意力机制');
  });

  it('renders element anchor summary', () => {
    const markup = renderMarkup({
      anchor: {
        anchorType: 'html.element',
        anchorPayload: { id: 'btn-mha', tagName: 'button' },
      },
    });

    expect(markup).toContain('元素');
    expect(markup).toContain('#btn-mha');
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
