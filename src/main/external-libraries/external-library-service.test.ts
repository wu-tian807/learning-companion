import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_PREFERENCES } from "../../shared/app-preferences";
import { createAppSetupSnapshot } from "../../shared/app-setup";
import type { ExternalLibrarySnapshot } from "../../shared/external-libraries";
import type { SettingsRepository } from "../settings/settings-repository";
import { ExternalLibraryDownloader } from "./external-library-downloader";
import { ExternalLibraryInstallationManifestFile } from "./external-library-installation-manifest-file";
import {
  ExternalLibraryInstallerRegistry,
  type ExternalLibraryInstaller,
} from "./external-library-installer";
import { ExternalLibraryPathManager } from "./external-library-path-manager";
import { ExternalLibraryRegistry } from "./external-library-registry";
import {
  ExternalLibraryLifecycleRegistry,
  type ExternalLibraryLifecycleRegistryApi,
} from "./external-library-lifecycle";
import {
  ExternalLibraryRuntimeSetupRegistry,
  type ExternalLibraryRuntimeSetupRegistryApi,
} from "./external-library-runtime-setup";
import { ExternalLibraryService } from "./external-library-service";
import type {
  ExternalLibraryArchitecture,
  ExternalLibraryPlatform,
} from "./external-library-definition";
import { externalLibraryPackageResources } from "./external-library-definition";

const temporaryDirectories: string[] = [];

interface Harness {
  readonly rootPath: string;
  readonly registry: ExternalLibraryRegistry;
  readonly pathManager: ExternalLibraryPathManager;
  readonly installationManifestFile: ExternalLibraryInstallationManifestFile;
  readonly installer: ExternalLibraryInstaller;
  readonly settings: SettingsRepository;
  readonly service: ExternalLibraryService;
}

function createDefinition(content: Uint8Array) {
  return {
    id: "libreoffice",
    displayName: "LibreOffice",
    description: "Office preview",
    category: "document" as const,
    version: "25.2.5.2",
    installationFormatVersion: 1,
    sourceUrl: "https://www.libreoffice.org/",
    licenseName: "MPL-2.0",
    licenseUrl: "https://www.libreoffice.org/about-us/licenses",
    packages: [
      {
        platform: "darwin" as const,
        architecture: "arm64" as const,
        packageType: "dmg" as const,
        downloadUrl: "https://download.example/libreoffice.dmg",
        sha256: createHash("sha256").update(content).digest("hex"),
        expectedSize: content.byteLength,
        executableRelativePath: "LibreOffice.app/Contents/MacOS/soffice",
        payloadRelativePath: "LibreOffice.app",
        verifyCodeSignature: true,
      },
    ],
  };
}

function createVariantDefinition(
  content: Uint8Array,
  defaultVariantId: 'cpu' | 'nvidia' = 'cpu',
) {
  const packageSha256 = createHash("sha256")
    .update(content)
    .digest("hex");
  const createPackage = (variantId: "cpu" | "nvidia") => ({
    platform: "darwin" as const,
    architecture: "arm64" as const,
    variantId,
    packageType: "dmg" as const,
    downloadUrl: `https://download.example/media-${variantId}.dmg`,
    sha256: packageSha256,
    expectedSize: content.byteLength,
    executableRelativePath: "bin/media-runtime",
    payloadRelativePath: "bin",
    verifyCodeSignature: true,
  });

  return {
    id: "media-subtitles",
    displayName: "Media subtitles",
    description: "Complete subtitle suite",
    category: "media" as const,
    version: "1.0.0",
    installationFormatVersion: 1,
    sourceUrl: "https://download.example/",
    licenseName: "Test license",
    licenseUrl: "https://download.example/license",
    variants: [
      { id: "cpu", displayName: "CPU" },
      { id: "nvidia", displayName: "NVIDIA" },
    ],
    defaultVariantId,
    packages: [createPackage("cpu"), createPackage("nvidia")],
  };
}

