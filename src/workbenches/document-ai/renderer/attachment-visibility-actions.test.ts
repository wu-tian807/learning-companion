import { describe, expect, it, vi } from 'vitest';

import { createAttachmentVisibilityActions } from './attachment-visibility-actions';

describe('createAttachmentVisibilityActions', () => {
  it('creates a checked document-only header action when attachments are visible', () => {
    const onToggle = vi.fn();
    const bundle = createAttachmentVisibilityActions({
      attachmentCount: 3,
      visible: true,
      onToggle,
    });

    expect(bundle.actions).toEqual([
      expect.objectContaining({
        id: 'document-ai.toggle-attachments',
        enabled: true,
      }),
    ]);
    expect(bundle.contributions).toEqual([
      expect.objectContaining({
        surface: 'header',
        presentation: expect.objectContaining({
          kind: 'checkbox',
          checked: true,
          label: '隐藏附着',
          badge: '3',
        }),
      }),
    ]);

    bundle.actions[0]?.execute(undefined as never);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('disables the action when the current document has no attachments', () => {
    const bundle = createAttachmentVisibilityActions({
      attachmentCount: 0,
      visible: true,
      onToggle: vi.fn(),
    });

    expect(bundle.actions[0]?.enabled).toBe(false);
    expect(bundle.contributions[0]?.presentation).toEqual(
      expect.objectContaining({
        disabledReason: '当前资料没有附着内容',
      }),
    );
  });
});
