import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action';
import type { CoreContextMenuFacilityEvent } from '../../shared/workbench/facilities/core-facilities';

export interface HtmlRendererActionsOptions {
  readonly getContext: () =>
    | CoreContextMenuFacilityEvent
    | undefined;
  readonly onCopySelection: (text: string) => Promise<void> | void;
  readonly onOpenLink: (url: string) => Promise<void> | void;
  readonly onReload: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createHtmlRendererActions({
  getContext,
  onCopySelection,
  onOpenLink,
  onReload,
  onReveal,
}: HtmlRendererActionsOptions): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: 'html.copy-selection',
        enabled: () => Boolean(getContext()?.selectionText),
        execute: () => {
          const text = getContext()?.selectionText;

          if (text) {
            return onCopySelection(text);
          }
        },
      },
      {
        id: 'html.open-link',
        enabled: () => Boolean(getContext()?.linkUrl),
        execute: () => {
          const url = getContext()?.linkUrl;

          if (url) {
            return onOpenLink(url);
          }
        },
      },
      {
        id: 'html.reload',
        enabled: true,
        execute: onReload,
      },
      {
        id: 'html.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'html.ai.explain-selection',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'html.ai.summarize-page',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'html.reload.overflow',
        actionId: 'html.reload',
        surface: 'overflow',
        group: '10-page',
        order: 10,
        presentation: {
          kind: 'action',
          label: '重新加载 HTML',
        },
      },
      {
        id: 'html.reveal.overflow',
        actionId: 'html.reveal',
        surface: 'overflow',
        group: '20-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'html.copy-selection.context-menu',
        actionId: 'html.copy-selection',
        surface: 'context-menu',
        group: '10-selection',
        order: 10,
        presentation: {
          kind: 'action',
          label: '复制选中内容',
          shortcut: 'Mod+C',
          disabledReason: '请先在 HTML 中选择文本',
        },
      },
      {
        id: 'html.open-link.context-menu',
        actionId: 'html.open-link',
        surface: 'context-menu',
        group: '20-navigation',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在浏览器中打开链接',
          disabledReason: '当前右键位置不是外部链接',
        },
      },
      {
        id: 'html.reload.context-menu',
        actionId: 'html.reload',
        surface: 'context-menu',
        group: '20-navigation',
        order: 20,
        presentation: {
          kind: 'action',
          label: '重新加载页面',
        },
      },
      {
        id: 'html.ai.explain-selection.context-menu',
        actionId: 'html.ai.explain-selection',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'HTML AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释选中内容',
          description: '将选区和 HTML 来源锚点交给 AI',
          disabledReason: '等待 HTML AI 工具接入',
        },
      },
      {
        id: 'html.ai.summarize-page.context-menu',
        actionId: 'html.ai.summarize-page',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '总结当前页面',
          description: '以完整 HTML 页面作为生成上下文',
          disabledReason: '等待 HTML AI 工具接入',
        },
      },
      {
        id: 'html.reveal.context-menu',
        actionId: 'html.reveal',
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
