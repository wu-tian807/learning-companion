import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchInvocationContext } from '../../shared/workbench/interaction';
import { isWorkbenchActionEnabled } from '../../renderer/workbench/actions/workbench-action';
import type { CoreContextMenuFacilityEvent } from '../../shared/workbench/facilities/core-facilities';
import { createTextSelectionInput } from '../../shared/workbench/selection';
import type { WorkbenchSelectionSnapshot } from '../../shared/workbench/selection';
import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import { createHtmlRendererActions } from './renderer-actions';
import {
  createHtmlDomTarget,
  createHtmlLinkTarget,
} from './shared';

const baseInvocation: WorkbenchInvocationContext = {
  projectId: 'project',
  assetId: 'asset',
  workbenchId: 'builtin.html',
  sessionId: 'session',
  origin: 'context-menu',
  inputs: [],
};

function domSelection(
  text: string,
  target: ContentAnchorTarget = createHtmlDomTarget({
    frameUrl: 'learning-content://resource/session',
    element: { path: [1], tagName: 'p', textQuote: text },
  }),
): WorkbenchSelectionSnapshot {
  return { text, target };
}

function elementTarget(): ContentAnchorTarget {
  return createHtmlDomTarget({
    frameUrl: 'learning-content://resource/session',
    element: { path: [1], tagName: 'button', id: 'btn-mha' },
  });
}

function contextWith(
  options: {
    selectionText?: string;
    target?: ContentAnchorTarget;
    linkUrl?: string;
  } = {},
): CoreContextMenuFacilityEvent {
  return {
    x: 1,
    y: 2,
    frameUrl: 'learning-content://resource/session',
    mediaType: 'none',
    ...(options.selectionText
      ? { selectionText: options.selectionText }
      : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.linkUrl ? { linkUrl: options.linkUrl } : {}),
  };
}

function rendererActions() {
  const context: { value: CoreContextMenuFacilityEvent | undefined } = {
    value: undefined,
  };
  const onExplainSelection = vi.fn();
  const onSummarizePage = vi.fn();
  const bundle = createHtmlRendererActions({
    getContext: () => context.value,
    onCopySelection: vi.fn(),
    onOpenLink: vi.fn(),
    onReload: vi.fn(),
    onReveal: vi.fn(),
    onExplainSelection,
    onSummarizePage,
  });
  const explainAction = bundle.actions.find(
    (action) => action.id === 'html.ai.explain-selection',
  )!;
  const summarizeAction = bundle.actions.find(
    (action) => action.id === 'html.ai.summarize-page',
  )!;
  return {
    context,
    explainAction,
    summarizeAction,
    onExplainSelection,
    onSummarizePage,
  };
}

