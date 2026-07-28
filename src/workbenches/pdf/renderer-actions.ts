import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action';
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
    ],
  };
}
