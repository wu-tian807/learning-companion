import { describe, expect, it, vi } from 'vitest';

import {
  isWorkbenchActionEnabled,
} from '../../renderer/workbench/actions/workbench-action';
import {
  interactionFromTextSelection,
} from '../../shared/workbench/selection';
import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import {
  createMarkdownRendererActions,
} from './renderer-actions';
import {
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
} from './shared';

describe('Markdown renderer actions', () => {
  it('enables the AI explain action only when text is selected', () => {
    let hasSelection = false;
    const bundle = createMarkdownRendererActions({
      disabled: false,
      encodingDisabled: false,
      encoding: 'utf-8',
      lineEnding: 'lf',
      viewState: DEFAULT_MARKDOWN_WORKBENCH_STATE,
      hasSelection: () => hasSelection,
      onAiExplain: vi.fn(),
      onSetEncoding: vi.fn(async () => undefined),
      onSetLineEnding: vi.fn(async () => undefined),
      onSetViewState: vi.fn(async () => undefined),
      onReveal: vi.fn(),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'markdown.ai.explain-selection',
    )!;

    expect(isWorkbenchActionEnabled(explain)).toBe(false);
    hasSelection = true;
    expect(isWorkbenchActionEnabled(explain)).toBe(true);
    expect(
      bundle.contributions
        .filter((entry) => entry.surface === 'context-menu')
        .map((entry) => entry.presentation.label),
    ).toEqual(['就选中内容问 AI']);
  });

  it('asks AI with the selected text and its source anchor', async () => {
    const onAiExplain = vi.fn();
    const bundle = createMarkdownRendererActions({
      disabled: false,
      encodingDisabled: false,
      encoding: 'utf-8',
      lineEnding: 'lf',
      viewState: DEFAULT_MARKDOWN_WORKBENCH_STATE,
      hasSelection: () => true,
      onAiExplain,
      onSetEncoding: vi.fn(async () => undefined),
      onSetLineEnding: vi.fn(async () => undefined),
      onSetViewState: vi.fn(async () => undefined),
      onReveal: vi.fn(),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'markdown.ai.explain-selection',
    )!;
    const source = '**选中的文本**';
    const target = createTextRangeTarget(
      MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
      source,
      [{ start: 0, end: source.length }],
    );
    const interaction = interactionFromTextSelection({
      text: source,
      target,
    });

    await explain.execute({
      projectId: 'project-1',
      assetId: 'asset-1',
      workbenchId: 'builtin.markdown',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interaction,
    });

    expect(onAiExplain).toHaveBeenCalledWith(source, target);
  });
});
