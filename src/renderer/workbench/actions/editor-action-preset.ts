import type { WorkbenchActionBundle } from './workbench-action';
import type { EditorActionAdapter } from '../editor/editor-action-adapter';

export function createEditorActionPreset(
  adapter: EditorActionAdapter,
): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: 'editor.undo',
        enabled: () => adapter.getState().canUndo,
        execute: () => adapter.undo(),
      },
      {
        id: 'editor.redo',
        enabled: () => adapter.getState().canRedo,
        execute: () => adapter.redo(),
      },
      {
        id: 'editor.cut',
        enabled: () => adapter.getState().canCut,
        execute: () => adapter.cut(),
      },
      {
        id: 'editor.copy',
        enabled: () => adapter.getState().canCopy,
        execute: () => adapter.copy(),
      },
      {
        id: 'editor.paste',
        enabled: () => adapter.getState().canPaste,
        execute: () => adapter.paste(),
      },
      {
        id: 'editor.find',
        enabled: () => adapter.getState().canFind,
        execute: () => adapter.find(),
      },
      {
        id: 'editor.select-all',
        enabled: () => adapter.getState().canSelectAll,
        execute: () => adapter.selectAll(),
      },
      {
        id: 'editor.ai-placeholder',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'editor.undo.context-menu',
        actionId: 'editor.undo',
        surface: 'context-menu',
        group: '10-history',
        order: 10,
        presentation: {
          kind: 'action',
          label: '撤销',
          shortcut: 'Mod+Z',
          disabledReason: '没有可撤销的操作',
        },
      },
      {
        id: 'editor.redo.context-menu',
        actionId: 'editor.redo',
        surface: 'context-menu',
        group: '10-history',
        order: 20,
        presentation: {
          kind: 'action',
          label: '重做',
          shortcut: 'Mod+Shift+Z',
          disabledReason: '没有可重做的操作',
        },
      },
      {
        id: 'editor.cut.context-menu',
        actionId: 'editor.cut',
        surface: 'context-menu',
        group: '20-clipboard',
        order: 10,
        presentation: {
          kind: 'action',
          label: '剪切',
          shortcut: 'Mod+X',
          disabledReason: '请先选择可编辑内容',
        },
      },
      {
        id: 'editor.copy.context-menu',
        actionId: 'editor.copy',
        surface: 'context-menu',
        group: '20-clipboard',
        order: 20,
        presentation: {
          kind: 'action',
          label: '复制',
          shortcut: 'Mod+C',
          disabledReason: '请先选择内容',
        },
      },
      {
        id: 'editor.paste.context-menu',
        actionId: 'editor.paste',
        surface: 'context-menu',
        group: '20-clipboard',
        order: 30,
        presentation: {
          kind: 'action',
          label: '粘贴',
          shortcut: 'Mod+V',
          disabledReason: '当前编辑面不可粘贴',
        },
      },
      {
        id: 'editor.find.context-menu',
        actionId: 'editor.find',
        surface: 'context-menu',
        group: '30-selection',
        order: 10,
        presentation: {
          kind: 'action',
          label: '查找',
          shortcut: 'Mod+F',
          disabledReason: '当前编辑面暂不支持查找',
        },
      },
      {
        id: 'editor.select-all.context-menu',
        actionId: 'editor.select-all',
        surface: 'context-menu',
        group: '30-selection',
        order: 20,
        presentation: {
          kind: 'action',
          label: '全选',
          shortcut: 'Mod+A',
          disabledReason: '当前编辑面尚未准备完成',
        },
      },
      {
        id: 'editor.ai-placeholder.context-menu',
        actionId: 'editor.ai-placeholder',
        surface: 'context-menu',
        group: '40-ai',
        groupLabel: 'AI 扩展',
        order: 0,
        presentation: {
          kind: 'action',
          label: '工作台 AI 动作（待接入）',
          disabledReason: 'AI 工作台能力尚未接入',
          closePolicy: 'never',
        },
      },
    ],
  };
}
