import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../../shared/assets';
import type {
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../assets/asset-service';
import { createFileContentRevision } from '../../content/content-revision';
import type { ProjectLookup } from '../../projects/project-database';
import { WorkbenchRegistry } from '../../workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../workbench/workbench-session';
import { officeWorkbenchManifest } from '../../../workbenches/office/shared';
import { UnsupportedWorkbenchProvider } from '../../../workbenches/unsupported/main';
import { GenerationAssetReferencePreparer } from './generation-asset-reference-preparer';

const temporaryDirectories: string[] = [];

function projectLookup(workspacePath: string): ProjectLookup {
  return {
    get: (id) =>
      id === 'project-1'
        ? {
            id,
            name: 'Project',
            icon: 'P',
            pinned: false,
            createdTime: 1,
            workspacePath,
          }
        : undefined,
  };
}

function artifactService(
  available: readonly ResolvedAssetArtifact[] = [],
): AssetArtifactServiceApi {
  return {
    listAvailableByAsset: vi.fn(async (_assetId, _workspacePath, options) =>
      available.filter(
        ({ artifact }) =>
          !options?.acceptMediaType ||
          options.acceptMediaType(artifact.mediaType),
      ),
    ),
    getCached: vi.fn(),
    getOrCreate: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationAssetReferencePreparer', () => {
  it('copies the materialized content supplied by the selected Workbench', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-reference-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'lesson.docx');
    const materializedPath = join(directory, 'lesson-preview.pdf');
    const primaryWorkspacePath = join(directory, 'task-workspace');
    await writeFile(sourcePath, 'office source');
    await writeFile(materializedPath, '%PDF-1.7\npreview\n%%EOF\n');
    const asset: AssetSnapshot = {
      id: 'asset-office',
      projectId: 'project-1',
      name: 'lesson.docx',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      creationKind: 'imported',
      contentRef: {
        kind: 'local-file',
        base: 'absolute',
        path: sourcePath,
      },
      contentStatus: { availability: 'available', checkedTime: 1 },
      createdTime: 1,
      updatedTime: 1,
    };
    const close = vi.fn(async () => undefined);
    const resolvedContent = {
      contentRef: asset.contentRef,
      contentStatus: asset.contentStatus,
      location: { kind: 'local-file' as const, absolutePath: sourcePath },
      handle: {
        capabilities: new Set(['read-stream'] as const),
        close,
      },
    };
    const assetService = {
      getActiveProjectId: () => asset.projectId,
      get: (assetId: string) => (assetId === asset.id ? asset : undefined),
      resolveContent: vi.fn(async () => resolvedContent),
    } as unknown as AssetServiceApi;
    const materializeContent = vi.fn(async () => ({
      absolutePath: materializedPath,
      mediaType: 'application/pdf',
    }));
    const officeProvider: MainWorkbenchProvider = {
      manifest: officeWorkbenchManifest,
      materializeContent,
      open: vi.fn(async () => ({ payload: {} })),
      command: vi.fn(async () => ({ payload: {} })),
      close: vi.fn(async () => undefined),
    };
    const workbenches = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
    );
    workbenches.register(officeProvider);
    const preparer = new GenerationAssetReferencePreparer(
      assetService,
      workbenches,
      artifactService(),
      projectLookup(directory),
    );

    const prepared = await preparer.prepare({
      projectId: asset.projectId,
      schema: {
        sources: { required: true, cardinality: 'many' },
      },
      bindings: { sources: [{ assetId: asset.id }] },
      primaryWorkspacePath,
    });

    const reference = prepared.sources?.[0];
    expect(reference).toMatchObject({
      assetId: asset.id,
      mediaType: asset.mediaType,
      materializedMediaType: 'application/pdf',
      relativePath: 'references/sources-0001/source.pdf',
    });
    expect(
      await readFile(
        join(primaryWorkspacePath, 'references', 'sources-0001', 'source.pdf'),
        'utf8',
      ),
    ).toBe('%PDF-1.7\npreview\n%%EOF\n');
    expect(materializeContent).toHaveBeenCalledWith(
      expect.objectContaining({ asset, content: resolvedContent }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('projects only valid Agent-readable Artifacts and verifies their checkpoint hashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-reference-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'lesson.mp4');
    const subtitlePath = join(directory, 'lesson.srt');
    const metadataPath = join(directory, 'lesson.json');
    const audioPath = join(directory, 'lesson.wav');
    const primaryWorkspacePath = join(directory, 'task-workspace');
    await writeFile(sourcePath, 'video source');
    await writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
    await writeFile(metadataPath, '{"language":"en"}\n');
    await writeFile(audioPath, 'audio bytes');
    const asset: AssetSnapshot = {
      id: 'asset-video',
      projectId: 'project-1',
      name: 'lesson.mp4',
      mediaType: 'video/mp4',
      creationKind: 'imported',
      contentRef: {
        kind: 'local-file',
        base: 'absolute',
        path: sourcePath,
      },
      contentStatus: { availability: 'available', checkedTime: 1 },
      createdTime: 1,
      updatedTime: 1,
    };
    const resolvedContent = {
      contentRef: asset.contentRef,
      contentStatus: asset.contentStatus,
      location: { kind: 'local-file' as const, absolutePath: sourcePath },
      handle: { close: vi.fn(async () => undefined) },
    };
    const assetService = {
      getActiveProjectId: () => asset.projectId,
      get: (assetId: string) => (assetId === asset.id ? asset : undefined),
      resolveContent: vi.fn(async () => resolvedContent),
    } as unknown as AssetServiceApi;
    const resolvedArtifact = async (
      absolutePath: string,
      producerId: string,
      artifactKey: string,
      mediaType: string,
    ): Promise<ResolvedAssetArtifact> => ({
      absolutePath,
      cacheHit: true,
      artifact: {
        assetId: asset.id,
        producerId,
        artifactKey,
        relativePath: `.learning-companion/artifacts/${producerId}/${artifactKey}`,
        mediaType,
        sourceRevision: 'source-revision',
        producerVersion: '1',
        artifactRevision: await createFileContentRevision(absolutePath),
        updatedTime: 1,
      },
    });
    const artifacts = artifactService([
      await resolvedArtifact(
        sourcePath,
        'builtin.duplicate',
        'source',
        'video/mp4',
      ),
      await resolvedArtifact(
        subtitlePath,
        'builtin.media-subtitles.srt',
        'source.srt',
        'application/x-subrip',
      ),
      await resolvedArtifact(
        metadataPath,
        'builtin.media-subtitles.transcription',
        'source',
        'application/vnd.learning-companion.subtitle-track+json',
      ),
      await resolvedArtifact(
        audioPath,
        'builtin.audio-preview',
        'preview',
        'audio/wav',
      ),
    ]);
    const preparer = new GenerationAssetReferencePreparer(
      assetService,
      new WorkbenchRegistry(new UnsupportedWorkbenchProvider()),
      artifacts,
      projectLookup(directory),
    );
    const schema = {
      sources: { required: true, cardinality: 'many' as const },
    };
    const prepared = await preparer.prepare({
      projectId: asset.projectId,
      schema,
      bindings: { sources: [{ assetId: asset.id }] },
      primaryWorkspacePath,
    });

    expect(artifacts.listAvailableByAsset).toHaveBeenCalledWith(
      asset.id,
      directory,
      {
        acceptMediaType: expect.any(Function),
        connectedToRevision: await createFileContentRevision(sourcePath),
      },
    );
    expect(prepared.sources?.[0]?.artifacts).toEqual([
      expect.objectContaining({
        producerId: 'builtin.media-subtitles.srt',
        artifactKey: 'source.srt',
        mediaType: 'application/x-subrip',
        relativePath: 'references/sources-0001/artifacts/0001.srt',
      }),
      expect.objectContaining({
        producerId: 'builtin.media-subtitles.transcription',
        artifactKey: 'source',
        relativePath: 'references/sources-0001/artifacts/0002.json',
      }),
    ]);
    expect(
      await readFile(
        join(
          primaryWorkspacePath,
          'references',
          'sources-0001',
          'artifacts',
          '0001.srt',
        ),
        'utf8',
      ),
    ).toContain('Hello');
    await expect(
      preparer.verify(primaryWorkspacePath, schema, prepared),
    ).resolves.toEqual(prepared);

    await writeFile(
      join(
        primaryWorkspacePath,
        'references',
        'sources-0001',
        'artifacts',
        '0001.srt',
      ),
      'changed',
    );
    await expect(
      preparer.verify(primaryWorkspacePath, schema, prepared),
    ).rejects.toThrow('artifact');
  });
});
