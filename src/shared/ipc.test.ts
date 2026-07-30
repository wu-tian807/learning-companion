import { describe, expect, it } from "vitest";

import {
  createHealthCheckResponse,
  isAgentProviderIdRequest,
  isAgentProviderSetupRequest,
  isCancelAgentProviderLoginRequest,
  isAddLocalAssetsRequest,
  isAddLocalAssetsResult,
  isAssetIdRequest,
  isCreateProjectRequest,
  isChangeProjectWorkspaceRequest,
  isDeleteProjectRequest,
  isDeleteAssetsRequest,
  isDeleteAssetsResult,
  isExternalLibraryIdRequest,
  isMigrateExternalLibrariesRequest,
  isHealthCheckResponse,
  isOpenExternalRequest,
  isProjectLifecycleRequest,
  isRelinkAssetRequest,
  isRenameAssetRequest,
  isRenameProjectRequest,
  isSetProjectPinnedRequest,
  isSelectProjectWorkspaceRequest,
  isUpdateHomePreferencesRequest,
} from "./ipc";

describe("health check contract", () => {
  it("creates a serializable health response", () => {
    const now = new Date("2026-07-22T08:00:00.000Z");

    const response = createHealthCheckResponse("0.1.0", "darwin", now);

    expect(response).toEqual({
      status: "ok",
      appVersion: "0.1.0",
      platform: "darwin",
      timestamp: "2026-07-22T08:00:00.000Z",
    });
    expect(isHealthCheckResponse(response)).toBe(true);
  });

  it("rejects malformed responses", () => {
    expect(isHealthCheckResponse(null)).toBe(false);
    expect(isHealthCheckResponse({ status: "error" })).toBe(false);
    expect(
      isHealthCheckResponse({
        status: "ok",
        appVersion: "0.1.0",
        platform: "darwin",
        timestamp: "not-a-date",
      }),
    ).toBe(false);
  });
});

describe("external URL contract", () => {
  it("accepts credential-free HTTP and HTTPS URLs", () => {
    expect(
      isOpenExternalRequest({ url: "https://example.com/guide?q=pdf#page-2" }),
    ).toBe(true);
    expect(
      isOpenExternalRequest({ url: "http://localhost:4173/document" }),
    ).toBe(true);
  });

  it("rejects unsupported protocols, credentials, and malformed URLs", () => {
    expect(isOpenExternalRequest({ url: "file:///tmp/private.txt" })).toBe(
      false,
    );
    expect(
      isOpenExternalRequest({ url: "javascript:alert(document.cookie)" }),
    ).toBe(false);
    expect(
      isOpenExternalRequest({ url: "https://user:secret@example.com" }),
    ).toBe(false);
    expect(isOpenExternalRequest({ url: "not a URL" })).toBe(false);
    expect(isOpenExternalRequest({ url: " https://example.com " })).toBe(false);
  });
});

describe("external library contract", () => {
  it("accepts only stable registered-style library IDs", () => {
    expect(isExternalLibraryIdRequest({ libraryId: "libreoffice" })).toBe(true);
    expect(
      isExternalLibraryIdRequest({
        libraryId: "builtin.media-runtime_2",
      }),
    ).toBe(true);
    expect(isExternalLibraryIdRequest({ libraryId: "../runtime" })).toBe(false);
    expect(isExternalLibraryIdRequest({ libraryId: "" })).toBe(false);
  });

  it("accepts only absolute migration targets and known resolutions", () => {
    expect(
      isMigrateExternalLibrariesRequest({
        targetPath: "/Users/student/External Libraries",
      }),
    ).toBe(true);
    expect(
      isMigrateExternalLibrariesRequest({
        targetPath: "C:\\External Libraries",
        conflictResolution: "replace-target",
      }),
    ).toBe(true);
    expect(
      isMigrateExternalLibrariesRequest({
        targetPath: "relative",
      }),
    ).toBe(false);
    expect(
      isMigrateExternalLibrariesRequest({
        targetPath: "/tmp/runtime",
        conflictResolution: "overwrite",
      }),
    ).toBe(false);
  });
});

describe("project mutation contracts", () => {
  it("accepts valid mutation requests", () => {
    expect(isCreateProjectRequest({ name: "新 Project" })).toBe(true);
    expect(
      isCreateProjectRequest({
        name: "新 Project",
        workspacePath: "/tmp/projects/new",
      }),
    ).toBe(true);
    expect(isSelectProjectWorkspaceRequest({ projectId: "project-1" })).toBe(
      true,
    );
    expect(
      isChangeProjectWorkspaceRequest({
        projectId: "project-1",
        workspacePath: "/tmp/projects/moved",
      }),
    ).toBe(true);
    expect(isRenameProjectRequest({ id: "project-1", name: "新标题" })).toBe(
      true,
    );
    expect(isSetProjectPinnedRequest({ id: "project-1", pinned: true })).toBe(
      true,
    );
    expect(isDeleteProjectRequest({ id: "project-1" })).toBe(true);
  });

  it("rejects malformed mutation requests", () => {
    expect(isCreateProjectRequest({ name: "" })).toBe(false);
    expect(isCreateProjectRequest({ icon: "📘" })).toBe(false);
    expect(
      isCreateProjectRequest({
        name: "新 Project",
        workspacePath: "relative/path",
      }),
    ).toBe(false);
    expect(isRenameProjectRequest({ id: "", name: "新标题" })).toBe(false);
    expect(isSetProjectPinnedRequest({ id: "project-1", pinned: "yes" })).toBe(
      false,
    );
    expect(isDeleteProjectRequest(null)).toBe(false);
  });
});