function createSettings(rootPath: string): SettingsRepository {
  let currentRootPath = rootPath;

  return {
    initialize: vi.fn(async () => undefined),
    get: vi.fn(() => DEFAULT_APP_PREFERENCES),
    updateHomePreferences: vi.fn(async () => DEFAULT_APP_PREFERENCES),
    getAppSetup: vi.fn(() => createAppSetupSnapshot(0)),
    completeExternalLibraryOnboarding: vi.fn(async () =>
      createAppSetupSnapshot(1),
    ),
    completeAgentProviderOnboarding: vi.fn(async () =>
      createAppSetupSnapshot(2),
    ),
    getDefaultProjectWorkspace: vi.fn(() => dirname(rootPath)),
    updateDefaultProjectWorkspace: vi.fn(async () => undefined),
    getExternalLibrariesPath: vi.fn(() => currentRootPath),
    updateExternalLibrariesPath: vi.fn(async (nextRootPath: string) => {
      currentRootPath = nextRootPath;
    }),
    listAgentProviderConnections: vi.fn(() => []),
    getAgentProviderConnection: vi.fn(() => undefined),
    updateAgentProviderConnection: vi.fn(async () => undefined),
    deleteAgentProviderConnection: vi.fn(async () => undefined),
    getAgentProviderSelectorSelection: vi.fn(() => undefined),
    updateAgentProviderSelectorSelection: vi.fn(async () => undefined),
  };
}

