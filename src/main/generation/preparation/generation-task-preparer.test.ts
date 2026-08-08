import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AssetSnapshot } from '../../../shared/assets';
import { AgentWorkspaceManager } from '../../agents/workspaces/agent-workspace-manager';
import type { AssetServiceApi } from '../../assets/asset-service';
import { WorkbenchRegistry } from '../../workbench/workbench-registry';
import { GenerationTask } from '../generation-task';
import { MindMapGenerationInstruction } from '../../../workbenches/mindmap/generation/mindmap-generation-instruction';
import { createMindMapGenerationTaskDefinitionV1 } from '../../../workbenches/mindmap/generation/mindmap-generation-task-definition';
import { UnsupportedWorkbenchProvider } from '../../../workbenches/unsupported/main';
import { GenerationAssetReferencePreparer } from './generation-asset-reference-preparer';
import { GenerationPreparedManifestFile } from './generation-prepared-manifest-file';
import { GenerationTaskPreparer } from './generation-task-preparer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationTaskPreparer', () => {
  it('copies references into the primary workspace and restores from its manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-prepare-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'lesson.md');
    await writeFile(sourcePath, '# Lesson\n', 'utf8');
    const asset: AssetSnapshot = {
      id: 'asset-1',
      projectId: 'project-1',
      name: 'lesson.md',
      mediaType: 'text/markdown',
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
    let resolveCount = 0;
    const assetService = {
      getActiveProjectId: () => 'project-1',
      get: (assetId: string) => (assetId === asset.id ? asset : undefined),
      resolveContent: async () => {
        resolveCount += 1;
        return {
          contentRef: asset.contentRef,
          contentStatus: asset.contentStatus,
          location: { kind: 'local-file' as const, absolutePath: sourcePath },
        };
      },
    } as unknown as AssetServiceApi;
    const workspaceRoot = join(directory, 'agent-workspaces');
    const preparer = new GenerationTaskPreparer(
      new AgentWorkspaceManager(workspaceRoot),
      new GenerationAssetReferencePreparer(
        assetService,
        new WorkbenchRegistry(new UnsupportedWorkbenchProvider()),
      ),
      new GenerationPreparedManifestFile(),
    );
    const definition = createMindMapGenerationTaskDefinitionV1({
      async process() {
        return { resultAssetId: 'unused' };
      },
    });
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction({
        additionalInstructions: '突出概念关系',
      }).toSnapshot(),
      assetReferences: { sources: [{ assetId: asset.id }] },
      createdTime: 10,
    });

    const prepared = await preparer.prepare(
      task.getSnapshot(),
      definition,
    );
    const copiedRelativePath =
      prepared.assetReferences.sources?.[0]?.relativePath;
    expect(copiedRelativePath).toBe(
      'references/sources-0001/source.md',
    );
    expect(
      await readFile(
        join(prepared.workspaces.primary.path, ...copiedRelativePath!.split('/')),
        'utf8',
      ),
    ).toBe('# Lesson\n');
    const messageText = prepared.defaultUserMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(messageText).toContain('sources-0001');
    expect(messageText).toContain(copiedRelativePath);
    expect(messageText).not.toContain(sourcePath);

    task.recordPrepared({
      checkpoint: {
        completedTime: 20,
        manifestRef: prepared.manifestRef,
      },
      durationMs: 10,
      updatedTime: 20,
    });
    await rm(sourcePath);
    const restored = await preparer.restore(task.getSnapshot(), definition);

    expect(restored.assetReferences).toEqual(prepared.assetReferences);
    expect(resolveCount).toBe(1);
  });
});
