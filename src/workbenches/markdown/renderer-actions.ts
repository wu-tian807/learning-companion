import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import type {
  MarkdownEncoding,
  MarkdownLineEnding,
  MarkdownWorkbenchViewState,
} from './shared';

export interface MarkdownRendererActionsOptions {
  readonly disabled: boolean;
  readonly encodingDisabled: boolean;
  readonly encoding: MarkdownEncoding;
  readonly lineEnding: MarkdownLineEnding;
  readonly viewState: MarkdownWorkbenchViewState;
  readonly hasSelection: () => boolean;
  readonly onAiExplain: (
    text: string,
    anchor: ContentAnchorTarget,
  ) => Promise<void> | void;
  readonly onSetEncoding: (encoding: MarkdownEncoding) => Promise<void>;
  readonly onSetLineEnding: (
    lineEnding: MarkdownLineEnding,
  ) => Promise<void>;
  readonly onSetViewState: (
    state: MarkdownWorkbenchViewState,
  ) => Promise<void>;
  readonly onReveal: () => Promise<void> | void;
}

export function createMarkdownRendererActions({
  disabled,
  encodingDisabled,
  encoding,
  lineEnding,
  viewState,
  hasSelection,
  onAiExplain,
  onSetEncoding,
  onSetLineEnding,
  onSetViewState,
  onReveal,
}: MarkdownRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = disabled
    ? '当前暂时不能修改 Markdown 选项'
    : undefined;
  const encodingReason = disabled
    ? disabledReason
    : encodingDisabled
      ? '请先保存或放弃当前修改，再切换编码'
      : undefined;

  return {
    actions: [
      {
        id: 'markdown.toggle-outline',
        enabled: !disabled,
        execute: () =>
          onSetViewState({
            ...viewState,
            outlineVisible: !viewState.outlineVisible,
          }),
      },
      {
        id: 'markdown.toggle-source-wrap',
        enabled: !disabled,
        execute: () =>
          onSetViewState({
            ...viewState,
            wordWrap: !viewState.wordWrap,
          }),
      },
      ...(['lf', 'crlf'] as const).map((candidate) => ({
        id: `markdown.line-ending.${candidate}`,
        enabled: !disabled,
        execute: () => onSetLineEnding(candidate),
      })),
      ...(['utf-8', 'gbk'] as const).map((candidate) => ({
        id: `markdown.encoding.${candidate}`,
        enabled: !disabled && !encodingDisabled,
        execute: () => onSetEncoding(candidate),
      })),
      {
        id: 'markdown.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'markdown.ai.explain-selection',
        enabled: hasSelection,
        execute: (context) => {
          const selection = findTextSelectionInput(context);
          const anchor = context.focus;

          if (!selection?.text || !anchor) {
            return;
          }

          return onAiExplain(selection.text, anchor);
        },
      },
    ],
    contributions: [
      {
        id: 'markdown.toggle-outline.overflow',
        actionId: 'markdown.toggle-outline',
        surface: 'overflow',
        group: '10-view',
        order: 10,
        presentation: {
          kind: 'checkbox',
          label: '显示大纲',
          checked: viewState.outlineVisible,
          disabledReason,
          closePolicy: 'never',
        },
      },
      {
        id: 'markdown.toggle-source-wrap.overflow',
        actionId: 'markdown.toggle-source-wrap',
        surface: 'overflow',
        group: '10-view',
        order: 20,
        presentation: {
          kind: 'checkbox',
          label: '源码自动换行',
          checked: viewState.wordWrap,
          disabledReason,
          closePolicy: 'never',
        },
      },
      ...(['lf', 'crlf'] as const).map((candidate, index) => ({
        id: `markdown.line-ending.${candidate}.overflow`,
        actionId: `markdown.line-ending.${candidate}`,
        surface: 'overflow' as const,
        group: '20-line-ending',
        groupLabel: '行尾序列',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: candidate === 'lf' ? 'LF' : 'CRLF',
          checked: lineEnding === candidate,
          radioGroup: 'markdown.line-ending',
          disabledReason,
          closePolicy: 'never' as const,
        },
      })),
      ...(['utf-8', 'gbk'] as const).map((candidate, index) => ({
        id: `markdown.encoding.${candidate}.overflow`,
        actionId: `markdown.encoding.${candidate}`,
        surface: 'overflow' as const,
        group: '30-encoding',
        groupLabel: '使用编码打开',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: candidate === 'utf-8' ? 'UTF-8' : 'GBK',
          checked: encoding === candidate,
          radioGroup: 'markdown.encoding',
          disabledReason: encodingReason,
          closePolicy: 'on-success' as const,
        },
      })),
      {
        id: 'markdown.reveal.overflow',
        actionId: 'markdown.reveal',
        surface: 'overflow',
        group: '40-file',
        order: 0,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
          closePolicy: 'on-success',
        },
      },
      {
        id: 'markdown.ai.explain-selection.context-menu',
        actionId: 'markdown.ai.explain-selection',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'Markdown AI',
        order: 10,
        presentation: {
          kind: 'action',
          label: '就选中内容问 AI',
          disabledReason: '请先在 Markdown 中选择文本',
        },
      },
    ],
  };
}
