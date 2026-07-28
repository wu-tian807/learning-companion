import type { ResolvedWorkbenchContribution } from '../runtime/workbench-action-registry';

export interface WorkbenchMenuGroup {
  readonly id: string;
  readonly label?: string;
  readonly entries: readonly ResolvedWorkbenchContribution[];
}

export function groupWorkbenchMenuEntries(
  entries: readonly ResolvedWorkbenchContribution[],
): readonly WorkbenchMenuGroup[] {
  const groups = new Map<string, ResolvedWorkbenchContribution[]>();

  for (const entry of entries) {
    const group = groups.get(entry.contribution.group) ?? [];
    group.push(entry);
    groups.set(entry.contribution.group, group);
  }

  return [...groups].map(([id, groupEntries]) => ({
    id,
    label: groupEntries[0]?.contribution.groupLabel,
    entries: groupEntries,
  }));
}

export function formatWorkbenchShortcut(
  shortcut: string,
  platform:
    | 'mac'
    | 'windows' = typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform)
    ? 'mac'
    : 'windows',
): string {
  const parts = shortcut.split('+');

  if (platform === 'mac') {
    const replacements: Record<string, string> = {
      Mod: '⌘',
      Ctrl: '⌃',
      Shift: '⇧',
      Alt: '⌥',
    };
    return parts.map((part) => replacements[part] ?? part).join('');
  }

  return parts
    .map((part) => (part === 'Mod' ? 'Ctrl' : part))
    .join('+');
}
