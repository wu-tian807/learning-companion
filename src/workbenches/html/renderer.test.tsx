// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { WorkbenchConversationRuntime } from '../../renderer/conversation/workbench-conversation-runtime';
import type { AssetSnapshot } from '../../shared/assets';
import type {
  WorkbenchBootstrap,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import {
  HTML_DOCUMENT_SANDBOX,
  HtmlDocumentFrame,
  HtmlWorkbenchView,
  installHtmlSourceCopyInFrame,
  pendingHtmlTextSelection,
} from './renderer';
import {
  HTML_WORKBENCH_ID,
  createHtmlDomTarget,
  htmlWorkbenchManifest,
  htmlFrameCommands,
} from './shared';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './conversation/html-conversation-context';

vi.mock('../../renderer/workbench/runtime/use-workbench-contributions', () => ({
  useWorkbenchContributions: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程页面',
  mediaType: 'text/html',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/private/lesson.html',
  },
  contentStatus: { availability: 'available', checkedTime: 100 },
  createdTime: 100,
  updatedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: HTML_WORKBENCH_ID,
    workbenchVersion: htmlWorkbenchManifest.version,
    protocolVersion: htmlWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchConversationRuntimeProvider>
      <WorkbenchRuntimeProvider onError={vi.fn()}>
        <HtmlWorkbenchView
          asset={asset}
          bootstrap={bootstrap}
          executeCommand={vi.fn()}
          onRelink={vi.fn()}
          onRefresh={vi.fn()}
          onReveal={vi.fn()}
          onInteractionChange={vi.fn()}
          onOpenExternal={vi.fn(async () => undefined)}
          onError={vi.fn()}
        />
      </WorkbenchRuntimeProvider>
    </WorkbenchConversationRuntimeProvider>,
  );
}

const editingStatus = {
  editable: true,
  hasDraft: true,
  unsynced: true,
  syncRequested: false,
  pending: true,
  stepCount: 0,
  changeCount: 1,
  canUndo: false,
  canRedo: false,
  conflict: null,
  draftRevision: 'draft-1',
} as const;

async function mountHtmlWorkbench(options: {
  readonly conversationRuntime?: WorkbenchConversationRuntime;
  readonly anchorFound?: boolean;
} = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previousBridge = window.learningCompanion;
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const onError = vi.fn();
  const executeCommand = vi.fn(async (command: { readonly type: string }) => ({
    payload:
      command.type === htmlFrameCommands.installSourceCopy
        ? { installed: true }
        : command.type === 'html.edit.review'
          ? {
              entries: [{
                taskId: 'task-1',
                changes: [{ before: '<h1>旧标题</h1>', after: '<h1>新标题</h1>' }],
              }],
              pendingChanges: [],
            }
        : command.type === 'html.edit.status'
          ? editingStatus
          : command.type === 'html.anchor.highlight'
            ? { found: options.anchorFound ?? true }
          : { found: true },
  }));
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: HTML_WORKBENCH_ID,
    workbenchVersion: htmlWorkbenchManifest.version,
    protocolVersion: htmlWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload: {
      contentUrl: 'learning-content://resource/html',
      editing: editingStatus,
    },
  };
  Object.defineProperty(window, 'learningCompanion', {
    configurable: true,
    value: {
      onWorkbenchFacilityEvent: vi.fn(() => () => undefined),
    },
  });

  await act(async () => {
    root.render(
      <WorkbenchConversationRuntimeProvider runtime={options.conversationRuntime}>
        <WorkbenchRuntimeProvider onError={vi.fn()}>
          <HtmlWorkbenchView
            asset={asset}
            bootstrap={bootstrap}
            executeCommand={executeCommand as never}
            subscribeEvent={(listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            }}
            onRelink={vi.fn()}
            onRefresh={vi.fn()}
            onReveal={vi.fn()}
            onInteractionChange={vi.fn()}
            onOpenExternal={vi.fn(async () => undefined)}
            onError={onError}
          />
        </WorkbenchRuntimeProvider>
      </WorkbenchConversationRuntimeProvider>,
    );
  });

  const publish = async (event: WorkbenchEvent) => {
    await act(async () => {
      for (const listener of listeners) listener(event);
      await Promise.resolve();
    });
  };

  return {
    container,
    executeCommand,
    onError,
    publish,
    cleanup() {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'learningCompanion', {
        configurable: true,
        value: previousBridge,
      });
    },
  };
}

