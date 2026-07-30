import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import type {
  PdfReadingMode,
  PdfSidebar,
} from './shared';

export interface PdfRendererActionsOptions {
  readonly ready: boolean;
  readonly searchOpen: boolean;
  readonly readingMode: PdfReadingMode;
  readonly sidebar: PdfSidebar;
  readonly hasOutline: boolean;
  readonly onToggleSearch: () => void;
  readonly onReadingMode: (mode: PdfReadingMode) => void;
  readonly onSidebar: (sidebar: PdfSidebar) => void;
  readonly onPageWidth: () => void;
  readonly onPageFit: () => void;
  readonly onActualSize: () => void;
  readonly onRotateClockwise: () => void;
  readonly onRotateCounterclockwise: () => void;
  readonly hasSelection: () => boolean;
  readonly onCopySelection: (text: string) => Promise<void> | void;
  readonly onReveal: () => Promise<void> | void;
}

export function createPdfRendererActions({
  ready,
  searchOpen,
  readingMode,
  sidebar,
  hasOutline,
  onToggleSearch,
  onReadingMode,
  onSidebar,
  onPageWidth,
  onPageFit,
  onActualSize,
  onRotateClockwise,
  onRotateCounterclockwise,
  hasSelection,
  onCopySelection,
  onReveal,
}: PdfRendererActionsOptions): WorkbenchActionBundle {
  const notReadyReason = ready ? undefined : 'PDF 尚未加载完成';

  return {
    actions: [
      {
        id: 'pdf.toggle-search',
        enabled: ready,
        execute: onToggleSearch,
      },
      ...(['continuous', 'paged'] as const).map((mode) => ({
        id: `pdf.reading-mode.${mode}`,
        enabled: ready,
        execute: () => onReadingMode(mode),
      })),
      {
        id: 'pdf.sidebar.thumbnails',
        enabled: ready,
        execute: () =>
          onSidebar(
            sidebar === 'thumbnails' ? 'closed' : 'thumbnails',
          ),
      },
      {
        id: 'pdf.sidebar.outline',
        enabled: ready && hasOutline,
        execute: () =>
          onSidebar(sidebar === 'outline' ? 'closed' : 'outline'),
      },
      {
        id: 'pdf.scale.page-width',
        enabled: ready,
        execute: onPageWidth,
      },
      {
        id: 'pdf.scale.page-fit',
        enabled: ready,
        execute: onPageFit,
      },
      {
        id: 'pdf.scale.actual-size',
        enabled: ready,
        execute: onActualSize,
      },
      {
        id: 'pdf.rotate.clockwise',
        enabled: ready,
        execute: onRotateClockwise,
      },
      {
        id: 'pdf.rotate.counterclockwise',
        enabled: ready,
        execute: onRotateCounterclockwise,
      },
      {
        id: 'pdf.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'pdf.copy-selection',
        enabled: hasSelection,
        execute: (context) => {
          const selection = findTextSelectionInput(context);

          if (selection?.text) {
            return onCopySelection(selection.text);
          }
        },
      },
      {
        id: 'pdf.ai.explain-selection',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'pdf.ai.summarize-page',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'pdf.toggle-search.overflow',
        actionId: 'pdf.toggle-search',
        surface: 'overflow',
        group: '10-search',
        order: 0,
        presentation: {
          kind: 'checkbox',
          label: '搜索 PDF',
          shortcut: 'Mod+F',
          checked: searchOpen,
          disabledReason: notReadyReason,
          closePolicy: 'on-success',
        },
      },
      ...(['continuous', 'paged'] as const).map((mode, index) => ({
        id: `pdf.reading-mode.${mode}.overflow`,
        actionId: `pdf.reading-mode.${mode}`,
        surface: 'overflow' as const,
        group: '20-reading-mode',
        groupLabel: '阅读模式',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: mode === 'continuous' ? '连续滚动' : '单页翻页',
          checked: readingMode === mode,
          radioGroup: 'pdf.reading-mode',
          disabledReason: notReadyReason,
          closePolicy: 'on-success' as const,
        },
      })),
      {
        id: 'pdf.sidebar.thumbnails.overflow',
        actionId: 'pdf.sidebar.thumbnails',
        surface: 'overflow',
        group: '30-sidebar',
        groupLabel: '侧栏',
        order: 10,
        presentation: {
          kind: 'checkbox',
          label: '显示缩略图',
          checked: sidebar === 'thumbnails',
          disabledReason: notReadyReason,
          closePolicy: 'on-success',
        },
      },
      {
        id: 'pdf.sidebar.outline.overflow',
        actionId: 'pdf.sidebar.outline',
        surface: 'overflow',
        group: '30-sidebar',
        order: 20,
        presentation: {
          kind: 'checkbox',
          label: hasOutline ? '显示文档目录' : '文档没有目录',
          checked: sidebar === 'outline',
          disabledReason: hasOutline
            ? notReadyReason
            : '这份 PDF 没有文档目录',
          closePolicy: 'on-success',
        },
      },
      {
        id: 'pdf.scale.page-width.overflow',
        actionId: 'pdf.scale.page-width',
        surface: 'overflow',
        group: '40-scale',
        groupLabel: '页面缩放',
        order: 10,
        presentation: {
          kind: 'action',
          label: '适应宽度',
          shortcut: 'Mod+0',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.scale.page-fit.overflow',
        actionId: 'pdf.scale.page-fit',
        surface: 'overflow',
        group: '40-scale',
        order: 20,
        presentation: {
          kind: 'action',
          label: '适应整页',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.scale.actual-size.overflow',
        actionId: 'pdf.scale.actual-size',
        surface: 'overflow',
        group: '40-scale',
        order: 30,
        presentation: {
          kind: 'action',
          label: '实际大小',
          shortcut: 'Mod+1',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.rotate.clockwise.overflow',
        actionId: 'pdf.rotate.clockwise',
        surface: 'overflow',
        group: '50-rotation',
        groupLabel: '旋转',
        order: 10,
        presentation: {
          kind: 'action',
          label: '顺时针旋转',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.rotate.counterclockwise.overflow',
        actionId: 'pdf.rotate.counterclockwise',
        surface: 'overflow',
        group: '50-rotation',
        order: 20,
        presentation: {
          kind: 'action',
          label: '逆时针旋转',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.reveal.overflow',
        actionId: 'pdf.reveal',
        surface: 'overflow',
        group: '60-file',
        order: 0,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'pdf.copy-selection.context-menu',
        actionId: 'pdf.copy-selection',
        surface: 'context-menu',
        group: '10-selection',
        order: 10,
        presentation: {
          kind: 'action',
          label: '复制选中内容',
          shortcut: 'Mod+C',
          disabledReason: '请先在 PDF 中选择文本',
        },
      },
      {
        id: 'pdf.scale.page-width.context-menu',
        actionId: 'pdf.scale.page-width',
        surface: 'context-menu',
        group: '20-view',
        groupLabel: 'PDF 视图',
        order: 10,
        presentation: {
          kind: 'action',
          label: '适应宽度',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.scale.page-fit.context-menu',
        actionId: 'pdf.scale.page-fit',
        surface: 'context-menu',
        group: '20-view',
        order: 20,
        presentation: {
          kind: 'action',
          label: '适应整页',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.rotate.clockwise.context-menu',
        actionId: 'pdf.rotate.clockwise',
        surface: 'context-menu',
        group: '20-view',
        order: 30,
        presentation: {
          kind: 'action',
          label: '顺时针旋转',
          disabledReason: notReadyReason,
        },
      },
      {
        id: 'pdf.ai.explain-selection.context-menu',
        actionId: 'pdf.ai.explain-selection',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'PDF AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释选中内容',
          description: '连同页码和 PDF 文字锚点一起提交',
          disabledReason: '等待 PDF AI 工具接入',
        },
      },
      {
        id: 'pdf.ai.summarize-page.context-menu',
        actionId: 'pdf.ai.summarize-page',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '总结当前页',
          description: '以当前 PDF 页作为生成上下文',
          disabledReason: '等待 PDF AI 工具接入',
        },
      },
      {
        id: 'pdf.reveal.context-menu',
        actionId: 'pdf.reveal',
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
