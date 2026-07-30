import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AssetArtifactFileManager,
} from './asset-artifact-file-manager';

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    join(tmpdir(), 'learning-companion-artifact-files-'),
  );
  temporaryDirectories.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('AssetArtifactFileManager', () => {
  it('commits an immutable revision and validates it', async () => {
    const workspace = await createWorkspace();
    const manager = new AssetArtifactFileManager({
      createId: () => 'job',
    });
    const stagingDirectory =
      await manager.createStagingDirectory(workspace);
    const producedFilePath = join(stagingDirectory, 'preview.pdf');
    await writeFile(producedFilePath, '%PDF-1.7\npreview');

    const committed = await manager.commitFile({
      workspacePath: workspace,
      stagingDirectory,
      producedFilePath,
      assetId: 'asset',
      producerId: 'builtin.office.preview',
      extension: '.PDF',
    });

    expect(committed.relativePath).toMatch(
      /^\.learning-companion\/artifacts\/asset\/builtin\.office\.preview\/[a-f0-9]{64}\.pdf$/u,
    );
    expect(await readFile(committed.absolutePath, 'utf8')).toBe(
      '%PDF-1.7\npreview',
    );
    await expect(
      manager.resolveValidArtifact(workspace, {
        assetId: 'asset',
        producerId: 'builtin.office.preview',
        artifactKey: 'preview',
        relativePath: committed.relativePath,
        mediaType: 'application/pdf',
        sourceRevision: 'source',
        producerVersion: 'producer',
        artifactRevision: committed.artifactRevision,
        updatedTime: 1,
      }),
    ).resolves.toBe(committed.absolutePath);
  });

  it('reuses an existing content revision without overwriting it', async () => {
    const workspace = await createWorkspace();
    const manager = new AssetArtifactFileManager();
    const commit = async () => {
      const stagingDirectory =
        await manager.createStagingDirectory(workspace);
      const producedFilePath = join(stagingDirectory, 'preview.pdf');
      await writeFile(producedFilePath, '%PDF-1.7\nsame');
      return manager.commitFile({
        workspacePath: workspace,
        stagingDirectory,
        producedFilePath,
        assetId: 'asset',
        producerId: 'builtin.office.preview',
        extension: 'pdf',
      });
    };

    const first = await commit();
    const second = await commit();

    expect(second).toEqual(first);
  });

  it('rejects files outside staging and paths outside Artifact space', async () => {
    const workspace = await createWorkspace();
    const manager = new AssetArtifactFileManager();
    const stagingDirectory =
      await manager.createStagingDirectory(workspace);
    const outsidePath = join(workspace, 'outside.pdf');
    await writeFile(outsidePath, '%PDF-1.7');

    await expect(
      manager.commitFile({
        workspacePath: workspace,
        stagingDirectory,
        producedFilePath: outsidePath,
        assetId: 'asset',
        producerId: 'builtin.office.preview',
        extension: 'pdf',
      }),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(
      manager.removeArtifactFile(workspace, 'assets/imported/course.docx'),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(
      manager.cleanupStagingDirectory(workspace, workspace),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(access(outsidePath)).resolves.toBeUndefined();
  });

  it('returns missing when the committed file is changed', async () => {
    const workspace = await createWorkspace();
    const manager = new AssetArtifactFileManager();
    const stagingDirectory =
      await manager.createStagingDirectory(workspace);
    const producedFilePath = join(stagingDirectory, 'preview.pdf');
    await writeFile(producedFilePath, '%PDF-1.7\nbefore');
    const committed = await manager.commitFile({
      workspacePath: workspace,
      stagingDirectory,
      producedFilePath,
      assetId: 'asset',
      producerId: 'builtin.office.preview',
      extension: 'pdf',
    });
    await writeFile(committed.absolutePath, '%PDF-1.7\nafter');

    await expect(
      manager.resolveValidArtifact(workspace, {
        assetId: 'asset',
        producerId: 'builtin.office.preview',
        artifactKey: 'preview',
        relativePath: committed.relativePath,
        mediaType: 'application/pdf',
        sourceRevision: 'source',
        producerVersion: 'producer',
        artifactRevision: committed.artifactRevision,
        updatedTime: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
