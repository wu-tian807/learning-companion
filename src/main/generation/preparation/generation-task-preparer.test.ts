import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../../shared/assets';
import { AgentWorkspaceManager } from '../../agents/workspaces/agent-workspace-manager';
import type { AssetServiceApi } from '../../assets/asset-service';
import { WorkbenchRegistry } from '../../workbench/workbench-registry';
import { GenerationTask } from '../generation-task';
import { HtmlAssistantInstruction } from '../../../workbenches/html/generation/html-assistant-instruction';
import { createHtmlAssistantTaskDefinitionV1 } from '../../../workbenches/html/generation/html-assistant-task-definition';
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
    const baseDefinition = createMindMapGenerationTaskDefinitionV1({
      async process() {
        return { resultAssetId: 'unused' };
      },
    });
    const definition = Object.freeze({
      ...baseDefinition,
      primaryWorkspaceConfig: Object.freeze({
        ...baseDefinition.primaryWorkspaceConfig,
        resolveInstanceKey: ({ instruction }: { instruction: unknown }) =>
          (instruction as { additionalInstructions: string })
            .additionalInstructions,
      }),
    });
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new MindMapGenerationInstruction({
        additionalInstructions: 'conversation-1',
      }).toSnapshot(),
      assetReferences: { sources: [{ assetId: asset.id }] },
      createdTime: 10,
    });

    const prepared = await preparer.prepare(
      task.getSnapshot(),
      definition,
    );
    expect(prepared.workspaces.primary.instanceKey).toBe('conversation-1');
    expect(prepared.workspaces.primary.path).toBe(
      join(
        workspaceRoot,
        'project-1',
        'generation-mindmap',
        'conversation-1',
      ),
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
    expect(restored.workspaces.primary.path).toBe(
      prepared.workspaces.primary.path,
    );
    expect(restored.workspaces.primary.instanceKey).toBe('conversation-1');
    expect(resolveCount).toBe(1);
  });

  it('resolves the HTML conversation workspace from the validated instruction', async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'learning-companion-generation-named-'),
    );
    temporaryDirectories.push(workspaceRoot);
    const preparedReferences = Object.freeze({
      sources: Object.freeze([
        Object.freeze({
          alias: 'sources-0001',
          assetId: 'asset-1',
          name: 'lesson.html',
          mediaType: 'text/html',
          contentRevision: 'revision-1',
          relativePath: 'references/sources-0001/source.html',
        }),
      ]),
    });
    const preparer = new GenerationTaskPreparer(
      new AgentWorkspaceManager(workspaceRoot),
      {
        prepare: vi.fn(async () => preparedReferences),
        verify: vi.fn(async () => preparedReferences),
      },
      {
        write: vi.fn(async () => ({}) as never),
        read: vi.fn(async () => ({}) as never),
      },
    );
    const definition = createHtmlAssistantTaskDefinitionV1({
      async process() {
        return { answer: 'unused' };
      },
    });
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: new HtmlAssistantInstruction({
        conversationId: 'conversation-1',
        question: '总结当前资料',
      }).toSnapshot(),
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
      createdTime: 10,
    });

    const prepared = await preparer.prepare(
      task.getSnapshot(),
      definition,
    );

    expect(prepared.workspaces.primary).toMatchObject({
      key: 'html-assistant',
      instanceKey: 'conversation-1',
    });
    expect(prepared.workspaces.primary.path).toBe(
      join(
        workspaceRoot,
        'project-1',
        'html-assistant',
        'conversation-1',
      ),
    );
  });

  it('isolates prepared manifests per taskId inside a reused conversation workspace', async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'learning-companion-generation-named-isolation-'),
    );
    temporaryDirectories.push(workspaceRoot);
    const manifestFile = new GenerationPreparedManifestFile();
    const preparer = new GenerationTaskPreparer(
      new AgentWorkspaceManager(workspaceRoot),
      {
        prepare: vi.fn(async ({ bindings }) =>
          references(bindings.sources[0]?.assetId ?? 'asset-1'),
        ),
        verify: vi.fn(async (_path, _schema, bindings) =>
          references(bindings.sources[0]?.assetId ?? 'asset-1'),
        ),
      },
      manifestFile,
    );
    const definition = createHtmlAssistantTaskDefinitionV1({
      async process() {
        return { answer: 'unused' };
      },
    });
    const createTask = (id: string, assetId: string) =>
      GenerationTask.create({
        id,
        projectId: 'project-1',
        definitionId: definition.id,
        definitionVersion: definition.version,
        instruction: new HtmlAssistantInstruction({
          conversationId: 'conversation-1',
          question: '问题 ' + id,
        }).toSnapshot(),
        assetReferences: { sources: [{ assetId }] },
        createdTime: 10,
      });

    // 同一 conversation 连续两个 task：prepared manifest 必须按 taskId 隔离，
    // 恢复第一个 task 不能读到第二个 task 的 manifest。
    const firstTask = createTask('task-a', 'asset-1');
    const secondTask = createTask('task-b', 'asset-2');
    const firstPrepared = await preparer.prepare(
      firstTask.getSnapshot(),
      definition,
    );
    const secondPrepared = await preparer.prepare(
      secondTask.getSnapshot(),
      definition,
    );

    expect(firstPrepared.manifestRef).toContain('task-a');
    expect(secondPrepared.manifestRef).toContain('task-b');
    expect(firstPrepared.manifestRef).not.toBe(secondPrepared.manifestRef);

    firstTask.recordPrepared({
      checkpoint: { completedTime: 20, manifestRef: firstPrepared.manifestRef },
      durationMs: 10,
      updatedTime: 20,
    });
    secondTask.recordPrepared({
      checkpoint: { completedTime: 20, manifestRef: secondPrepared.manifestRef },
      durationMs: 10,
      updatedTime: 20,
    });

    const restoredFirst = await preparer.restore(
      firstTask.getSnapshot(),
      definition,
    );
    const restoredSecond = await preparer.restore(
      secondTask.getSnapshot(),
      definition,
    );

    // 各自恢复出各自的 asset reference，互不串线。
    expect(
      restoredFirst.assetReferences.sources[0]?.assetId,
    ).toBe('asset-1');
    expect(
      restoredSecond.assetReferences.sources[0]?.assetId,
    ).toBe('asset-2');
  });

  function references(assetId: string) {
    return Object.freeze({
      sources: Object.freeze([
        Object.freeze({
          alias: 'sources-0001',
          assetId,
          name: 'lesson.html',
          mediaType: 'text/html',
          contentRevision: 'revision-1',
          relativePath: 'references/sources-0001/source.html',
        }),
      ]),
    });
  }
});
