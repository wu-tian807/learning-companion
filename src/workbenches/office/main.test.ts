import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import { AppError } from '../../main/errors/app-error';
import type {
  ExternalLibraryServiceApi,
} from '../../main/external-libraries/external-library-service';
import type {
  WorkbenchProviderContext,
} from '../../main/workbench/workbench-session';
import type {
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import {
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
} from '../../shared/assets';
import { createAssetSnapshot } from '../../main/assets/asset';
import {
  createOfficePreparePreviewCommand,
  createOfficeSaveViewStateCommand,
  OFFICE_WORKBENCH_ID,
} from './shared';
import { OfficeWorkbenchProvider } from './main';

const temporaryDirectories: string[] = [];

async function createHarness(input?: {
  readonly runtimeAvailable?: boolean;
  readonly cached?: boolean;
}) {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-office-provider-'),
  );
  temporaryDirectories.push(directory);
  const workspacePath = join(directory, 'workspace');
  const sourcePath = join(directory, 'course.docx');
  const artifactPath = join(directory, 'preview.pdf');
  await writeFile(sourcePath, 'office source');
  await writeFile(artifactPath, '%PDF-1.7\npreview\n%%EOF\n');
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '课程',
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef(sourcePath),
    createdTime: 1,
    updatedTime: 1,
  });
  const resolvedArtifact = {
    artifact: {
      assetId: asset.id,
      producerId: 'builtin.office.preview',
      artifactKey: 'preview',
      relativePath:
        '.learning-companion/artifacts/asset/builtin.office.preview/revision.pdf',
      mediaType: 'application/pdf',
      sourceRevision: 'source',
      producerVersion: 'producer',
      artifactRevision: 'artifact',
      updatedTime: 2,
    },
    absolutePath: artifactPath,
    cacheHit: Boolean(input?.cached),
  };
  const artifacts: AssetArtifactServiceApi = {
    getCached: vi.fn(async () =>
      input?.cached ? resolvedArtifact : undefined,
    ),
    getOrCreate: vi.fn(async () => resolvedArtifact),
  };
  const resources = {
    register: vi.fn(() => 'learning-content://resource/office-preview'),
    revokeSession: vi.fn(),
    handle: vi.fn(),
    dispose: vi.fn(),
  };
  const externalLibraries = {
    initialize: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    list: vi.fn(() => []),
    refresh: vi.fn(),
    startInstallation: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    migrate: vi.fn(),
    requireExecutable: vi.fn(async () => {
      if (input?.runtimeAvailable === false) {
        throw new AppError('EXTERNAL_LIBRARY_NOT_INSTALLED');
      }

      return '/runtime/soffice';
    }),
    subscribe: vi.fn(() => () => undefined),
  } satisfies ExternalLibraryServiceApi;
  const stateDatabase = {
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  } satisfies WorkbenchStateDatabaseApi;
  const provider = new OfficeWorkbenchProvider(
    artifacts,
    resources,
    externalLibraries,
    {
      get: vi.fn(() => ({
        id: 'project',
        name: 'Project',
        icon: '📘',
        createdTime: 1,
        pinned: false,
        workspacePath,
      })),
    },
    stateDatabase,
    { now: () => 10 },
  );
  const context: WorkbenchProviderContext = {
    sessionId: 'session',
    asset,
    content: {
      contentRef: asset.contentRef,
      contentStatus: createAssetContentStatus('available', 1),
      location: { kind: 'local-file', absolutePath: sourcePath },
      handle: {
        capabilities: new Set(['read-stream']),
        close: vi.fn(async () => undefined),
      },
    },
    attachments: [],
    state: undefined,
    selectionReason: 'matched',
    signal: new AbortController().signal,
  };

  return {
    artifacts,
    context,
    externalLibraries,
    provider,
    resources,
    stateDatabase,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('OfficeWorkbenchProvider', () => {
  it('opens a valid cached PDF without requiring LibreOffice', async () => {
    const harness = await createHarness({
      cached: true,
      runtimeAvailable: false,
    });

    await expect(
      harness.provider.open(harness.context),
    ).resolves.toMatchObject({
      payload: {
        status: 'ready',
        contentUrl:
          'learning-content://resource/office-preview',
      },
    });
    expect(
      harness.externalLibraries.requireExecutable,
    ).not.toHaveBeenCalled();
  });

  it('reports a missing runtime before conversion', async () => {
    const harness = await createHarness({
      runtimeAvailable: false,
    });

    await expect(
      harness.provider.open(harness.context),
    ).resolves.toMatchObject({
      payload: { status: 'runtime-required' },
    });
    expect(harness.artifacts.getOrCreate).not.toHaveBeenCalled();
  });

  it('prepares a PDF on command and persists Office-specific view state', async () => {
    const harness = await createHarness();
    await expect(
      harness.provider.open(harness.context),
    ).resolves.toMatchObject({
      payload: { status: 'conversion-required' },
    });

    await expect(
      harness.provider.command(
        harness.context,
        createOfficePreparePreviewCommand(),
      ),
    ).resolves.toMatchObject({
      payload: {
        status: 'ready',
        contentUrl:
          'learning-content://resource/office-preview',
      },
    });
    await harness.provider.command(
      harness.context,
      createOfficeSaveViewStateCommand({
        readingMode: 'paged',
        pageNumber: 3,
        pageOffsetRatio: 0.25,
        scaleMode: 'page-fit',
        customScale: 1,
        rotation: 0,
        sidebar: 'thumbnails',
      }),
    );

    expect(harness.stateDatabase.save).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset',
        workbenchId: OFFICE_WORKBENCH_ID,
        payload: expect.objectContaining({
          readingMode: 'paged',
          pageNumber: 3,
        }),
      }),
    );

    await harness.provider.close(harness.context);
    expect(harness.resources.revokeSession).toHaveBeenCalledWith(
      'session',
    );
  });
});
