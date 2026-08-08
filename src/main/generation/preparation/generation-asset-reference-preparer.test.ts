import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../../shared/assets';
import type { AssetServiceApi } from '../../assets/asset-service';
import { WorkbenchRegistry } from '../../workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../workbench/workbench-session';
import { officeWorkbenchManifest } from '../../../workbenches/office/shared';
import { UnsupportedWorkbenchProvider } from '../../../workbenches/unsupported/main';
import { GenerationAssetReferencePreparer } from './generation-asset-reference-preparer';

const temporaryDirectories: string[] = [];

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
});
