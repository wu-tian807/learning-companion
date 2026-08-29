import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchConversationContribution } from './conversation-contracts';
import type {
  ConversationControllerActions,
  ConversationControllerState,
} from './conversation-controller';
import { ConversationPanel } from './ConversationPanel';

const actions: ConversationControllerActions = {
  setTab: vi.fn(),
  setDraft: vi.fn(),
  setPendingContext: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  reanswer: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  startNew: vi.fn(),
};

const contribution: WorkbenchConversationContribution = {
  id: 'pdf.question',
  workbenchId: 'pdf',
  contextProviderId: 'pdf.context',
  title: '资料问答',
  emptyLabel: '选择内容后提问',
  historyStore: {
    list: async () => [],
    save: async (record) => [record],
    remove: async () => [],
  },
  describeContext: () => ({ label: '第 2 页', detail: '框选内容' }),
  revealContext: vi.fn(),
  answerAction: {
    label: '放回 PDF 原文旁',
    selectionLabel: '放回选中回答片段',
    successMessage: '已放回 PDF 原文旁',
    failureMessage: '无法放回 PDF 原文旁',
    execute: vi.fn(),
  },
};

function state(
  partial: Partial<ConversationControllerState> = {},
): ConversationControllerState {
  return {
    tab: 'chat',
    conversation: {
      id: 'conversation',
      title: '新对话',
      messages: [],
      createdTime: 1,
      updatedTime: 1,
    },
    history: [],
    draft: '',
    busy: false,
    historyLoading: false,
    ...partial,
  };
}

function render(value: ConversationControllerState): string {
  return renderToStaticMarkup(
    <ConversationPanel
      state={value}
      actions={actions}
      contribution={contribution}
      projectId="project"
      assetId="asset"
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
      onError={vi.fn()}
    />,
  );
}

describe('ConversationPanel', () => {
  it('keeps source viewing, visible errors, retry/settings and new conversation in one panel', () => {
    const html = render(state({
      pendingContext: { page: 2 },
      error: {
        message: '请先配置模型',
        code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
        retryTaskId: 'task-1',
      },
    }));

    expect(html).toContain('＋ 新对话');
    expect(html).toContain('对话');
    expect(html).toContain('历史');
    expect(html).toContain('查看原文位置');
    expect(html).toContain('请先配置模型');
    expect(html).toContain('AGENT_PROVIDER_SELECTION_REQUIRED');
    expect(html).toContain('重试原任务');
    expect(html).toContain('打开模型设置');
  });

  it('renders persisted conversations as a dedicated history tab with view and delete actions', () => {
    const conversation = {
      id: 'saved',
      title: '历史问题',
      messages: [
        { id: 'q', role: 'user' as const, text: '旧问题', createdTime: 1 },
        { id: 'a', role: 'assistant' as const, text: '旧回答', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const html = render(state({
      tab: 'history',
      conversation,
      history: [conversation],
    }));

    expect(html).toContain('历史问题');
    expect(html).toContain('2 条消息');
    expect(html).toContain('查看');
    expect(html).toContain('删除');
  });

  it('keeps the history tab available while the current answer is generating', () => {
    const conversation = {
      id: 'active',
      title: '生成中的问题',
      messages: [
        { id: 'q', role: 'user' as const, text: '问题', createdTime: 1 },
        { id: 'a', role: 'assistant' as const, text: '', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const html = render(state({
      busy: true,
      activeTaskId: 'task-1',
      conversation,
      history: [conversation],
    }));
    const historyButton = html.match(/<button[^>]*>历史 1<\/button>/u)?.[0];

    expect(historyButton).toBeDefined();
    expect(historyButton).not.toContain(' disabled=""');
    expect(html).toContain('正在等待回答');

    const historyHtml = render(state({
      tab: 'history',
      busy: true,
      activeTaskId: 'task-1',
      conversation,
      history: [conversation],
    }));
    expect(historyHtml).toContain('生成中的问题');
    expect(historyHtml).toContain('当前回答完成或停止后可切换对话');
    expect(historyHtml).toContain('当前回答生成中，停止后可删除');
  });

  it('renders Markdown answers and Workbench-owned answer-action presentation', () => {
    const html = render(state({
      conversation: {
        id: 'conversation',
        title: '问题',
        messages: [
          { id: 'q', role: 'user', text: '公式是什么？', createdTime: 1 },
          {
            id: 'a',
            role: 'assistant',
            text: '**答案**：\\(x^2\\)',
            createdTime: 2,
            replyToMessageId: 'q',
          },
        ],
        createdTime: 1,
        updatedTime: 2,
      },
    }));

    expect(html).toContain('<strong>答案</strong>');
    expect(html).toContain('放回 PDF 原文旁');
    expect(html).toContain('复制');
    expect(html).toContain('继续追问');
  });
});
