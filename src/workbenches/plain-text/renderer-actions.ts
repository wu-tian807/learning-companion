import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import type {
  PlainTextEncoding,
  PlainTextLineEnding,
  PlainTextViewOptions,
} from './shared';

export interface PlainTextRendererActionsOptions {
  readonly disabled: boolean;
  readonly encodingDisabled: boolean;
  readonly encoding: PlainTextEncoding;
  readonly lineEnding: PlainTextLineEnding;
  readonly viewOptions: PlainTextViewOptions;
  readonly onSetEncoding: (encoding: PlainTextEncoding) => Promise<void>;
  readonly onSetLineEnding: (
    lineEnding: PlainTextLineEnding,
  ) => Promise<void>;
  readonly onSetViewOptions: (
    viewOptions: PlainTextViewOptions,
  ) => Promise<void>;
}

export function createPlainTextRendererActions({
  disabled,
  encodingDisabled,
  encoding,
  lineEnding,
  viewOptions,
  onSetEncoding,
  onSetLineEnding,
  onSetViewOptions,
}: PlainTextRendererActionsOptions): WorkbenchActionBundle {
  const actionDisabledReason = disabled
    ? '当前暂时不能修改编辑器选项'
    : undefined;
  const encodingReason = disabled
    ? actionDisabledReason
    : encodingDisabled
      ? '请先保存或放弃当前修改，再切换编码'
      : undefined;

  return {
    actions: [
      {
        id: 'plain-text.toggle-word-wrap',
        enabled: !disabled,
        execute: () =>
          onSetViewOptions({
            ...viewOptions,
            wordWrap: !viewOptions.wordWrap,
          }),
      },
      {
        id: 'plain-text.toggle-line-numbers',
        enabled: !disabled,
        execute: () =>
          onSetViewOptions({
            ...viewOptions,
            lineNumbers: !viewOptions.lineNumbers,
          }),
      },
      ...(['lf', 'crlf'] as const).map((candidate) => ({
        id: `plain-text.line-ending.${candidate}`,
        enabled: !disabled,
        execute: () => onSetLineEnding(candidate),
      })),
      ...(['utf-8', 'gbk'] as const).map((candidate) => ({
        id: `plain-text.encoding.${candidate}`,
        enabled: !disabled && !encodingDisabled,
        execute: () => onSetEncoding(candidate),
      })),
    ],
    contributions: [
      {
        id: 'plain-text.toggle-word-wrap.overflow',
        actionId: 'plain-text.toggle-word-wrap',
        surface: 'overflow',
        group: '10-view',
        order: 10,
        presentation: {
          kind: 'checkbox',
          label: '自动换行',
          checked: viewOptions.wordWrap,
          disabledReason: actionDisabledReason,
          closePolicy: 'never',
        },
      },
      {
        id: 'plain-text.toggle-line-numbers.overflow',
        actionId: 'plain-text.toggle-line-numbers',
        surface: 'overflow',
        group: '10-view',
        order: 20,
        presentation: {
          kind: 'checkbox',
          label: '显示行号',
          checked: viewOptions.lineNumbers,
          disabledReason: actionDisabledReason,
          closePolicy: 'never',
        },
      },
      ...(['lf', 'crlf'] as const).map((candidate, index) => ({
        id: `plain-text.line-ending.${candidate}.overflow`,
        actionId: `plain-text.line-ending.${candidate}`,
        surface: 'overflow' as const,
        group: '20-line-ending',
        groupLabel: '行尾序列',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: candidate === 'lf' ? 'LF' : 'CRLF',
          checked: lineEnding === candidate,
          radioGroup: 'plain-text.line-ending',
          disabledReason: actionDisabledReason,
          closePolicy: 'never' as const,
        },
      })),
      ...(['utf-8', 'gbk'] as const).map((candidate, index) => ({
        id: `plain-text.encoding.${candidate}.overflow`,
        actionId: `plain-text.encoding.${candidate}`,
        surface: 'overflow' as const,
        group: '30-encoding',
        groupLabel: '使用编码打开',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: candidate === 'utf-8' ? 'UTF-8' : 'GBK',
          checked: encoding === candidate,
          radioGroup: 'plain-text.encoding',
          disabledReason: encodingReason,
          closePolicy: 'on-success' as const,
        },
      })),
    ],
  };
}
