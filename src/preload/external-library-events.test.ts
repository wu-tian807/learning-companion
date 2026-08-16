import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "../shared/ipc";
import { subscribeExternalLibraryEvents } from "./external-library-events";

describe("Preload ExternalLibrary Event subscription", () => {
  it("validates snapshots and removes only its own listener", () => {
    let wrappedListener: ((event: unknown, value: unknown) => void) | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrappedListener = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const listener = vi.fn();
    const dispose = subscribeExternalLibraryEvents(ipc, listener);
    const snapshot = {
      id: "libreoffice",
      displayName: "LibreOffice",
      description: "Office 文档预览组件",
      category: "document",
      version: "26.2.5",
      expectedSize: 297_407_265,
      rootPath: "/Users/student/Documents/Learning Companion/externalLib",
      status: "available",
      installationPath:
        "/Users/student/Documents/Learning Companion/externalLib/libreoffice/26.2.5/darwin-arm64",
    };

    wrappedListener?.({}, snapshot);
    wrappedListener?.({}, { ...snapshot, rootPath: "relative" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.externalLibraryChanged,
      wrappedListener,
    );
  });
});