describe('HtmlWorkbenchView', () => {
  it('installs source-aware copy behavior through the Workbench command path', async () => {
    const executeCommand = vi.fn(async () => ({
      payload: { installed: true },
    }));

    await expect(
      installHtmlSourceCopyInFrame(executeCommand),
    ).resolves.toBeUndefined();
    expect(executeCommand).toHaveBeenCalledWith({
      type: htmlFrameCommands.installSourceCopy,
    });
  });

  it('rejects an invalid source-copy install result', async () => {
    await expect(
      installHtmlSourceCopyInFrame(
        vi.fn(async () => ({ payload: { installed: false } })),
      ),
    ).rejects.toThrow('source-copy installer returned invalid data');
  });

  it('runs original HTML in a script-capable isolated frame', () => {
    const markup = renderToStaticMarkup(
      <HtmlDocumentFrame
        contentUrl="learning-content://resource/html"
        title="交互讲义"
      />,
    );

    expect(markup).toContain(
      'src="learning-content://resource/html"',
    );
    expect(markup).toContain('aria-label="HTML 原文沙箱"');
    expect(HTML_DOCUMENT_SANDBOX).toContain('allow-scripts');
    expect(HTML_DOCUMENT_SANDBOX).toContain('allow-pointer-lock');
    expect(HTML_DOCUMENT_SANDBOX).not.toContain('allow-same-origin');
    expect(HTML_DOCUMENT_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('renders only the original document without a reader-mode shell', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/html',
    });

    expect(markup).toContain('HTML 原文沙箱');
    expect(markup).toContain('正在加载 HTML 原文及外部资源');
    expect(markup).not.toContain('阅读模式');
    expect(markup).not.toContain('原文模式');
    expect(markup).not.toContain('/private/lesson.html');
  });

  it('renders a compact draft toolbar with stable editing controls', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/html',
      editing: {
        ...editingStatus,
        pending: false,
        stepCount: 2,
        changeCount: 3,
        canUndo: true,
      },
    });

    expect(markup).toContain('aria-label="HTML 草稿操作"');
    expect(markup).toContain('草稿 · 2 步 · 3 处');
    expect(markup).toContain('aria-label="撤销上一步"');
    expect(markup).toContain('aria-label="重做下一步"');
    expect(markup).toContain('查看更改');
    expect(markup).toContain('同步');
    expect(markup).toContain('放弃');
  });

  it('rejects non-scoped content URLs', () => {
    const markup = render({
      contentUrl: 'file:///private/lesson.html',
    });

    expect(markup).toContain('HTML Workbench 数据无效');
  });

  it('keeps the inferred DOM element when the text gesture is consumed', () => {
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/html',
      element: {
        path: [1, 2],
        tagName: 'tr',
        textQuote: '表格里的重复文字',
      },
    });
    const rect = { x: 20, y: 40, width: 120, height: 36 };
    const pending = pendingHtmlTextSelection(
      interactionFromTextSelection({
        text: '表格里的重复文字',
        target,
      }),
      rect,
    );

    expect(pending?.target).toBe(target);
    expect(pending?.target.anchorPayload).toMatchObject({
      element: { path: [1, 2], tagName: 'tr' },
    });
    expect(pending?.rect).toEqual(rect);
    expect(pending?.target.anchorPayload).not.toHaveProperty('rect');
    expect(pending?.target.anchorPayload).not.toHaveProperty('range');
  });

  it('shows the target edit state and reloads exactly once after a successful replace', async () => {
    const view = await mountHtmlWorkbench();
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/html',
      element: { path: [1, 0], tagName: 'main', id: 'lesson' },
    });
    const event = (type: string, payload: WorkbenchEvent['payload']): WorkbenchEvent => ({
      sessionId: 'session',
      type,
      payload,
    });

    try {
      const initialFrame = view.container.querySelector('iframe');
      await view.publish(event('html.agent-edit.started', {
        taskId: 'task-1',
        editId: 'edit-1',
        target,
      }));
      expect(view.executeCommand).toHaveBeenCalledWith({
        type: 'html.edit-visual.show',
        payload: { target, revision: 1, phase: 'scanning' },
      });
      expect(view.container.querySelector('iframe')).toBe(initialFrame);

      await view.publish(event('html.agent-edit.rejected', {
        taskId: 'task-1',
        editId: 'edit-1',
        target,
        reason: 'HTML_FRAGMENT_UNCLOSED',
      }));
      expect(view.executeCommand).toHaveBeenCalledWith({
        type: 'html.edit-visual.show',
        payload: { target, revision: 2, phase: 'rejected' },
      });
      expect(view.container.querySelector('iframe')).toBe(initialFrame);

      const applied = event('html.agent-edit.applied', {
        taskId: 'task-1',
        editId: 'edit-1',
        target,
        draftRevision: 'draft-2',
      });
      await view.publish(applied);
      const refreshedFrame = view.container.querySelector('iframe');
      expect(refreshedFrame).not.toBe(initialFrame);
      expect(view.executeCommand).toHaveBeenCalledWith({
        type: 'html.edit.status',
      });

      await view.publish(applied);
      expect(view.container.querySelector('iframe')).toBe(refreshedFrame);
    } finally {
      view.cleanup();
    }
  });

  it('reloads draft-changing session events but treats sync as status-only', async () => {
    const view = await mountHtmlWorkbench();
    const event = (reason: string): WorkbenchEvent => ({
      sessionId: 'session',
      type: 'html.agent-edit.session-changed',
      payload: { reason },
    });

    try {
      let frame = view.container.querySelector('iframe');
      await view.publish(event('sync'));
      expect(view.container.querySelector('iframe')).toBe(frame);

      for (const reason of ['undo', 'redo', 'rollback', 'discard']) {
        await view.publish(event(reason));
        const refreshed = view.container.querySelector('iframe');
        expect(refreshed).not.toBe(frame);
        frame = refreshed;
      }
    } finally {
      view.cleanup();
    }
  });

  it('clears the target visual when a begun edit ends without replacement', async () => {
    const view = await mountHtmlWorkbench();
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/html',
      element: { path: [1, 0], tagName: 'section' },
    });

    try {
      await view.publish({
        sessionId: 'session',
        type: 'html.agent-edit.ended',
        payload: { taskId: 'task-1', editId: 'edit-1', target },
      });
      expect(view.executeCommand).toHaveBeenCalledWith({
        type: 'html.edit-visual.clear',
        payload: { target, revision: 1 },
      });
    } finally {
      view.cleanup();
    }
  });

  it('opens the persisted draft diff and sends sync through Workbench commands', async () => {
    const view = await mountHtmlWorkbench();

    try {
      await act(async () => {
        view.container
          .querySelector<HTMLButtonElement>('[aria-label="查看 HTML 更改"]')!
          .click();
      });
      const review = view.container.querySelector(
        '[role="dialog"][aria-label="HTML 草稿更改"]',
      );
      expect(review?.textContent).toContain('旧标题');
      expect(review?.textContent).toContain('新标题');

      await act(async () => {
        view.container
          .querySelector<HTMLButtonElement>('[aria-label="同步 HTML 草稿"]')!
          .click();
      });
      expect(view.executeCommand).toHaveBeenCalledWith({
        type: 'html.edit.sync',
      });
    } finally {
      view.cleanup();
    }
  });

  it('reports a changed original quote only when a history reveal cannot locate it', async () => {
    const conversationRuntime = new WorkbenchConversationRuntime();
    const view = await mountHtmlWorkbench({
      conversationRuntime,
      anchorFound: false,
    });
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/html',
      element: {
        path: [1, 0],
        tagName: 'p',
        textQuote: '已经被修改的引用原文',
      },
    });

    try {
      await act(async () => {
        view.container.querySelector('iframe')?.dispatchEvent(new Event('load'));
        await Promise.resolve();
      });
      await act(async () => {
        await conversationRuntime.revealContext(
          {
            assetId: asset.id,
            contributionId: 'html.assistant',
            contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
          },
          target,
          () => undefined,
        );
        await Promise.resolve();
      });

      expect(view.onError).toHaveBeenCalledWith(
        '引用原文已被修改，无法定位到原位置。',
      );
    } finally {
      view.cleanup();
      conversationRuntime.dispose();
    }
  });
});
