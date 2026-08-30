// @vitest-environment jsdom

import {
  act,
  StrictMode,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import type { AssetSnapshot } from '../../shared/assets';
import type {
  WorkbenchBootstrap,
  WorkbenchEvent,
} from '../../shared/workbench/protocol';
import { HtmlWorkbenchView } from './renderer';
import {
  createHtmlDomTarget,
  htmlEditCommands,
  htmlEditEvents,
  htmlFrameCommands,
  htmlWorkbenchManifest,
} from './shared';
import { htmlEditIndicatorCommands } from './html-edit-indicator-commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const asset: AssetSnapshot = {
  id: 'asset-1',
  projectId: 'project-1',
  name: 'lesson.html',
  mediaType: 'text/html',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: 'D:\\lesson.html',
  },
  contentStatus: { availability: 'available', checkedTime: 1 },
  createdTime: 1,
  updatedTime: 1,
};

const bootstrap: WorkbenchBootstrap = {
  sessionId: 'session-1',
  workbenchId: htmlWorkbenchManifest.id,
  workbenchVersion: htmlWorkbenchManifest.version,
  protocolVersion: htmlWorkbenchManifest.protocolVersion,
  assetId: asset.id,
  mediaType: asset.mediaType,
  availability: 'available',
  payload: { contentUrl: 'learning-content://resource/token' },
};

const status = (draftRevision: string) => ({
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
  draftRevision,
});

function ActiveHtmlRuntime({ children }: { readonly children: ReactNode }) {
  const runtime = useWorkbenchRuntime();
  useLayoutEffect(() => {
    runtime.activate(
      {
        projectId: asset.projectId,
        assetId: asset.id,
        workbenchId: htmlWorkbenchManifest.id,
        sessionId: bootstrap.sessionId,
      },
      htmlWorkbenchManifest,
    );
    return () => runtime.deactivate(bootstrap.sessionId);
  }, [runtime]);
  return children;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('HTML edit event rendering', () => {
  it('shows the begun region and rebuilds the preview exactly once after applied', async () => {
    let listener: ((event: WorkbenchEvent) => void) | undefined;
    let currentRevision = 'draft-1';
    const executeCommand = vi.fn(async (command: { readonly type: string }) => {
      if (command.type === htmlFrameCommands.installSourceCopy) {
        return { payload: { installed: true } };
      }
      if (command.type === htmlEditCommands.status) {
        return { payload: status(currentRevision) };
      }
      if (
        command.type === htmlEditIndicatorCommands.show ||
        command.type === htmlEditIndicatorCommands.clear
      ) {
        return { payload: { found: true } };
      }
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const subscribeEvent = vi.fn((next: (event: WorkbenchEvent) => void) => {
      listener = next;
      return vi.fn();
    });
    const learningCompanion = {
      onWorkbenchFacilityEvent: vi.fn(() => vi.fn()),
    };
    vi.stubGlobal('learningCompanion', learningCompanion);
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: learningCompanion,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <WorkbenchConversationRuntimeProvider>
            <WorkbenchRuntimeProvider onError={vi.fn()}>
              <ActiveHtmlRuntime>
                <HtmlWorkbenchView
                  asset={asset}
                  bootstrap={bootstrap}
                  executeCommand={executeCommand as never}
                  subscribeEvent={subscribeEvent}
                  onRelink={vi.fn()}
                  onRefresh={vi.fn()}
                  onReveal={vi.fn()}
                  onInteractionChange={vi.fn()}
                  onOpenExternal={vi.fn(async () => undefined)}
                  onError={vi.fn()}
                />
              </ActiveHtmlRuntime>
            </WorkbenchRuntimeProvider>
          </WorkbenchConversationRuntimeProvider>
        </StrictMode>,
      );
    });
    const initialFrame = container.querySelector('iframe');
    if (!initialFrame || !listener) throw new Error('HTML preview did not mount');
    await act(async () => {
      initialFrame.dispatchEvent(new Event('load'));
    });
    executeCommand.mockClear();
    const target = createHtmlDomTarget({
      frameUrl: 'about:blank',
      element: { path: [1, 0], tagName: 'section' },
    });

    await act(async () => {
      listener?.({
        sessionId: 'session-1',
        type: htmlEditEvents.started,
        payload: {
          editId: 'edit-1',
          executionId: 'turn-1',
          target,
        },
      });
    });
    expect(executeCommand).toHaveBeenCalledWith({
      type: htmlEditIndicatorCommands.show,
      payload: {
        target,
        revision: 1,
        phase: 'editing',
      },
    });
    expect(container.textContent).toContain('AI 正在编辑草稿');
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="HTML 草稿工具栏"]',
      ),
    ).toBeInstanceOf(HTMLElement);
    expect(
      container.querySelector(
        'button[aria-label="撤销上一轮 AI 修改"]',
      ),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      container.querySelector(
        'button[aria-label="重做下一轮 AI 修改"]',
      ),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      container.querySelector('button[aria-label="查看草稿更改"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      container.querySelector('button[aria-label="同步草稿到原文件"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      container.querySelector('button[aria-label="放弃草稿"]'),
    ).toBeInstanceOf(HTMLButtonElement);

    currentRevision = 'draft-2';
    await act(async () => {
      listener?.({
        sessionId: 'session-1',
        type: htmlEditEvents.applied,
        payload: {
          editId: 'edit-1',
          executionId: 'turn-1',
          target,
          draftRevision: currentRevision,
        },
      });
      await Promise.resolve();
    });
    const refreshedFrame = container.querySelector('iframe');
    expect(refreshedFrame).not.toBe(initialFrame);
    expect(container.textContent).toContain('正在刷新草稿预览');

    await act(async () => {
      refreshedFrame?.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('iframe')).toBe(refreshedFrame);

    await act(async () => root.unmount());
  });
});
