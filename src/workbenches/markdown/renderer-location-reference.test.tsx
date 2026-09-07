// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({ default: vi.fn() }));

import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { WorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime';
import { WorkbenchRuntimeContext } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { getLatestWorkbenchLocationSnapshot, resetWorkbenchLocationSnapshotsForTests } from '../../renderer/workbench/location-snapshot-store';
import { MarkdownWorkbenchView } from './renderer';
import {
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  markdownCommands,
  markdownWorkbenchManifest,
} from './shared';

const asset = {
  id: 'note', projectId: 'project', name: 'Note', mediaType: 'text/markdown',
  creationKind: 'generated',
  contentRef: { kind: 'local-file', base: 'absolute', path: '/tmp/note.md' },
  contentStatus: { availability: 'available', checkedTime: 1 },
  createdTime: 1, updatedTime: 1,
} as const;

describe('Markdown location reference actions', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    resetWorkbenchLocationSnapshotsForTests();
    vi.restoreAllMocks();
  });

  it('explicitly freezes a clean source selection and inserts it at the current source bookmark', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true, value: () => [],
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    });
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate({
      projectId: asset.projectId, assetId: asset.id,
      workbenchId: markdownWorkbenchManifest.id, sessionId: 'note-session',
    }, markdownWorkbenchManifest);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <WorkbenchConversationRuntimeProvider>
          <WorkbenchRuntimeContext.Provider value={runtime}>
            <MarkdownWorkbenchView
              asset={asset}
              bootstrap={{
                sessionId: 'note-session', viewportId: 'primary-material',
                workbenchId: markdownWorkbenchManifest.id,
                workbenchVersion: markdownWorkbenchManifest.version,
                protocolVersion: markdownWorkbenchManifest.protocolVersion,
                assetId: asset.id, mediaType: asset.mediaType, availability: 'available',
                payload: {
                  diskSource: 'quoted source', workingBuffer: 'quoted source',
                  encoding: 'utf-8', lineEnding: 'lf', hasByteOrderMark: false,
                  revision: 'r1', documentVersion: 0,
                  state: { ...DEFAULT_MARKDOWN_WORKBENCH_STATE, viewMode: 'source' },
                },
              }}
              executeCommand={vi.fn(async (command) => ({
                payload: command.type === markdownCommands.saveViewState
                  ? { saved: true, savedTime: 1 }
                  : { accepted: true, dirty: true, documentVersion: 1 },
              } as never))}
              onRelink={() => undefined} onRefresh={() => undefined}
              onReveal={async () => undefined}
              onInteractionChange={(interaction) => {
                runtime.publishInteraction('note-session', interaction);
              }}
              onOpenExternal={async () => undefined} onError={vi.fn()}
            />
          </WorkbenchRuntimeContext.Provider>
        </WorkbenchConversationRuntimeProvider>,
      );
    });
    const editor = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    await act(async () => {
      editor.dispatch({ selection: { anchor: 0, head: 6 } });
      await Promise.resolve();
    });
    const posAtCoords = vi.spyOn(editor, 'posAtCoords').mockReturnValue(3);
    await act(async () => {
      editor.contentDOM.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 10, clientY: 10,
      }));
      await Promise.resolve();
    });
    expect(await runtime.invoke(
      'markdown.capture-location-reference',
      runtime.store.getState().contextMenu!.invocation,
    )).toBe('executed');
    expect(getLatestWorkbenchLocationSnapshot('project')?.reference).toMatchObject({
      assetId: 'note', sourceRevision: 'r1',
    });

    posAtCoords.mockReturnValue(editor.state.doc.length);
    await act(async () => {
      editor.contentDOM.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 10, clientY: 10,
      }));
      await Promise.resolve();
    });
    const invocation = runtime.store.getState().contextMenu?.invocation;
    expect(invocation).toBeDefined();
    await act(async () => {
      await runtime.invoke('markdown.insert-location-reference', invocation!);
    });

    expect(editor.state.doc.toString()).toContain(
      '#learning-companion-location-v2=',
    );
  });
});
