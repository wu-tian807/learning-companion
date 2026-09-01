import { describe, expect, it, vi } from "vitest";

import { WorkbenchRuntime } from "../../../renderer/workbench/runtime/workbench-runtime";
import { officeWorkbenchManifest } from "../../office/shared";
import { pdfWorkbenchManifest } from "../../pdf/shared";
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

  it.each([
    ["PDF", pdfWorkbenchManifest],
    ["Office", officeWorkbenchManifest],
  ])(
    "registers the header action in the real %s Workbench Runtime",
    (_name, manifest) => {
      const runtime = new WorkbenchRuntime(vi.fn());
      runtime.activate(
        {
          projectId: "project",
          assetId: "asset",
          workbenchId: manifest.id,
          sessionId: "session",
        },
        manifest,
      );

      expect(() =>
        runtime.registerContributions(
          "document-ai:asset.attachments",
          createAttachmentVisibilityActions({
            attachmentCount: 1,
            visible: true,
            onToggle: vi.fn(),
          }),
        ),
      ).not.toThrow();
    },
  );
});
