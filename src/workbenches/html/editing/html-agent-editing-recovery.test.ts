import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentFunctionToolExecutionContext } from '../../../main/agents/function-tools/agent-function-tool';
import { createTextRevision } from '../../../main/content/text-content';
import { createProjectWorkspaceContentRef } from '../../../main/content/content-ref';
import { LocalFileContentResolver } from '../../../main/content/resolvers/local-file/local-file-content-resolver';
import type { WorkbenchStateDataRecord } from '../../../main/workbench/workbench-state-data-database';
import { HtmlAgentEditingService } from './html-agent-editing-service';

const ORIGINAL = '<html><body><p id="target">A</p></body></html>';

function context(taskId: string): AgentFunctionToolExecutionContext {
  return {
    taskId,
    projectId: 'project-1',
    workspaces: {
      primary: {
        key: 'workbench-conversation',
        instanceKey: 'conversation-1',
        path: 'C:\\workspace',
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

function task(
  taskId: string,
  terminal?: 'completed' | 'failed' | 'cancelled',
) {
  return {
    id: taskId,
    projectId: 'project-1',
    definitionId: 'builtin.workbench-conversation',
    definitionVersion: 1,
    instruction: {
      format: 'workbench-conversation',
      version: 1,
      contextProviderId: 'builtin.html.conversation',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '修改段落',
    },
    assetReferences: { source: [{ assetId: 'asset-1' }] },
    prepared: {
      completedTime: 2,
      assetReferences: {
        source: [
          {
            alias: 'source-0001',
            assetId: 'asset-1',
            name: 'lesson.html',
            mediaType: 'text/html',
            materializedMediaType: 'text/html',
            contentRevision: 'source-revision',
            relativePath: 'references/source-0001/source.html',
          },
        ],
      },
      workspaces: { primary: context(taskId).workspaces.primary, secondary: [] },
    },
    agentCalls: [],
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      activeDurationMs: 0,
      turnCount: 0,
      repairTurnCount: 0,
    },
    ...(terminal === 'completed'
      ? { completed: { completedTime: 4, result: {} } }
      : {}),
    ...(terminal === 'failed'
      ? { failure: { phase: 'process', failedTime: 4, message: 'failed' } }
      : {}),
    ...(terminal === 'cancelled' ? { cancelledTime: 4 } : {}),
    createdTime: 1,
    updatedTime: terminal ? 4 : 2,
  };
}

function harness() {
  const data = new Map<string, WorkbenchStateDataRecord>();
  const snapshots = new Map<string, ReturnType<typeof task>>();
  let source = new TextEncoder().encode(ORIGINAL);
  let failDataSaveAfterSourceWrite = false;
  let failNextDataSave = false;

  const stateDataDatabase = {
    get: vi.fn(async (assetId: string) => data.get(assetId)),
    save: vi.fn(async (record: WorkbenchStateDataRecord) => {
      if (failNextDataSave) {
        failNextDataSave = false;
        throw new Error('simulated draft persistence failure');
      }
      if (failDataSaveAfterSourceWrite && writeBytes.mock.calls.length > 0) {
        failDataSaveAfterSourceWrite = false;
        throw new Error('simulated state persistence failure');
      }
      data.set(record.assetId, structuredClone(record));
    }),
    delete: vi.fn(async (assetId: string) => {
      data.delete(assetId);
    }),
  };
  const writeBytes = vi.fn(
    async (request: { readonly content: Uint8Array; readonly expectedRevision: string }) => {
      expect(request.expectedRevision).toBe(createTextRevision(source));
      source = new Uint8Array(request.content);
      return { revision: createTextRevision(source) };
    },
  );
  const assets = {
    getActiveProjectId: () => 'project-1',
    get: () => ({
      id: 'asset-1',
      projectId: 'project-1',
      mediaType: 'text/html',
    }),
    resolveContent: vi.fn(async () => ({
      contentStatus: { availability: 'available', checkedTime: 1 },
      handle: {
        capabilities: new Set(['read-bytes', 'write-bytes']),
        readBytes: vi.fn(async () => ({
          content: source,
          revision: createTextRevision(source),
        })),
        writeBytes,
        close: vi.fn(async () => undefined),
      },
    })),
  };
  const generationTasks = {
    get: (taskId: string) => snapshots.get(taskId),
    subscribe: vi.fn(() => () => undefined),
  };
  const createService = () =>
    new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase,
    );
  const createStateDataOnlyService = () =>
    new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase as never,
    );
  const begin = async (service: HtmlAgentEditingService, taskId: string) =>
    (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      context(taskId),
    )) as { readonly editId: string };

  return {
    begin,
    corruptDraft: () => {
      const record = data.get('asset-1');
      if (!record) throw new Error('Expected persisted HTML draft');
      data.set('asset-1', {
        ...record,
        data: new TextEncoder().encode('{broken-json'),
      });
    },
    createService,
    createStateDataOnlyService,
    draftSave: stateDataDatabase.save,
    failDataSaveAfterSourceWrite: () => {
      failDataSaveAfterSourceWrite = true;
    },
    failNextDataSave: () => {
      failNextDataSave = true;
    },
    mutateDraftRecord: (
      mutate: (value: Record<string, unknown>) => void,
    ) => {
      const record = data.get('asset-1');
      if (!record) throw new Error('Expected persisted HTML draft');
      const decoded = JSON.parse(
        new TextDecoder().decode(record.data),
      ) as Record<string, unknown>;
      mutate(decoded);
      data.set('asset-1', {
        ...record,
        data: new TextEncoder().encode(JSON.stringify(decoded)),
      });
    },
    snapshots,
    source: () => new TextDecoder().decode(source),
    writeBytes,
  };
}

