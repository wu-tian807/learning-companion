import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import type { WorkbenchSelectionSnapshot } from '../../shared/workbench/selection';

export interface EpubRendererActionsOptions {
  readonly ready: boolean;
  readonly aiBusy?: boolean;
  readonly hasSelection: () => boolean;
  readonly onCopySelection: (text: string) => Promise<void> | void;
  readonly onExplainSelection: (
    selection: WorkbenchSelectionSnapshot,
  ) => Promise<void> | void;
  readonly onAskSelection: (
    selection: WorkbenchSelectionSnapshot,
  ) => Promise<void> | void;
  readonly onWriteNoteSelection: (
    selection: WorkbenchSelectionSnapshot,
  ) => Promise<void> | void;
  readonly onReload: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createEpubRendererActions({
  ready,
  aiBusy = false,
  hasSelection,
  onCopySelection,
  onExplainSelection,
  onAskSelection,
  onWriteNoteSelection,
  onReload,
  onReveal,
}: EpubRendererActionsOptions): WorkbenchActionBundle {
  const notReadyReason = ready ? undefined : 'EPUB 尚未加载完成';

  return {
    actions: [
      {
        id: 'epub.copy-selection',
        enabled: () => ready && hasSelection(),
        execute: (context) => {
          const selection = findTextSelectionInput(context);

          if (selection?.text) {
            return onCopySelection(selection.text);
          }
        },
      },
      {
        id: 'epub.reload',
        enabled: true,
        execute: onReload,
      },
      {
        id: 'epub.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'epub.note.write-selection',
        enabled: () => ready && hasSelection(),
        execute: (context) => {
          const selection = findTextSelectionInput(context);
          if (selection) return onWriteNoteSelection(selection);
        },
      },
      {
        id: 'epub.ai.explain-selection',
        enabled: () => ready && !aiBusy && hasSelection(),
        execute: (context) => {
          const selection = findTextSelectionInput(context);

          if (selection) {
            return onExplainSelection(selection);
          }
        },
      },
      {
        id: 'epub.ai.ask-selection',
        enabled: () => ready && !aiBusy && hasSelection(),
        execute: (context) => {
          const selection = findTextSelectionInput(context);
          if (selection) return onAskSelection(selection);
        },
      },
    ],
    contributions: [
      {
        id: 'epub.copy-selection.context-menu',
        actionId: 'epub.copy-selection',
        surface: 'context-menu',
        group: '10-selection',
        order: 10,
        presentation: {
          kind: 'action',
          label: '复制选中内容',
          shortcut: 'Mod+C',
          disabledReason:
            notReadyReason ?? '请先在 EPUB 中选择文本',
        },
      },
      {
        id: 'epub.reload.context-menu',
        actionId: 'epub.reload',
        surface: 'context-menu',
        group: '20-navigation',
        order: 10,
        presentation: {
          kind: 'action',
          label: '重新加载电子书',
        },
      },
      {
        id: 'epub.note.write-selection.context-menu',
        actionId: 'epub.note.write-selection',
        surface: 'context-menu',
        group: '70-notes',
        groupLabel: 'EPUB 阅读',
        order: 10,
        presentation: {
          kind: 'action',
          label: '写阅读笔记',
          description: '给选中的 EPUB 原文写下个人感想',
          disabledReason:
            notReadyReason ?? '请先在 EPUB 中选择文本',
        },
      },
      {
        id: 'epub.ai.explain-selection.context-menu',
        actionId: 'epub.ai.explain-selection',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'EPUB AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释这段话',
          description: '将选区和 EPUB CFI 锚点交给 AI',
          disabledReason:
            notReadyReason ??
            (aiBusy
              ? '请先等待当前 AI 回答完成或停止生成'
              : '请先在 EPUB 中选择文本'),
        },
      },
      {
        id: 'epub.ai.ask-selection.context-menu',
        actionId: 'epub.ai.ask-selection',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'EPUB AI',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '自由提问',
          description: '围绕选中的 EPUB 原文输入自己的问题',
          disabledReason:
            notReadyReason ??
            (aiBusy
              ? '请先等待当前 AI 回答完成或停止生成'
              : '请先在 EPUB 中选择文本'),
        },
      },
      {
        id: 'epub.reveal.context-menu',
        actionId: 'epub.reveal',
        surface: 'context-menu',
        group: '90-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
    ],
  };
}
