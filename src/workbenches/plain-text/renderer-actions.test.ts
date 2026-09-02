import { describe, expect, it, vi } from 'vitest';

import {
  isWorkbenchActionEnabled,
} from '../../renderer/workbench/actions/workbench-action';
import {
  interactionFromTextSelection,
} from '../../shared/workbench/selection';
import { createTextRangeTarget } from '../../shared/workbench/text-range-target';
import {
  createPlainTextRendererActions,
} from './renderer-actions';
import {
  DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
  PLAIN_TEXT_RANGE_ANCHOR_TYPE,
} from './shared';

describe('Plain Text renderer actions', () => {
  it('enables the AI explain action only when text is selected', () => {
    let hasSelection = false;
    const bundle = createPlainTextRendererActions({
      disabled: false,
      encodingDisabled: false,
      encoding: 'utf-8',
      lineEnding: 'lf',
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
      hasSelection: () => hasSelection,
      onAiExplain: vi.fn(),
      onSetEncoding: vi.fn(async () => undefined),
      onSetLineEnding: vi.fn(async () => undefined),
      onSetViewOptions: vi.fn(async () => undefined),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'plain-text.ai.explain-selection',
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

  it('asks AI with the selected text and its text-range anchor', async () => {
    const onAiExplain = vi.fn();
    const bundle = createPlainTextRendererActions({
      disabled: false,
      encodingDisabled: false,
      encoding: 'utf-8',
      lineEnding: 'lf',
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
      hasSelection: () => true,
      onAiExplain,
      onSetEncoding: vi.fn(async () => undefined),
      onSetLineEnding: vi.fn(async () => undefined),
      onSetViewOptions: vi.fn(async () => undefined),
    });
    const explain = bundle.actions.find(
      (action) => action.id === 'plain-text.ai.explain-selection',
    )!;
    const source = '选中的文本';
    const target = createTextRangeTarget(
      PLAIN_TEXT_RANGE_ANCHOR_TYPE,
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
      workbenchId: 'builtin.plain-text',
      sessionId: 'session-1',
      origin: 'context-menu',
      ...interaction,
    });

    expect(onAiExplain).toHaveBeenCalledWith(source, target);
  });

  it('toggles read mode through view options', () => {
    const onSetViewOptions = vi.fn(async () => undefined);
    const bundle = createPlainTextRendererActions({
      disabled: false,
      encodingDisabled: false,
      encoding: 'utf-8',
      lineEnding: 'lf',
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
      hasSelection: () => false,
      onAiExplain: vi.fn(),
      onSetEncoding: vi.fn(async () => undefined),
      onSetLineEnding: vi.fn(async () => undefined),
      onSetViewOptions,
    });
    const toggle = bundle.actions.find(
      (action) => action.id === 'plain-text.toggle-read-mode',
    )!;

    toggle.execute({} as never);

    expect(onSetViewOptions).toHaveBeenCalledWith({
      wordWrap: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS.wordWrap,
      lineNumbers: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS.lineNumbers,
      readMode: false,
    });
  });
});
