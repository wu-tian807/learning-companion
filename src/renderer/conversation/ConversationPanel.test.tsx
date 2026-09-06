import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  ConversationMessageContextSource,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import type {
  ConversationControllerActions,
  ConversationControllerState,
} from './conversation-controller';
import { ConversationPanel } from './ConversationPanel';
import type { ConversationModePresentation } from './conversation-mode';

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
  contextProviderId: 'pdf.context',
  answerAction: {
    label: '放回 PDF 原文旁',
    selectionLabel: '放回选中回答片段',
    successMessage: '已放回 PDF 原文旁',
    failureMessage: '无法放回 PDF 原文旁',
    execute: vi.fn(),
  },
};

const contextSource = {
  contextProviderId: contribution.contextProviderId,
  assetId: 'asset',
  sourceAssetMode: 'reference' as const,
};

const context = {
  target: {
    scope: 'content' as const,
    targetType: 'pdf.region',
    targetVersion: 1,
    targetPayload: { pageNumber: 2, quote: { exact: '框选内容' } },
  },
};

function state(
  partial: Partial<ConversationControllerState> = {},
): ConversationControllerState {
  return {
    tab: 'chat',
    conversation: {
      id: 'conversation',
      modeId: 'project.general',
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

function render(
  value: ConversationControllerState,
  resolveContextContribution: (
    source: ConversationMessageContextSource | undefined,
  ) => WorkbenchConversationContribution | undefined = (source) =>
    source?.contextProviderId === contribution.contextProviderId
      ? contribution
      : undefined,
  presentation?: ConversationModePresentation,
): string {
  return renderToStaticMarkup(
    <ConversationPanel
      state={value}
      actions={actions}
      projectId="project"
      resolveContextContribution={resolveContextContribution}
      onRevealContext={vi.fn()}
      onStartNew={vi.fn()}
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
      onError={vi.fn()}
      presentation={presentation}
    />,
  );
}

describe('ConversationPanel', () => {
  it('accepts mode-specific presentation without changing chat behavior', () => {
    const html = render(
      state(),
      undefined,
      {
        title: '学习大纲规划',
        ariaLabel: '学习大纲规划会话',
        emptyLabel: '先确认你的学习目标',
        inputPlaceholder: '补充学习要求…',
      },
    );

    expect(html).toContain('学习大纲规划');
    expect(html).toContain('先确认你的学习目标');
    expect(html).toContain('补充学习要求…');
    expect(html).toContain('aria-label="学习大纲规划会话"');
  });

  it('renders and links a persisted reference without a mounted Workbench', () => {
    const html = render(state({
      conversation: {
        id: 'conversation',
        modeId: 'project.general',
        title: '已有引用',
        messages: [{
          id: 'question',
          role: 'user',
          text: '解释这里',
          createdTime: 1,
          context,
          contextSource,
        }],
        createdTime: 1,
        updatedTime: 1,
      },
    }), () => undefined);

    expect(html).toContain('第 2 页');
    expect(html).toContain('框选内容');
    expect(html).toContain('查看原文位置');
  });

  it('keeps source viewing, visible errors, retry/settings and new conversation in one panel', () => {
    const html = render(state({
      pendingContext: {
        assetId: 'asset',
        contribution,
        context,
      },
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
    const panel = html.match(
      /<section[^>]*id="project-conversation-panel"[^>]*>/u,
    )?.[0];
    expect(panel).toContain('w-full');
    expect(panel).toContain('min-w-0');
    expect(panel).not.toContain('min-w-[360px]');
    expect(panel).not.toContain('40vw');
  });

  it('renders persisted conversations as a dedicated history tab with view and delete actions', () => {
    const conversation = {
      id: 'saved',
      modeId: 'project.general',
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
      modeId: 'project.general',
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

  it('keeps the question draft editable while the current answer is generating', () => {
    const html = render(state({ busy: true, draft: '下一问' }));
    const textarea = html.match(/<textarea[^>]*>/u)?.[0];
    const submit = html.match(/<button[^>]*aria-label="发送问题"[^>]*>/u)?.[0];

    expect(textarea).toBeDefined();
    expect(textarea).not.toContain('disabled=""');
    expect(submit).toContain('disabled=""');
  });

  it('renders Markdown answers and Workbench-owned answer-action presentation', () => {
    const html = render(state({
      conversation: {
        id: 'conversation',
        modeId: 'project.general',
        title: '问题',
        messages: [
          {
            id: 'q',
            role: 'user',
            text: '公式是什么？',
            createdTime: 1,
            contextSource,
          },
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
