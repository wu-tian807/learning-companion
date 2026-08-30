// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../shared/generation-tasks';
import type {
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntimeProvider } from './WorkbenchConversationRuntimeProvider';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

const taskClientMock = vi.hoisted(() => ({
  start: vi.fn(),
  retry: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

const panelMock = vi.hoisted(() => ({
  latest: undefined as unknown,
}));

vi.mock('./conversation-task-client', () => ({
  conversationTaskClient: taskClientMock,
}));

vi.mock('./ConversationPanel', () => ({
  ConversationPanel: (input: unknown) => {
    panelMock.latest = input;
    return null;
  },
}));

import { ConversationPanelHost } from './ConversationPanelHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(id: string): GenerationTaskView {
  return {
    id,
    projectId: 'project',
    definitionId: 'question',
    definitionVersion: 1,
    status: 'processing',
    metrics: {},
    createdTime: 1,
    updatedTime: 2,
  };
}

function contribution(): WorkbenchConversationContribution {
  let history: readonly ConversationRecord[] = [];
  return {
    id: 'html.assistant',
    workbenchId: 'html',
    contextProviderId: 'html.context',
    title: '网页问答',
    emptyLabel: 'empty',
    historyStore: {
      list: async () => history,
      save: async (record) => {
        history = [...history.filter(({ id }) => id !== record.id), record];
        return history;
      },
      remove: async (conversationId) => {
        history = history.filter(({ id }) => id !== conversationId);
        return history;
      },
    },
  };
}

type PanelProjection = {
  readonly state: {
    readonly activeTaskId?: string;
    readonly busy: boolean;
  };
  readonly actions: {
    readonly submit: (question: string) => void;
  };
};

describe('Workbench conversation remount lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    panelMock.latest = undefined;
    taskClientMock.start.mockReset();
    taskClientMock.retry.mockReset();
    taskClientMock.get.mockReset();
    taskClientMock.cancel.mockReset();
    taskClientMock.subscribe.mockReset();
    taskClientMock.subscribe.mockImplementation(() => () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('delivers a taskId that resolves after controller A unmounts to controller B', async () => {
    let resolveStart!: (value: {
      readonly taskId: string;
      readonly snapshot: GenerationTaskView;
    }) => void;
    taskClientMock.start.mockImplementation(() =>
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    taskClientMock.get.mockResolvedValue(task('task-late'));
    const runtime = new WorkbenchConversationRuntime();
    const registeredContribution = contribution();
    runtime.register('html:workbench-session', registeredContribution);
    runtime.open({ ownerId: 'html:workbench-session' });

    const renderHost = async (mounted: boolean) => {
      await act(async () => {
        root.render(
          <WorkbenchConversationRuntimeProvider runtime={runtime}>
            {mounted ? (
              <ConversationPanelHost projectId="project" assetId="asset" />
            ) : null}
          </WorkbenchConversationRuntimeProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit(
        'question before remount',
      );
    });
    await renderHost(false);
    await renderHost(true);
    expect((panelMock.latest as PanelProjection).state.activeTaskId)
      .toBeUndefined();

    await act(async () => {
      resolveStart({ taskId: 'task-late', snapshot: task('task-late') });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskClientMock.get).toHaveBeenCalledWith('project', 'task-late');
    expect((panelMock.latest as PanelProjection).state.activeTaskId)
      .toBe('task-late');
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);
  });
});