describe('html AI renderer actions', () => {
  it('引用选中内容：无 context 时禁用', () => {
    const { explainAction } = rendererActions();
    expect(isWorkbenchActionEnabled(explainAction)).toBe(false);
  });

  it('引用选中内容：空白处右键（无选区无目标）时禁用', () => {
    const { context, explainAction } = rendererActions();
    context.value = contextWith();
    expect(isWorkbenchActionEnabled(explainAction)).toBe(false);
  });

  it('引用选中内容：右键命中元素时启用', () => {
    const { context, explainAction } = rendererActions();
    context.value = contextWith({ target: elementTarget() });
    expect(isWorkbenchActionEnabled(explainAction)).toBe(true);
  });

  it('引用选中内容：右键命中链接时启用', () => {
    const { context, explainAction } = rendererActions();
    context.value = contextWith({ linkUrl: 'https://example.com' });
    expect(isWorkbenchActionEnabled(explainAction)).toBe(true);
  });

  it('引用选中内容：存在非空选区时启用', () => {
    const { context, explainAction } = rendererActions();
    context.value = contextWith({ selectionText: '自注意力机制' });
    expect(isWorkbenchActionEnabled(explainAction)).toBe(true);
  });

  it('引用选中内容：selectionText 为空白时禁用', () => {
    const { context, explainAction } = rendererActions();
    context.value = contextWith({ selectionText: '   ' });
    expect(isWorkbenchActionEnabled(explainAction)).toBe(false);
  });

  it('总结当前页面始终启用（无 context 也可用）', () => {
    const { summarizeAction } = rendererActions();
    expect(isWorkbenchActionEnabled(summarizeAction)).toBe(true);
  });

  it('解释 action 执行时优先使用 invocation 中的冻结选区', async () => {
    const { context, explainAction, onExplainSelection } =
      rendererActions();
    context.value = contextWith({ target: elementTarget() });
    const target = domSelection('自注意力机制').target;
    const selection = domSelection('自注意力机制', target);
    const invocation: WorkbenchInvocationContext = {
      ...baseInvocation,
      inputs: [createTextSelectionInput(selection)],
    };

    await explainAction.execute(invocation);

    expect(onExplainSelection).toHaveBeenCalledTimes(1);
    const [targetArg] = onExplainSelection.mock.calls[0];
    expect(targetArg.anchorType).toBe('html.dom');
    expect(targetArg).toBe(target);
  });

  it('解释 action 无选区时回退到右键元素 target', async () => {
    const { context, explainAction, onExplainSelection } =
      rendererActions();
    context.value = contextWith({ target: elementTarget() });
    const invocation: WorkbenchInvocationContext = {
      ...baseInvocation,
      focus: elementTarget(),
    };

    await explainAction.execute(invocation);

    expect(onExplainSelection).toHaveBeenCalledTimes(1);
    const [targetArg] = onExplainSelection.mock.calls[0];
    expect(targetArg.anchorType).toBe('html.dom');
  });

  it('解释 action 无选区时回退到右键链接 target', async () => {
    const { context, explainAction, onExplainSelection } =
      rendererActions();
    context.value = contextWith({ linkUrl: 'https://example.com' });
    const invocation: WorkbenchInvocationContext = {
      ...baseInvocation,
      focus: createHtmlLinkTarget('https://example.com'),
    };

    await explainAction.execute(invocation);

    expect(onExplainSelection).toHaveBeenCalledTimes(1);
    const [targetArg] = onExplainSelection.mock.calls[0];
    expect(targetArg.anchorType).toBe('html.link');
  });

  it('总结 action 执行时不传递任何选区/锚点', async () => {
    const { context, summarizeAction, onSummarizePage, onExplainSelection } =
      rendererActions();
    context.value = contextWith({ target: elementTarget() });
    const selection = domSelection('选区文本');
    const invocation: WorkbenchInvocationContext = {
      ...baseInvocation,
      inputs: [createTextSelectionInput(selection)],
    };

    await summarizeAction.execute(invocation);

    expect(onSummarizePage).toHaveBeenCalledTimes(1);
    expect(onSummarizePage).toHaveBeenCalledWith();
    expect(onExplainSelection).not.toHaveBeenCalled();
  });

  it('解释 action 的回退 target 使用 invocation 冻结快照', async () => {
    const { context, explainAction, onExplainSelection } = rendererActions();
    const frozenTarget = elementTarget();
    context.value = contextWith({ target: frozenTarget });
    const invocation: WorkbenchInvocationContext = {
      ...baseInvocation,
      focus: frozenTarget,
    };

    context.value = contextWith({
      linkUrl: 'https://changed.example.com',
    });
    await explainAction.execute(invocation);

    expect(onExplainSelection).toHaveBeenCalledWith(frozenTarget);
  });

  it('invocation 无选区且 context 无目标时解释 action 不回调', async () => {
    const { explainAction, onExplainSelection } = rendererActions();
    const invocation: WorkbenchInvocationContext = { ...baseInvocation };

    await explainAction.execute(invocation);

    expect(onExplainSelection).not.toHaveBeenCalled();
  });

  it('AI busy 时解释与总结一键命令均禁用', () => {
    const context: { value: CoreContextMenuFacilityEvent | undefined } = {
      value: contextWith({ selectionText: '选区文本' }),
    };
    const bundle = createHtmlRendererActions({
      getContext: () => context.value,
      aiBusy: true,
      onCopySelection: vi.fn(),
      onOpenLink: vi.fn(),
      onReload: vi.fn(),
      onReveal: vi.fn(),
      onExplainSelection: vi.fn(),
      onSummarizePage: vi.fn(),
    });
    const explainAction = bundle.actions.find(
      (action) => action.id === 'html.ai.explain-selection',
    )!;
    const summarizeAction = bundle.actions.find(
      (action) => action.id === 'html.ai.summarize-page',
    )!;

    expect(isWorkbenchActionEnabled(explainAction)).toBe(false);
    expect(isWorkbenchActionEnabled(summarizeAction)).toBe(false);
  });
});
