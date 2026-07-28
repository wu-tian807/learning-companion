import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';
import { WorkbenchMenu } from './WorkbenchMenu';
import {
  formatWorkbenchShortcut,
  groupWorkbenchMenuEntries,
} from './workbench-menu-model';

const entries: readonly ResolvedWorkbenchContribution[] = [
  {
    ownerId: 'builtin.plain-text',
    action: {
      id: 'plain-text.toggle-wrap',
      enabled: true,
      execute: vi.fn(),
    },
    contribution: {
      id: 'plain-text.toggle-wrap.overflow',
      actionId: 'plain-text.toggle-wrap',
      surface: 'overflow',
      group: '10-view',
      order: 0,
      presentation: {
        kind: 'checkbox',
        label: '自动换行',
        checked: true,
      },
    },
  },
  {
    ownerId: 'builtin.plain-text',
    action: {
      id: 'plain-text.save',
      enabled: false,
      execute: vi.fn(),
    },
    contribution: {
      id: 'plain-text.save.overflow',
      actionId: 'plain-text.save',
      surface: 'overflow',
      group: '20-file',
      order: 0,
      presentation: {
        kind: 'action',
        label: '保存',
        shortcut: 'Mod+S',
        disabledReason: '没有修改',
      },
    },
  },
];

describe('WorkbenchMenu', () => {
  it('renders shared checkbox, disabled and shortcut semantics', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchMenu
        ariaLabel="工作台菜单"
        entries={entries}
        busyActionIds={new Set()}
        onInvoke={vi.fn()}
      />,
    );

    expect(markup).toContain('role="menuitemcheckbox"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('title="没有修改"');
    expect(markup).toContain('disabled=""');
  });

  it('groups entries without changing their sequence', () => {
    expect(
      groupWorkbenchMenuEntries(entries).map((group) => group.id),
    ).toEqual(['10-view', '20-file']);
  });

  it('formats platform shortcuts consistently', () => {
    expect(formatWorkbenchShortcut('Mod+Shift+Z', 'mac')).toBe('⌘⇧Z');
    expect(formatWorkbenchShortcut('Mod+Shift+Z', 'windows')).toBe(
      'Ctrl+Shift+Z',
    );
  });
});
