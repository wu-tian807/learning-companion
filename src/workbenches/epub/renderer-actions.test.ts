import { describe, expect, it, vi } from 'vitest';

import {
  isWorkbenchActionEnabled,
} from '../../renderer/workbench/actions/workbench-action';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import {
  createEpubCfiRangeTarget,
  type EpubCfiRangeAnchorV1,
} from './shared';
import { createEpubRendererActions } from './renderer-actions';

const anchor: EpubCfiRangeAnchorV1 = {
  cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:0)',
  quote: {
    exact: 'EPUB 选区',
    prefix: '前文',
    suffix: '后文',
  },
};

describe('EPUB renderer actions', () => {
  it('enables selection actions only when a CFI selection exists', () => {
    let hasSelection = false;
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => hasSelection,
      onCopySelection: vi.fn(),
      onExplainSelection: vi.fn(),
      onAskSelection: vi.fn(),
      onWriteNoteSelection: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const copy = bundle.actions.find(
      (action) => action.id === 'epub.copy-selection',
    )!;
    const explain = bundle.actions.find(
      (action) => action.id === 'epub.ai.explain-selection',
    )!;
    const ask = bundle.actions.find(
      (action) => action.id === 'epub.ai.ask-selection',
    )!;
    const writeNote = bundle.actions.find(
      (action) => action.id === 'epub.note.write-selection',
    )!;

    expect(isWorkbenchActionEnabled(copy)).toBe(false);
    expect(isWorkbenchActionEnabled(explain)).toBe(false);
    expect(isWorkbenchActionEnabled(ask)).toBe(false);
    expect(isWorkbenchActionEnabled(writeNote)).toBe(false);
    hasSelection = true;
    expect(isWorkbenchActionEnabled(copy)).toBe(true);
    expect(isWorkbenchActionEnabled(explain)).toBe(true);
    expect(isWorkbenchActionEnabled(ask)).toBe(true);
    expect(isWorkbenchActionEnabled(writeNote)).toBe(true);
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'context-menu')
        .map((entry) => entry.presentation.label),
    ).toEqual([
      '复制选中内容',
      '重新加载电子书',
      '写阅读笔记',
      '解释这段话',
      '自由提问',
      '在文件夹中显示',
    ]);
  });

  it('explains from the frozen invocation including the CFI target', async () => {
    const onExplainSelection = vi.fn();
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => true,
      onCopySelection: vi.fn(),
      onExplainSelection,
      onAskSelection: vi.fn(),
      onWriteNoteSelection: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'epub.ai.explain-selection',
    )!;
    const selection = {
      text: anchor.quote.exact,
      target: createEpubCfiRangeTarget(anchor),
    };

    await explain.execute({
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.epub',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interactionFromTextSelection(selection),
    });

    expect(onExplainSelection).toHaveBeenCalledWith(selection);
  });

  it('opens a custom question from the same frozen CFI selection', async () => {
    const onAskSelection = vi.fn();
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => true,
      onCopySelection: vi.fn(),
      onExplainSelection: vi.fn(),
      onAskSelection,
      onWriteNoteSelection: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const ask = bundle.actions.find(
      (action) => action.id === 'epub.ai.ask-selection',
    )!;
    const selection = {
      text: anchor.quote.exact,
      target: createEpubCfiRangeTarget(anchor),
    };

    await ask.execute({
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.epub',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interactionFromTextSelection(selection),
    });

    expect(onAskSelection).toHaveBeenCalledWith(selection);
  });

  it('opens a reading-note draft from the frozen CFI selection', async () => {
    const onWriteNoteSelection = vi.fn();
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => true,
      onCopySelection: vi.fn(),
      onExplainSelection: vi.fn(),
      onAskSelection: vi.fn(),
      onWriteNoteSelection,
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const writeNote = bundle.actions.find(
      (action) => action.id === 'epub.note.write-selection',
    )!;
    const selection = {
      text: anchor.quote.exact,
      target: createEpubCfiRangeTarget(anchor),
    };

    await writeNote.execute({
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.epub',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interactionFromTextSelection(selection),
    });

    expect(onWriteNoteSelection).toHaveBeenCalledWith(selection);
  });

  it('当前对话生成中时禁止再发起一个 EPUB 解释', () => {
    const bundle = createEpubRendererActions({
      ready: true,
      aiBusy: true,
      hasSelection: () => true,
      onCopySelection: vi.fn(),
      onExplainSelection: vi.fn(),
      onAskSelection: vi.fn(),
      onWriteNoteSelection: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'epub.ai.explain-selection',
    )!;
    const ask = bundle.actions.find(
      (action) => action.id === 'epub.ai.ask-selection',
    )!;
    const writeNote = bundle.actions.find(
      (action) => action.id === 'epub.note.write-selection',
    )!;
    const contribution = bundle.contributions.find(
      (entry) => entry.id === 'epub.ai.explain-selection.context-menu',
    );

    expect(isWorkbenchActionEnabled(explain)).toBe(false);
    expect(isWorkbenchActionEnabled(ask)).toBe(false);
    expect(isWorkbenchActionEnabled(writeNote)).toBe(true);
    expect(contribution?.presentation.disabledReason).toContain(
      '当前 AI 回答',
    );
  });

  it('copies from the frozen invocation while preserving the CFI anchor', async () => {
    const onCopySelection = vi.fn();
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => true,
      onCopySelection,
      onExplainSelection: vi.fn(),
      onAskSelection: vi.fn(),
      onWriteNoteSelection: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const copy = bundle.actions.find(
      (action) => action.id === 'epub.copy-selection',
    )!;
    const interaction = interactionFromTextSelection({
      text: anchor.quote.exact,
      target: createEpubCfiRangeTarget(anchor),
    });

    await copy.execute({
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.epub',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interaction,
    });

    expect(onCopySelection).toHaveBeenCalledWith('EPUB 选区');
    expect(interaction.inputs[0]?.target).toMatchObject({
      anchorType: 'epub.cfi-range',
      anchorPayload: {
        cfiRange: anchor.cfiRange,
        quote: anchor.quote,
      },
    });
  });
});
