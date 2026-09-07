// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkbenchEventBus } from '../../main/workbench/workbench-event-bus';
import { MarkdownWorkbenchProvider } from './main';
import { MarkdownWorkbenchView } from './renderer';
import { createMarkdownSyncSourceCommand, DEFAULT_MARKDOWN_WORKBENCH_STATE, markdownCommands, markdownWorkbenchManifest } from './shared';
import { WorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime';
import { WorkbenchRuntimeContext } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import type { ContentCapability } from '../../shared/workbench/manifest';

const asset = {
  id: 'conflict-note', projectId: 'project', name: 'Conflict',
  mediaType: 'text/markdown', creationKind: 'generated',
  contentRef: { kind: 'local-file', base: 'absolute', path: '/tmp/conflict.md' },
  contentStatus: { availability: 'available', checkedTime: 1 },
  createdTime: 1, updatedTime: 1,
} as const;

function memoryDatabase() {
  const records = new Map<string, never>();
  return { get: async () => undefined, save: async () => undefined, delete: async () => undefined, records };
}

describe('Markdown conflict renderer integration', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.restoreAllMocks();
  });

  it('merges an actual Main rejection and then returns to ordinary save', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }) });
    let disk = '# saved\n';
    let revision = 'r0';
    let sequence = 0;
    const events = new WorkbenchEventBus();
    const provider = new MarkdownWorkbenchProvider(memoryDatabase(), memoryDatabase(), {
      recoveryDebounceMs: 60_000,
      workbenchEvents: events,
    });
    const context = (sessionId: string) => ({
      sessionId, asset, attachments: [], selectionReason: 'matched' as const,
      state: undefined,
      content: {
        contentRef: asset.contentRef,
        contentStatus: asset.contentStatus,
        handle: {
          capabilities: new Set<ContentCapability>(['read-bytes', 'write-bytes']),
          readBytes: async () => ({ content: Buffer.from(disk), revision }),
          writeBytes: async (request: { content: Uint8Array; expectedRevision?: string }) => {
            if (request.expectedRevision !== revision) throw new Error('stale disk');
            disk = new TextDecoder().decode(request.content);
            revision = `r${++sequence}`;
            return { revision };
          },
          close: async () => undefined,
        },
      },
    });
    const first = context('first');
    const second = context('second');
    await provider.open(first);
    const bootstrap = await provider.open(second);
    await provider.command(first, createMarkdownSyncSourceCommand({
      content: '# peer\n', lineEnding: 'lf',
      sourceViewState: { anchor: 0, head: 0, scrollTop: 0 },
      baseDocumentVersion: 0, updateId: 1,
    }));

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate({ sessionId: 'second', assetId: asset.id, projectId: asset.projectId, workbenchId: markdownWorkbenchManifest.id }, markdownWorkbenchManifest);
    await act(async () => {
      root?.render(<WorkbenchConversationRuntimeProvider><WorkbenchRuntimeContext.Provider value={runtime}>
        <MarkdownWorkbenchView asset={asset} bootstrap={{ ...bootstrap, payload: { ...(bootstrap.payload as object), state: { ...DEFAULT_MARKDOWN_WORKBENCH_STATE, viewMode: 'source', sourceViewState: { anchor: 0, head: 0, scrollTop: 0 } } } } as never}
          executeCommand={(command) => provider.command(second, command)} onRelink={() => {}} onRefresh={() => {}} onReveal={async () => {}} onInteractionChange={() => {}} onOpenExternal={async () => {}} onError={vi.fn()} subscribeEvent={events.subscribe.bind(events)} attachments={[]} refreshAttachments={async () => undefined} />
      </WorkbenchRuntimeContext.Provider></WorkbenchConversationRuntimeProvider>);
    });
    const editor = EditorView.findFromDOM(container!.querySelector('.cm-editor')!)!;
    await act(async () => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'LOCAL\n' }, userEvent: 'input.type' });
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('应用合并结果');
    await act(async () => {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '# peer\nLOCAL\n' }, userEvent: 'input.type' });
      await Promise.resolve();
      [...container!.querySelectorAll('button')].find((button) => button.textContent?.trim() === '应用合并结果')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'AFTER\n' }, userEvent: 'input.type' });
      await Promise.resolve();
      [...container!.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存')?.click();
      await Promise.resolve();
    });
    expect(disk).toBe('# peer\nLOCAL\nAFTER\n');
    await provider.close(first);
    await provider.close(second);
    runtime.deactivate();
  });
});
