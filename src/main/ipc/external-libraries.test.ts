import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalLibrarySnapshot } from "../../shared/external-libraries";
import { IPC_CHANNELS } from "../../shared/ipc";
import { isIpcResult } from "../../shared/ipc-error";
import type {
  ExternalLibraryListener,
  ExternalLibraryServiceApi,
} from "../external-libraries/external-library-service";
import {
  registerExternalLibraryHandlers,
  removeExternalLibraryHandlers,
} from "./external-libraries";

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}));

type RegisteredIpcHandler = (event: unknown, request?: unknown) => unknown;

function findHandler(channel: string) {
  const registration = electronMocks.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );

  if (!registration) {
    throw new Error(`找不到 ${channel} handler`);
  }

  const handler = registration[1] as RegisteredIpcHandler;

  return async (request?: unknown) => {
    const result = await handler({}, request);

    if (!isIpcResult<unknown>(result)) {
      throw new Error("IPC 测试响应无效");
    }

    if (!result.ok) {
      throw result.error;
    }

    return result.data;
  };
}

function createSnapshot(
  status: ExternalLibrarySnapshot["status"] = "not-installed",
): ExternalLibrarySnapshot {
  return {
    id: "libreoffice",
    displayName: "LibreOffice",
    version: "26.2.5",
    expectedSize: 297_407_265,
    rootPath: "/Users/student/Documents/Learning Companion/externalLib",
    status,
  };
}

function createService() {
  let listener: ExternalLibraryListener | undefined;
  const unsubscribe = vi.fn();
  const snapshot = createSnapshot();
  const service = {
    initialize: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    list: vi.fn(() => [snapshot]),
    refresh: vi.fn(async () => snapshot),
    startInstallation: vi.fn(async () => createSnapshot("downloading")),
    cancel: vi.fn(),
    remove: vi.fn(async () => snapshot),
    migrate: vi.fn(async (rootPath: string) => ({
      status: "completed" as const,
      rootPath,
      conflicts: [],
      libraries: [snapshot],
    })),
    requireExecutable: vi.fn(async () => "/tmp/soffice"),
    subscribe: vi.fn((nextListener: ExternalLibraryListener) => {
      listener = nextListener;
      return unsubscribe;
    }),
  } satisfies ExternalLibraryServiceApi;

  return {
    service,
    emit(nextSnapshot: ExternalLibrarySnapshot) {
      listener?.(nextSnapshot);
    },
    unsubscribe,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  removeExternalLibraryHandlers();
});

describe("ExternalLibrary IPC handlers", () => {
  it("initializes and lists registered runtimes", async () => {
    const { service } = createService();
    registerExternalLibraryHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.listExternalLibraries)(),
    ).resolves.toEqual([createSnapshot()]);
    expect(service.initialize).toHaveBeenCalledOnce();
    expect(service.list).toHaveBeenCalledOnce();
  });

  it("validates IDs before invoking a mutation", async () => {
    const { service } = createService();
    registerExternalLibraryHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.startExternalLibraryInstallation)({
        libraryId: "../libreoffice",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_IPC_REQUEST",
      kind: "internal",
    });
    expect(service.startInstallation).not.toHaveBeenCalled();
  });

  it("returns after the service accepts a background installation", async () => {
    const { service } = createService();
    registerExternalLibraryHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.startExternalLibraryInstallation)({
        libraryId: "libreoffice",
      }),
    ).resolves.toMatchObject({
      id: "libreoffice",
      status: "downloading",
    });
    expect(service.startInstallation).toHaveBeenCalledWith("libreoffice");
  });

  it("selects and migrates the external library root", async () => {
    const { service } = createService();
    const selectDirectory = vi.fn(
      async () => "/Users/student/External Libraries",
    );
    registerExternalLibraryHandlers(service, {
      broadcast: vi.fn(),
      selectDirectory,
    });

    await expect(
      findHandler(
        IPC_CHANNELS.selectExternalLibrariesDirectory,
      )(),
    ).resolves.toBe("/Users/student/External Libraries");
    await expect(
      findHandler(IPC_CHANNELS.migrateExternalLibraries)({
        targetPath: "/Users/student/External Libraries",
        conflictResolution: "replace-target",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      rootPath: "/Users/student/External Libraries",
    });
    expect(service.migrate).toHaveBeenCalledWith(
      "/Users/student/External Libraries",
      "replace-target",
    );
  });

  it("rejects an invalid migration path", async () => {
    const { service } = createService();
    registerExternalLibraryHandlers(service);

    await expect(
      findHandler(IPC_CHANNELS.migrateExternalLibraries)({
        targetPath: "../runtime",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_IPC_REQUEST",
    });
    expect(service.migrate).not.toHaveBeenCalled();
  });

  it("broadcasts service snapshots and removes every handler", () => {
    const { service, emit, unsubscribe } = createService();
    const broadcast = vi.fn();
    registerExternalLibraryHandlers(service, {
      broadcast,
      selectDirectory: vi.fn(async () => undefined),
    });
    const snapshot = createSnapshot("downloading");

    emit(snapshot);

    expect(broadcast).toHaveBeenCalledWith(
      IPC_CHANNELS.externalLibraryChanged,
      snapshot,
    );

    removeExternalLibraryHandlers();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(electronMocks.removeHandler).toHaveBeenCalledTimes(7);
  });
});