describe("Asset contracts", () => {
  it("accepts Asset requests", () => {
    expect(isProjectLifecycleRequest({ projectId: "project" })).toBe(true);
    expect(
      isAddLocalAssetsRequest({
        projectId: "project",
        paths: ["/tmp/a.md", "/tmp/b.pdf"],
        mode: "link",
      }),
    ).toBe(true);
    expect(isRenameAssetRequest({ assetId: "asset", name: "新标题" })).toBe(
      true,
    );
    expect(
      isRelinkAssetRequest({ assetId: "asset", path: "/tmp/new.md" }),
    ).toBe(true);
    expect(isAssetIdRequest({ assetId: "asset" })).toBe(true);
    expect(
      isDeleteAssetsRequest({
        projectId: "project",
        assetIds: ["asset-a", "asset-b"],
      }),
    ).toBe(true);
  });

  it("rejects malformed Asset requests", () => {
    expect(isProjectLifecycleRequest({ projectId: "" })).toBe(false);
    expect(isAddLocalAssetsRequest({ projectId: "project", paths: [] })).toBe(
      false,
    );
    expect(isAddLocalAssetsRequest({ paths: ["/tmp/a.md"] })).toBe(false);
    expect(
      isAddLocalAssetsRequest({
        projectId: "",
        paths: ["/tmp/a.md"],
      }),
    ).toBe(false);
    expect(
      isAddLocalAssetsRequest({
        projectId: "project",
        paths: ["/tmp/a.md"],
        mode: "move",
      }),
    ).toBe(false);
    expect(isRenameAssetRequest({ assetId: "asset", name: "" })).toBe(false);
    expect(isRelinkAssetRequest({ assetId: "", path: "/tmp/new.md" })).toBe(
      false,
    );
    expect(isAssetIdRequest(null)).toBe(false);
    expect(
      isDeleteAssetsRequest({
        projectId: "project",
        assetIds: [],
      }),
    ).toBe(false);
    expect(
      isDeleteAssetsRequest({
        projectId: "project",
        assetIds: ["asset", "asset"],
      }),
    ).toBe(false);
  });

  it("rejects malformed batch addition results", () => {
    const asset = {
      id: "asset",
      projectId: "project",
      name: "资料",
      mediaType: "text/plain",
      contentRef: {
        kind: "local-file",
        base: "absolute",
        path: "/tmp/a.txt",
      },
      contentStatus: {
        availability: "available",
        checkedTime: 100,
      },
      createdTime: 100,
      lastUsedTime: 100,
    };

    expect(
      isAddLocalAssetsResult({
        added: [asset],
        failed: [],
        assets: [asset],
      }),
    ).toBe(true);
    expect(
      isAddLocalAssetsResult({
        added: [asset],
        failed: [],
        assets: [],
      }),
    ).toBe(false);
    expect(
      isAddLocalAssetsResult({
        added: [],
        failed: [{ path: "/tmp/a.md", message: "" }],
        assets: [],
      }),
    ).toBe(false);
    expect(
      isAddLocalAssetsResult({
        added: [null],
        failed: [],
        assets: [],
      }),
    ).toBe(false);
  });

  it("validates batch deletion results", () => {
    const remainingAsset = {
      id: "remaining",
      projectId: "project",
      name: "资料",
      mediaType: "text/plain",
      contentRef: {
        kind: "local-file",
        base: "absolute",
        path: "/tmp/a.txt",
      },
      contentStatus: {
        availability: "available",
        checkedTime: 100,
      },
      createdTime: 100,
      lastUsedTime: 100,
    };

    expect(
      isDeleteAssetsResult({
        deletedAssetIds: ["deleted"],
        failed: [
          {
            assetId: "remaining",
            message: "正在使用",
          },
        ],
        assets: [remainingAsset],
      }),
    ).toBe(true);
    expect(
      isDeleteAssetsResult({
        deletedAssetIds: ["remaining"],
        failed: [],
        assets: [remainingAsset],
      }),
    ).toBe(false);
    expect(
      isDeleteAssetsResult({
        deletedAssetIds: ["same"],
        failed: [{ assetId: "same", message: "失败" }],
        assets: [],
      }),
    ).toBe(false);
  });
});

describe("Agent Provider contract", () => {
  it("validates setup, login, cancel, and selection requests", () => {
    expect(isAgentProviderSetupRequest(undefined)).toBe(true);
    expect(
      isAgentProviderSetupRequest({ refreshCredentials: true }),
    ).toBe(true);
    expect(isAgentProviderSetupRequest({ refreshCredentials: "yes" })).toBe(
      false,
    );

    expect(isAgentProviderIdRequest({ providerId: "codex" })).toBe(true);
    expect(isAgentProviderIdRequest({ providerId: "../codex" })).toBe(false);
    expect(
      isCancelAgentProviderLoginRequest({
        providerId: "codex",
        loginId: "login-1",
      }),
    ).toBe(true);
    expect(
      isCancelAgentProviderLoginRequest({
        providerId: "codex",
        loginId: "",
      }),
    ).toBe(false);
  });
});

describe("settings mutation contracts", () => {
  it("accepts supported home preferences", () => {
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: "list",
        sortMode: "title",
      }),
    ).toBe(true);
  });

  it("rejects malformed home preferences", () => {
    expect(isUpdateHomePreferencesRequest(null)).toBe(false);
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: "compact",
        sortMode: "newest",
      }),
    ).toBe(false);
    expect(
      isUpdateHomePreferencesRequest({
        viewMode: "grid",
        sortMode: "popular",
      }),
    ).toBe(false);
  });
});
