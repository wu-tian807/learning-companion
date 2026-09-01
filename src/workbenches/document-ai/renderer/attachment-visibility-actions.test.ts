import { describe, expect, it, vi } from "vitest";

import { createAttachmentVisibilityActions } from "./attachment-visibility-actions";

describe("document attachment visibility actions", () => {
  it("shows the attachment count and toggles visible attachments", async () => {
    const onToggle = vi.fn();
    const bundle = createAttachmentVisibilityActions({
      attachmentCount: 6,
      visible: true,
      onToggle,
    });

    expect(bundle.contributions[0]?.presentation).toMatchObject({
      kind: "checkbox",
      checked: true,
      label: "隐藏附着",
      badge: "6",
    });
    await bundle.actions[0]?.execute({} as never);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("keeps the header action visible but disabled without attachments", () => {
    const bundle = createAttachmentVisibilityActions({
      attachmentCount: 0,
      visible: false,
      onToggle: vi.fn(),
    });

    expect(bundle.actions[0]?.enabled).toBe(false);
    expect(bundle.contributions[0]?.presentation).toMatchObject({
      label: "显示附着",
      badge: "0",
    });
  });
});