describe('HtmlAgentEditingService recovery', () => {
  it('does not persist a draft while only reading preview state', async () => {
    const test = harness();
    const service = test.createService();

    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { hasDraft: false, pending: false, stepCount: 0 },
    });
    expect(test.draftSave).not.toHaveBeenCalled();
  });

  it('finishes queued sync when an active begin ends without replace', async () => {
    const test = harness();
    const service = test.createService();
    test.snapshots.set('task-1', task('task-1'));
    const first = await test.begin(service, 'task-1');
    await service.replace(first.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);

    test.snapshots.set('task-2', task('task-2'));
    await test.begin(service, 'task-2');
    await expect(service.requestSync('project-1', 'asset-1')).resolves.toMatchObject({
      disposition: 'queued',
    });
    const failed = task('task-2', 'failed');
    test.snapshots.set('task-2', failed);
    await service.handleTaskSnapshot(failed as never);

    expect(test.writeBytes).toHaveBeenCalledOnce();
    expect(test.source()).toContain('>B<');
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { unsynced: false, syncRequested: false },
    });
  });

  it('finishes queued sync when an active begin is discarded', async () => {
    const test = harness();
    const service = test.createService();
    test.snapshots.set('task-1', task('task-1'));
    const first = await test.begin(service, 'task-1');
    await service.replace(first.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);

    test.snapshots.set('task-2', task('task-2'));
    await test.begin(service, 'task-2');
    await expect(service.requestSync('project-1', 'asset-1')).resolves.toMatchObject({
      disposition: 'queued',
    });

    await service.handleTaskDiscarded(task('task-2') as never);

    expect(test.writeBytes).toHaveBeenCalledOnce();
    expect(test.source()).toContain('>B<');
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { unsynced: false, syncRequested: false },
    });
  });

  it('resumes a persisted sync intent after restart', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    await first.requestSync('project-1', 'asset-1');
    first.dispose();

    test.snapshots.set('task-1', task('task-1', 'completed'));
    const restored = test.createService();
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        editable: true,
        unsynced: false,
        syncRequested: false,
        conflict: null,
      },
    });
    expect(test.writeBytes).toHaveBeenCalledOnce();
    expect(test.source()).toContain('>B<');
  });

  it('restores the draft from one atomic Workbench StateData record', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createStateDataOnlyService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await first.handleTaskSnapshot(completed as never);
    first.dispose();

    test.snapshots.set('task-2', task('task-2'));
    const restored = test.createStateDataOnlyService();
    const next = await test.begin(restored, 'task-2');

    expect(next).toMatchObject({ currentHtml: 'B' });
  });

  it('keeps the previous draft when the atomic StateData write fails', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    test.failNextDataSave();

    await expect(
      first.replace(edit.editId, 'B', context('task-1')),
    ).rejects.toThrow('simulated draft persistence failure');
    first.dispose();

    const restored = test.createService();
    const next = await test.begin(restored, 'task-1');
    expect(next).toMatchObject({ currentHtml: 'A' });
  });

  it('rolls back the entire pending step when a GenerationTask fails', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const service = test.createService();
    const edit = await test.begin(service, 'task-1');
    await service.replace(edit.editId, 'B', context('task-1'));
    const failed = task('task-1', 'failed');
    test.snapshots.set('task-1', failed);

    await service.handleTaskSnapshot(failed as never);

    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { hasDraft: false, pending: false, stepCount: 0 },
    });
  });

  it('restores and rolls back a failed pending GenerationTask after restart', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    first.dispose();

    test.snapshots.set('task-1', task('task-1', 'failed'));
    const restored = test.createService();

    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { hasDraft: false, pending: false, stepCount: 0 },
    });
    expect(test.source()).toBe(ORIGINAL);
  });

  it('reconciles a source write completed before session persistence', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await first.handleTaskSnapshot(completed as never);
    test.failDataSaveAfterSourceWrite();

    await expect(first.requestSync('project-1', 'asset-1')).rejects.toThrow(
      'simulated state persistence failure',
    );
    expect(test.source()).toContain('>B<');
    first.dispose();

    const restored = test.createService();
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        editable: true,
        unsynced: false,
        syncRequested: false,
        conflict: null,
      },
    });
    expect(test.writeBytes).toHaveBeenCalledOnce();
  });

  it('reconciles an already-written source when sync is retried immediately', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const service = test.createService();
    const edit = await test.begin(service, 'task-1');
    await service.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);
    test.failDataSaveAfterSourceWrite();

    await expect(service.requestSync('project-1', 'asset-1')).rejects.toThrow(
      'simulated state persistence failure',
    );
    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      disposition: 'synced',
      status: {
        unsynced: false,
        syncRequested: false,
        conflict: null,
      },
    });
    expect(test.writeBytes).toHaveBeenCalledOnce();
  });

  it('does not write the source again when an already-synced draft is retried', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const service = test.createService();
    const edit = await test.begin(service, 'task-1');
    await service.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);

    await service.requestSync('project-1', 'asset-1');
    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      disposition: 'synced',
      status: { unsynced: false, syncRequested: false },
    });

    expect(test.writeBytes).toHaveBeenCalledOnce();
  });

  it('blocks undo and redo while a begin transaction is active', async () => {
    for (const command of ['undo', 'redo'] as const) {
      const test = harness();
      test.snapshots.set('task-1', task('task-1'));
      const service = test.createService();
      const edit = await test.begin(service, 'task-1');
      await service.replace(edit.editId, 'B', context('task-1'));
      const completed = task('task-1', 'completed');
      test.snapshots.set('task-1', completed);
      await service.handleTaskSnapshot(completed as never);
      if (command === 'redo') {
        await service.undo('project-1', 'asset-1');
      }

      test.snapshots.set('task-2', task('task-2'));
      await test.begin(service, 'task-2');

      await expect(
        service[command]('project-1', 'asset-1'),
      ).rejects.toThrow('Agent 修改尚未收口');
    }
  });

  it('keeps persisted recovery when materialized-cache cleanup blocks discard', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const service = test.createService();
    const edit = await test.begin(service, 'task-1');
    await service.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);
    const materializedPath = await service.materializeReference(
      'project-1',
      'asset-1',
    );
    await rm(materializedPath, { force: true });
    await mkdir(materializedPath);
    await writeFile(join(materializedPath, 'locked'), 'blocks non-recursive rm');

    try {
      await expect(
        service.discard('project-1', 'asset-1'),
      ).rejects.toBeDefined();
      service.dispose();

      const restored = test.createService();
      await expect(restored.getDraft('project-1', 'asset-1')).resolves.toContain(
        '>B<',
      );
    } finally {
      await rm(materializedPath, { recursive: true, force: true });
    }
  });

  it('marks a restored pending edit conflicted when its task is missing', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    first.dispose();
    test.snapshots.delete('task-1');

    const restored = test.createService();
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        editable: false,
        pending: true,
        conflict: 'RECOVERY_INCONSISTENT',
      },
    });
    expect(test.writeBytes).not.toHaveBeenCalled();
  });

  it('rolls back a discarded pending edit after restart before the Asset is opened', async () => {
    const test = harness();
    const discarded = task('task-1');
    test.snapshots.set('task-1', discarded);
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    first.dispose();
    test.snapshots.delete('task-1');

    const restored = test.createService();
    await restored.handleTaskDiscarded(discarded as never);

    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        editable: true,
        hasDraft: false,
        pending: false,
        conflict: null,
      },
    });
    expect(test.writeBytes).not.toHaveBeenCalled();
  });

  it('opens a damaged draft as a discardable read-only conflict', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    first.dispose();
    test.corruptDraft();

    const restored = test.createService();
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      content: ORIGINAL,
      status: {
        editable: false,
        hasDraft: true,
        conflict: 'RECOVERY_INCONSISTENT',
      },
    });
    await expect(restored.discard('project-1', 'asset-1')).resolves.toEqual({
      discarded: true,
    });
  });

  it('fails closed when a persisted history range no longer matches the draft', async () => {
    const test = harness();
    test.snapshots.set('task-1', task('task-1'));
    const first = test.createService();
    const edit = await test.begin(first, 'task-1');
    await first.replace(edit.editId, 'B', context('task-1'));
    const completed = task('task-1', 'completed');
    test.snapshots.set('task-1', completed);
    await first.handleTaskSnapshot(completed as never);
    first.dispose();
    test.mutateDraftRecord((record) => {
      const history = record.history as {
        entries: Array<{ operations: Array<{ rangeStart: number }> }>;
      };
      history.entries[0]!.operations[0]!.rangeStart = 0;
    });

    const restored = test.createService();
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        editable: false,
        conflict: 'RECOVERY_INCONSISTENT',
      },
    });
  });

  it('rejects unsupported persisted enum values', async () => {
    for (const [field, value] of [
      ['encoding', 'utf-16'],
      ['conflict', 'UNKNOWN_CONFLICT'],
    ] as const) {
      const test = harness();
      test.snapshots.set('task-1', task('task-1'));
      const first = test.createService();
      const edit = await test.begin(first, 'task-1');
      await first.replace(edit.editId, 'B', context('task-1'));
      first.dispose();
      test.mutateDraftRecord((record) => {
        record[field] = value;
      });

      const restored = test.createService();
      await expect(
        restored.getDraftSnapshot('project-1', 'asset-1'),
      ).resolves.toMatchObject({
        content: ORIGINAL,
        status: {
          editable: false,
          hasDraft: true,
          conflict: 'RECOVERY_INCONSISTENT',
        },
      });
    }
  });

  it.runIf(process.platform === 'win32')(
    'syncs through the real ContentHandle when a managed imported file is read-only',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'html-agent-managed-sync-'));
      const workspace = join(root, 'project');
      const sourcePath = join(
        workspace,
        '.learning-companion',
        'assets',
        'imported',
        'lesson.html',
      );
      try {
        await mkdir(dirname(sourcePath), { recursive: true });
        await writeFile(sourcePath, ORIGINAL);
        await chmod(sourcePath, 0o400);
        const ref = createProjectWorkspaceContentRef(
          '.learning-companion/assets/imported/lesson.html',
        );
        const resolver = new LocalFileContentResolver({
          resolveLocalFile: async () => sourcePath,
        } as never);
        const snapshots = new Map([['task-1', task('task-1')]]);
        const service = new HtmlAgentEditingService(
          {
            getActiveProjectId: () => 'project-1',
            get: () => ({
              id: 'asset-1',
              projectId: 'project-1',
              mediaType: 'text/html',
              contentRef: ref,
            }),
            resolveContent: () =>
              resolver.resolve(ref, {
                projectId: 'project-1',
                projectWorkspace: workspace,
              }),
          } as never,
          { get: (taskId: string) => snapshots.get(taskId) } as never,
        );
        const edit = (await service.begin(
          {
            locator: { kind: 'selector', selector: '#target' },
            scope: 'contents',
          },
          context('task-1'),
        )) as { readonly editId: string };
        await service.replace(edit.editId, 'B', context('task-1'));
        const completed = task('task-1', 'completed');
        snapshots.set('task-1', completed);
        await service.handleTaskSnapshot(completed as never);

        await expect(
          service.requestSync('project-1', 'asset-1'),
        ).resolves.toMatchObject({ disposition: 'synced' });
        await expect(readFile(sourcePath, 'utf8')).resolves.toContain('>B<');
      } finally {
        await chmod(sourcePath, 0o600).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