async function createHarness(input?: {
  readonly downloader?: ConstructorParameters<typeof ExternalLibraryService>[4];
  readonly platform?: ExternalLibraryPlatform;
  readonly architecture?: ExternalLibraryArchitecture;
  readonly lifecycles?: ExternalLibraryLifecycleRegistryApi;
  readonly runtimeSetups?: ExternalLibraryRuntimeSetupRegistryApi;
}): Promise<Harness> {
  const directory = await mkdtemp(
    join(tmpdir(), "learning-companion-runtime-service-"),
  );
  temporaryDirectories.push(directory);
  const rootPath = join(directory, "externalLib");
  const content = new TextEncoder().encode("trusted package");
  const registry = new ExternalLibraryRegistry();
  registry.register(createDefinition(content));
  const pathManager = new ExternalLibraryPathManager({
    createId: () => "job",
  });
  const lifecycles =
    input?.lifecycles ?? new ExternalLibraryLifecycleRegistry();
  const runtimeSetups =
    input?.runtimeSetups ?? new ExternalLibraryRuntimeSetupRegistry();
  const installationManifestFile =
    new ExternalLibraryInstallationManifestFile(runtimeSetups);
  const install = vi.fn<ExternalLibraryInstaller["install"]>(
    async (request) => {
      if (request.packageDefinition.packageType !== "dmg") {
        throw new Error("expected dmg package");
      }
      const executablePath = join(
        request.stagingInstallationDirectory,
        "runtime",
        ...request.packageDefinition.executableRelativePath.split("/"),
      );
      await mkdir(dirname(executablePath), { recursive: true });
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
      await chmod(executablePath, 0o755);
    },
  );
  const installer: ExternalLibraryInstaller = {
    packageType: "dmg",
    install,
  };
  const installers = new ExternalLibraryInstallerRegistry();
  installers.register(installer);
  const downloader =
    input?.downloader ??
    new ExternalLibraryDownloader({
      fetch: vi.fn(
        async () =>
          new Response(content, {
            status: 200,
            headers: {
              "content-length": String(content.byteLength),
            },
          }),
      ),
    });
  const settings = createSettings(rootPath);
  const service = new ExternalLibraryService(
    settings,
    registry,
    pathManager,
    installationManifestFile,
    downloader,
    installers,
    {
      platform: input?.platform ?? "darwin",
      architecture: input?.architecture ?? "arm64",
      now: () => 10,
      logger: { warn: vi.fn() },
      lifecycles,
      runtimeSetups,
    },
  );

  return {
    rootPath,
    registry,
    pathManager,
    installationManifestFile,
    installer,
    settings,
    service,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function installAndWait(
  harness: Harness,
): Promise<ReturnType<ExternalLibraryService["list"]>[number]> {
  const available = new Promise<
    ReturnType<ExternalLibraryService["list"]>[number]
  >((resolve) => {
    const unsubscribe = harness.service.subscribe((snapshot) => {
      if (snapshot.status === "available") {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
  const accepted =
    await harness.service.startInstallation("libreoffice");

  expect(accepted.status).toBe("downloading");
  return available;
}

describe("ExternalLibraryService", () => {
  it("cleans expired temporary data before discovering libraries", async () => {
    const harness = await createHarness();
    const cleanup = vi.spyOn(
      harness.pathManager,
      "cleanupExpiredTemporaryData",
    );

    await harness.service.initialize();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(harness.rootPath, 10);
  });

  it("installs, switches and migrates one multi-variant component", async () => {
    const harness = await createHarness();
    const content = new TextEncoder().encode("trusted package");
    harness.registry.register(createVariantDefinition(content));
    await harness.service.initialize();

    expect(
      harness.service
        .list()
        .find(({ id }) => id === "media-subtitles"),
    ).toMatchObject({
      status: "not-installed",
      defaultVariantId: "cpu",
      variants: [
        { id: "cpu", displayName: "CPU", expectedSize: content.byteLength },
        {
          id: "nvidia",
          displayName: "NVIDIA",
          expectedSize: content.byteLength,
        },
      ],
    });

    const nvidiaInstalled = new Promise<void>((resolve) => {
      const unsubscribe = harness.service.subscribe((snapshot) => {
        if (
          snapshot.id === "media-subtitles" &&
          snapshot.status === "available" &&
          snapshot.installedVariantId === "nvidia"
        ) {
          unsubscribe();
          resolve();
        }
      });
    });
    await expect(
      harness.service.startInstallation("media-subtitles", "nvidia"),
    ).resolves.toMatchObject({
      status: "downloading",
      operationVariantId: "nvidia",
      expectedSize: content.byteLength,
    });
    await nvidiaInstalled;
    await expect(
      harness.service.requireRuntime("media-subtitles"),
    ).resolves.toMatchObject({ variantId: "nvidia" });

    const targetRootPath = join(dirname(harness.rootPath), "variant-target");
    await expect(harness.service.migrate(targetRootPath)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      harness.service.requireRuntime("media-subtitles"),
    ).resolves.toMatchObject({ variantId: "nvidia" });

    const cpuInstalled = new Promise<void>((resolve) => {
      const unsubscribe = harness.service.subscribe((snapshot) => {
        if (
          snapshot.id === "media-subtitles" &&
          snapshot.status === "available" &&
          snapshot.installedVariantId === "cpu"
        ) {
          unsubscribe();
          resolve();
        }
      });
    });
    await harness.service.startInstallation("media-subtitles", "cpu");
    await cpuInstalled;
    await expect(
      harness.service.requireRuntime("media-subtitles"),
    ).resolves.toMatchObject({ variantId: "cpu" });
  });

  it("rejects an unknown component variant before downloading", async () => {
    const harness = await createHarness();
    const content = new TextEncoder().encode("trusted package");
    harness.registry.register(createVariantDefinition(content));
    await harness.service.initialize();

    await expect(
      harness.service.startInstallation("media-subtitles", "amd"),
    ).rejects.toThrow("FEATURE_NOT_SUPPORTED");
  });

  it("installs the automatically resolved default profile without a Renderer variant", async () => {
    const harness = await createHarness();
    const content = new TextEncoder().encode("trusted package");
    harness.registry.register(createVariantDefinition(content, "nvidia"));
    await harness.service.initialize();
    const available = new Promise<ExternalLibrarySnapshot>((resolve) => {
      const unsubscribe = harness.service.subscribe((snapshot) => {
        if (
          snapshot.id === "media-subtitles" &&
          snapshot.status === "available"
        ) {
          unsubscribe();
          resolve(snapshot);
        }
      });
    });

    await expect(
      harness.service.startInstallation("media-subtitles"),
    ).resolves.toMatchObject({
      status: "downloading",
      operationVariantId: "nvidia",
    });
    await expect(available).resolves.toMatchObject({
      installedVariantId: "nvidia",
    });
  });

  it("discovers, installs and exposes a verified executable", async () => {
    const harness = await createHarness();
    const statuses: string[] = [];
    harness.service.subscribe((snapshot) => {
      statuses.push(snapshot.status);
    });

    await harness.service.initialize();
    expect(harness.service.list()).toMatchObject([
      { id: "libreoffice", status: "not-installed" },
    ]);

    const installed = await installAndWait(harness);
    const executablePath =
      await harness.service.requireExecutable("libreoffice");

    expect(installed).toMatchObject({
      id: "libreoffice",
      status: "available",
    });
    expect(statuses).toEqual(
      expect.arrayContaining([
        "discovering",
        "not-installed",
        "downloading",
        "verifying",
        "installing",
        "available",
      ]),
    );
    await expect(access(executablePath)).resolves.toBeUndefined();
    expect(harness.installer.install).toHaveBeenCalledOnce();
    expect(harness.installer.install).toHaveBeenCalledWith(
      expect.objectContaining({
        packagePath: expect.stringMatching(/package\.dmg$/u),
      }),
      expect.any(AbortSignal),
    );
  });

  it("publishes measured runtime setup progress without resetting it", async () => {
    const runtimeSetups = new ExternalLibraryRuntimeSetupRegistry();
    runtimeSetups.register({
      libraryId: "libreoffice",
      expectedSetupBytes: 100,
      isReady: vi.fn(async () => true),
      prepare: vi.fn(
        async (_runtimeDirectory, _cacheDirectory, _signal, reportStatus) => {
          reportStatus("Installing runtime", {
            completedBytes: 40,
            totalBytes: 100,
          });
          reportStatus("Verifying runtime");
        },
      ),
    });
    const harness = await createHarness({ runtimeSetups });
    const installing: ExternalLibrarySnapshot[] = [];
    harness.service.subscribe((snapshot) => {
      if (snapshot.status === "installing") installing.push(snapshot);
    });
    await harness.service.initialize();

    await installAndWait(harness);

    expect(installing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusDetail: "Installing runtime",
          progress: { completedBytes: 55, totalBytes: 115 },
        }),
        expect.objectContaining({
          statusDetail: "Verifying runtime",
          progress: { completedBytes: 55, totalBytes: 115 },
        }),
      ]),
    );
  });

  it("exposes the executable to an available-status listener", async () => {
    const harness = await createHarness();
    await harness.service.initialize();
    const executableFromEvent = new Promise<string>((resolve, reject) => {
      const unsubscribe = harness.service.subscribe((snapshot) => {
        if (snapshot.status !== "available") {
          return;
        }

        unsubscribe();
        void harness.service
          .requireExecutable("libreoffice")
          .then(resolve, reject);
      });
    });

    await harness.service.startInstallation("libreoffice");
    await expect(executableFromEvent).resolves.toContain(
      join("LibreOffice.app", "Contents", "MacOS", "soffice"),
    );
  });

  it("reuses an installed runtime across Service instances", async () => {
    const first = await createHarness();
    await first.service.initialize();
    await installAndWait(first);

    const definition = first.registry.require("libreoffice");
    const packageDefinition = first.registry.selectPackage(
      "libreoffice",
      "darwin",
      "arm64",
    );
    if (packageDefinition.packageType !== "dmg") {
      throw new Error("expected dmg package");
    }
    const secondInstaller = {
      packageType: "dmg" as const,
      install: vi.fn(),
    };
    const secondInstallers = new ExternalLibraryInstallerRegistry();
    secondInstallers.register(secondInstaller);
    const secondService = new ExternalLibraryService(
      createSettings(first.rootPath),
      first.registry,
      first.pathManager,
      first.installationManifestFile,
      {
        download: vi.fn(),
      },
      secondInstallers,
      {
        platform: "darwin",
        architecture: "arm64",
        lifecycles: new ExternalLibraryLifecycleRegistry(),
        runtimeSetups: new ExternalLibraryRuntimeSetupRegistry(),
      },
    );

    await secondService.initialize();

    expect(secondService.list()).toMatchObject([{ status: "available" }]);
    expect(await secondService.requireExecutable(definition.id)).toBe(
      join(
        first.pathManager.resolveInstallationPaths(
          first.rootPath,
          definition,
          packageDefinition,
        ).runtimeDirectory,
        ...packageDefinition.executableRelativePath.split("/"),
      ),
    );
    expect(secondInstaller.install).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an unrecognized target installation", async () => {
    const harness = await createHarness();
    const definition = harness.registry.require("libreoffice");
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      "darwin",
      "arm64",
    );
    const paths = harness.pathManager.resolveInstallationPaths(
      harness.rootPath,
      definition,
      packageDefinition,
    );
    await mkdir(paths.installationDirectory, { recursive: true });
    await writeFile(join(paths.installationDirectory, "unknown.txt"), "keep");

    await harness.service.initialize();

    expect(harness.service.list()).toMatchObject([
      { status: "invalid", errorCode: "marker-invalid" },
    ]);
    await expect(
      harness.service.startInstallation("libreoffice"),
    ).rejects.toThrow("EXTERNAL_LIBRARY_CONFLICT");
    await expect(
      access(join(paths.installationDirectory, "unknown.txt")),
    ).resolves.toBeUndefined();
    expect(harness.installer.install).not.toHaveBeenCalled();
  });

  it("exposes unsupported platforms without failing discovery or migration", async () => {
    const harness = await createHarness({
      platform: "win32",
      architecture: "arm64",
    });
    const statuses: string[] = [];
    harness.service.subscribe((snapshot) => {
      statuses.push(snapshot.status);
    });

    await harness.service.initialize();

    expect(harness.service.list()).toEqual([
      {
        id: "libreoffice",
        displayName: "LibreOffice",
        description: "Office preview",
        category: "document",
        version: "25.2.5.2",
        rootPath: harness.rootPath,
        status: "unsupported",
      },
    ]);
    expect(statuses).toEqual(["unsupported"]);
    await expect(
      harness.service.startInstallation("libreoffice"),
    ).rejects.toThrow("FEATURE_NOT_SUPPORTED");
    await expect(
      harness.service.requireExecutable("libreoffice"),
    ).rejects.toThrow("FEATURE_NOT_SUPPORTED");

    const targetRootPath = join(dirname(harness.rootPath), "unsupported");
    const result = await harness.service.migrate(targetRootPath);

    expect(result).toMatchObject({
      status: "completed",
      rootPath: targetRootPath,
      libraries: [
        {
          status: "unsupported",
          rootPath: targetRootPath,
        },
      ],
    });
  });

  it("deduplicates installation and supports cancellation", async () => {
    const download = vi.fn(
      async (
        input: Parameters<
          ConstructorParameters<typeof ExternalLibraryService>[4]["download"]
        >[0],
      ) => {
        await mkdir(dirname(input.destinationPath), { recursive: true });
        await writeFile(input.destinationPath, "partial");
        return new Promise<never>((_resolvePromise, rejectPromise) => {
          input.signal.addEventListener(
            "abort",
            () => rejectPromise(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const harness = await createHarness({ downloader: { download } });
    await harness.service.initialize();

    const first =
      await harness.service.startInstallation("libreoffice");
    const second =
      await harness.service.startInstallation("libreoffice");
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    const downloadDirectory = dirname(
      download.mock.calls[0]![0].destinationPath,
    );
    const cancelled = new Promise<void>((resolvePromise) => {
      const unsubscribe = harness.service.subscribe((snapshot) => {
        if (
          snapshot.id === "libreoffice" &&
          snapshot.status === "not-installed"
        ) {
          unsubscribe();
          resolvePromise();
        }
      });
    });
    harness.service.cancel("libreoffice");

    expect(first.status).toBe("downloading");
    expect(second.status).toBe("downloading");
    await cancelled;
    expect(harness.service.list()).toMatchObject([
      { status: "not-installed" },
    ]);
    await expect(access(downloadDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports failures through snapshots after accepting the background task", async () => {
    let rejectDownload: ((reason: Error) => void) | undefined;
    const download = vi.fn(
      async () =>
        new Promise<never>((_resolvePromise, rejectPromise) => {
          rejectDownload = rejectPromise;
        }),
    );
    const harness = await createHarness({ downloader: { download } });
    await harness.service.initialize();

    const accepted =
      await harness.service.startInstallation("libreoffice");

    expect(accepted.status).toBe("downloading");
    await vi.waitFor(() => expect(rejectDownload).toBeDefined());
    rejectDownload!(new Error("network unavailable"));
    await vi.waitFor(() =>
      expect(harness.service.list()).toMatchObject([
        { status: "failed", errorCode: "INTERNAL_ERROR" },
      ]),
    );
  });

  it("cancels active installations during shutdown", async () => {
    const download = vi.fn(
      async (
        input: Parameters<
          ConstructorParameters<typeof ExternalLibraryService>[4]["download"]
        >[0],
      ) => {
        await mkdir(dirname(input.destinationPath), { recursive: true });
        await writeFile(input.destinationPath, "partial");
        return new Promise<never>((_resolvePromise, rejectPromise) => {
          input.signal.addEventListener(
            "abort",
            () => rejectPromise(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const harness = await createHarness({ downloader: { download } });
    await harness.service.initialize();
    const installation =
      await harness.service.startInstallation("libreoffice");
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());

    await harness.service.shutdown();

    expect(installation.status).toBe("downloading");
    const partialPath = download.mock.calls[0]![0].destinationPath;
    await expect(readFile(partialPath, "utf8")).resolves.toBe("partial");
    await vi.waitFor(() =>
      expect(harness.service.list()).toMatchObject([
        { status: "not-installed" },
      ]),
    );
  });

  it("removes only the selected versioned installation", async () => {
    const harness = await createHarness();
    await harness.service.initialize();
    const installed = await installAndWait(harness);
    const definition = harness.registry.require("libreoffice");
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      "darwin",
      "arm64",
    );
    const downloadPaths = await harness.pathManager.prepareDownloadPaths({
      rootPath: harness.rootPath,
      definition,
      packageDefinition,
      resourceDefinition:
        externalLibraryPackageResources(packageDefinition)[0]!,
    });
    await writeFile(downloadPaths.partialPath, "partial");

    const removed = await harness.service.remove("libreoffice");

    expect(removed.status).toBe("not-installed");
    await expect(access(installed.installationPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(downloadPaths.downloadDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("releases a loaded runtime before removing its installation", async () => {
    let installationPath = "";
    const order: string[] = [];
    const release = vi.fn(async () => {
      order.push("release");
      await expect(access(installationPath)).resolves.toBeUndefined();
    });
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    lifecycles.register({
      libraryId: "libreoffice",
      release,
    });
    const harness = await createHarness({ lifecycles });
    await harness.service.initialize();
    const installed = await installAndWait(harness);
    installationPath = installed.installationPath!;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const activeUse = harness.service.withRuntime(
      "libreoffice",
      undefined,
      async (_runtime, signal) => {
        markStarted();
        try {
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(signal.reason),
              { once: true },
            );
          });
        } finally {
          order.push("use-stopped");
        }
      },
    );
    await started;

    const removal = harness.service.remove("libreoffice");

    await expect(activeUse).rejects.toMatchObject({ name: "AbortError" });
    await removal;
    expect(release).toHaveBeenCalledOnce();
    expect(order).toEqual(["use-stopped", "release"]);
    await expect(access(installed.installationPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps installation data when releasing its runtime fails", async () => {
    let shouldFail = true;
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    lifecycles.register({
      libraryId: "libreoffice",
      release: vi.fn(async () => {
        if (shouldFail) throw new Error("runtime is still busy");
      }),
    });
    const harness = await createHarness({ lifecycles });
    await harness.service.initialize();
    const installed = await installAndWait(harness);

    await expect(harness.service.remove("libreoffice")).rejects.toThrow(
      "runtime is still busy",
    );

    await expect(access(installed.installationPath!)).resolves.toBeUndefined();
    shouldFail = false;
    await expect(harness.service.remove("libreoffice")).resolves.toMatchObject({
      status: "not-installed",
    });
  });

  it("migrates a verified installation and switches settings last", async () => {
    const release = vi.fn(async () => undefined);
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    lifecycles.register({ libraryId: "libreoffice", release });
    const harness = await createHarness({ lifecycles });
    await harness.service.initialize();
    const installed = await installAndWait(harness);
    const targetRootPath = join(dirname(harness.rootPath), "moved");
    const definition = harness.registry.require("libreoffice");
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      "darwin",
      "arm64",
    );
    const downloadPaths = await harness.pathManager.prepareDownloadPaths({
      rootPath: harness.rootPath,
      definition,
      packageDefinition,
      resourceDefinition:
        externalLibraryPackageResources(packageDefinition)[0]!,
    });
    await writeFile(downloadPaths.partialPath, "partial");

    const result = await harness.service.migrate(targetRootPath);

    expect(result).toMatchObject({
      status: "completed",
      rootPath: targetRootPath,
      libraries: [{ status: "available", rootPath: targetRootPath }],
    });
    expect(harness.settings.getExternalLibrariesPath()).toBe(
      targetRootPath,
    );
    expect(release).toHaveBeenCalledOnce();
    await expect(access(installed.installationPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(downloadPaths.partialPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(await harness.service.requireExecutable("libreoffice")),
    ).resolves.toBeUndefined();
  });

  it("reports a target conflict before changing either root", async () => {
    const release = vi.fn(async () => undefined);
    const lifecycles = new ExternalLibraryLifecycleRegistry();
    lifecycles.register({ libraryId: "libreoffice", release });
    const harness = await createHarness({ lifecycles });
    await harness.service.initialize();
    const installed = await installAndWait(harness);
    const targetRootPath = join(dirname(harness.rootPath), "occupied");
    const definition = harness.registry.require("libreoffice");
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      "darwin",
      "arm64",
    );
    const targetPaths = harness.pathManager.resolveInstallationPaths(
      targetRootPath,
      definition,
      packageDefinition,
    );
    await mkdir(targetPaths.installationDirectory, { recursive: true });
    await writeFile(
      join(targetPaths.installationDirectory, "unknown.txt"),
      "keep",
    );

    const result = await harness.service.migrate(targetRootPath);

    expect(result).toMatchObject({
      status: "conflict",
      conflicts: [
        {
          libraryId: "libreoffice",
          targetStatus: "invalid",
        },
      ],
    });
    expect(release).not.toHaveBeenCalled();
    expect(harness.settings.getExternalLibrariesPath()).toBe(
      harness.rootPath,
    );
    await expect(
      access(installed.installationPath!),
    ).resolves.toBeUndefined();
    await expect(
      access(join(targetPaths.installationDirectory, "unknown.txt")),
    ).resolves.toBeUndefined();
  });

  it("replaces a confirmed target conflict transactionally", async () => {
    const harness = await createHarness();
    await harness.service.initialize();
    await installAndWait(harness);
    const targetRootPath = join(dirname(harness.rootPath), "replace");
    const definition = harness.registry.require("libreoffice");
    const packageDefinition = harness.registry.selectPackage(
      definition.id,
      "darwin",
      "arm64",
    );
    const targetPaths = harness.pathManager.resolveInstallationPaths(
      targetRootPath,
      definition,
      packageDefinition,
    );
    await mkdir(targetPaths.installationDirectory, { recursive: true });
    await writeFile(
      join(targetPaths.installationDirectory, "unknown.txt"),
      "replace me",
    );

    const result = await harness.service.migrate(
      targetRootPath,
      "replace-target",
    );

    expect(result.status).toBe("completed");
    await expect(
      access(join(targetPaths.installationDirectory, "unknown.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(await harness.service.requireExecutable("libreoffice")),
    ).resolves.toBeUndefined();
  });

  it("rejects nested roots before copying data", async () => {
    const harness = await createHarness();
    await harness.service.initialize();

    await expect(
      harness.service.migrate(join(harness.rootPath, "nested")),
    ).rejects.toThrow("EXTERNAL_LIBRARY_MIGRATION_FAILED");
    expect(harness.settings.getExternalLibrariesPath()).toBe(
      harness.rootPath,
    );
  });
});
