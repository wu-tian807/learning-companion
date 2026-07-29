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
      onReload: vi.fn(),
      onReveal: vi.fn(),
    });
    const copy = bundle.actions.find(
      (action) => action.id === 'epub.copy-selection',
    )!;

    expect(isWorkbenchActionEnabled(copy)).toBe(false);
    hasSelection = true;
    expect(isWorkbenchActionEnabled(copy)).toBe(true);
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'context-menu')
        .map((entry) => entry.presentation.label),
    ).toEqual([
      '复制选中内容',
      '重新加载电子书',
      '解释选中内容',
      '在文件夹中显示',
    ]);
  });

  it('copies from the frozen invocation while preserving the CFI anchor', async () => {
    const onCopySelection = vi.fn();
    const bundle = createEpubRendererActions({
      ready: true,
      hasSelection: () => true,
      onCopySelection,
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
