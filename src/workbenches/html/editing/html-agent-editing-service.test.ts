import { readFile, unlink } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { AgentFunctionToolExecutionContext } from '../../../main/agents/function-tools/agent-function-tool';
import { createTextRevision } from '../../../main/content/text-content';
import type { WorkbenchStateDataRecord } from '../../../main/workbench/workbench-state-data-database';
import { HtmlAgentEditingService } from './html-agent-editing-service';

function toolContext(taskId: string): AgentFunctionToolExecutionContext {
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
  completed = false,
  assetId = 'asset-1',
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
      assetId,
      conversationId: 'conversation-1',
      question: '修改标题',
    },
    assetReferences: { source: [{ assetId }] },
    prepared: {
      completedTime: 2,
      assetReferences: {
        source: [
          {
            alias: 'source-0001',
            assetId,
            name: 'lesson.html',
            mediaType: 'text/html',
            materializedMediaType: 'text/html',
            contentRevision: 'source-revision',
            relativePath: 'references/source-0001/source.html',
          },
        ],
      },
      workspaces: {
        primary: toolContext(taskId).workspaces.primary,
        secondary: [],
      },
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
    ...(completed ? { completed: { completedTime: 4, result: {} } } : {}),
    createdTime: 1,
    updatedTime: completed ? 4 : 2,
  };
}

describe('HtmlAgentEditingService Workbench persistence', () => {
  it('restores the draft and groups a completed GenerationTask as one history step', async () => {
    const original = '<!doctype html><html><body><h1 id="title">Before</h1></body></html>';
    const originalBytes = new TextEncoder().encode(original);
    const writeBytes = vi.fn();
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
            content: originalBytes,
            revision: createTextRevision(originalBytes),
          })),
          writeBytes,
          close: vi.fn(async () => undefined),
        },
      })),
    };
    const snapshots = new Map([
      ['task-1', task('task-1')],
      ['task-2', task('task-2')],
    ]);
    const generationTasks = {
      get: (taskId: string) => snapshots.get(taskId),
    };
    const data = new Map<string, WorkbenchStateDataRecord>();
    const stateDataDatabase = {
      get: vi.fn(async (assetId: string) => data.get(assetId)),
      save: vi.fn(async (record: WorkbenchStateDataRecord) => {
        data.set(record.assetId, structuredClone(record));
      }),
      delete: vi.fn(async (assetId: string) => {
        data.delete(assetId);
      }),
    };

    const first = new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase,
    );
    const begun = (await first.begin(
      {
        locator: { kind: 'selector', selector: '#title' },
        scope: 'contents',
      },
      toolContext('task-1'),
    )) as { editId: string };

    await expect(
      first.replace(
        begun.editId,
        '<span>After</span>',
        toolContext('task-1'),
      ),
    ).resolves.toMatchObject({ applied: true });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(stateDataDatabase.save).toHaveBeenCalled();

    snapshots.set('task-1', task('task-1', true));
    const restored = new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase,
    );
    const next = await restored.begin(
      {
        locator: { kind: 'selector', selector: '#title' },
        scope: 'contents',
      },
      toolContext('task-2'),
    );

    expect(next).toMatchObject({ currentHtml: '<span>After</span>' });
    await expect(restored.review('project-1', 'asset-1')).resolves.toMatchObject(
      {
        entries: [{ taskId: 'task-1' }],
      },
    );
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it('marks a restored draft with inconsistent content and revision as conflicted', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const data = new Map<string, WorkbenchStateDataRecord>();
    const stateDataDatabase = {
      get: vi.fn(async (assetId: string) => data.get(assetId)),
      save: vi.fn(async (record: WorkbenchStateDataRecord) => {
        data.set(record.assetId, structuredClone(record));
      }),
      delete: vi.fn(async (assetId: string) => {
        data.delete(assetId);
      }),
    };
    const assets = {
      getActiveProjectId: () => 'project-1',
      get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
      resolveContent: vi.fn(async () => ({
        contentStatus: { availability: 'available', checkedTime: 1 },
        handle: {
          capabilities: new Set(['read-bytes', 'write-bytes']),
          readBytes: vi.fn(async () => ({
            content: bytes,
            revision: createTextRevision(bytes),
          })),
          writeBytes: vi.fn(),
          close: vi.fn(async () => undefined),
        },
      })),
    };
    const generationTasks = { get: () => task('task-1') };
    const first = new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase,
    );
    const begun = (await first.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await first.replace(begun.editId, 'Draft', toolContext('task-1'));

    const record = data.get('asset-1')!;
    const corrupted = JSON.parse(new TextDecoder().decode(record.data)) as {
      draft: string;
    };
    corrupted.draft += '<!-- corrupted -->';
    data.set('asset-1', {
      ...record,
      data: new TextEncoder().encode(JSON.stringify(corrupted)),
    });

    const restored = new HtmlAgentEditingService(
      assets as never,
      generationTasks as never,
      stateDataDatabase,
    );
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        conflict: 'RECOVERY_INCONSISTENT',
        editable: false,
      },
    });
  });

  it('rejects an unclosed replacement without consuming the edit', async () => {
    const original = '<!doctype html><html><body><div id="target">Before</div></body></html>';
    const bytes = new TextEncoder().encode(original);
    const service = new HtmlAgentEditingService(
      {
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
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: () => task('task-1') } as never,
    );
    const begun = (await service.begin(
      {
        locator: { kind: 'selector', selector: '#target' },
        scope: 'contents',
      },
      toolContext('task-1'),
    )) as { editId: string };

    await expect(
      service.replace(
        begun.editId,
        '<span>broken',
        toolContext('task-1'),
      ),
    ).rejects.toThrow(/未闭合/u);
    await expect(
      service.replace(
        begun.editId,
        '<span>Closed</span>',
        toolContext('task-1'),
      ),
    ).resolves.toMatchObject({ applied: true });
    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject(
      {
        pendingChanges: [{ before: 'Before', after: '<span>Closed</span>' }],
      },
    );
  });

  it('allows only one active begin transaction per HTML Asset', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const snapshots = new Map([
      ['task-1', task('task-1')],
      ['task-2', task('task-2')],
    ]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );

    await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    );
    await expect(service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-2'),
    )).rejects.toThrow(/已有未完成/u);
  });

  it('isolates concurrent edits and drafts across HTML Assets', async () => {
    const sources = new Map([
      ['asset-1', '<html><body><p id="target">First</p></body></html>'],
      ['asset-2', '<html><body><p id="target">Second</p></body></html>'],
    ]);
    const snapshots = new Map([
      ['task-1', task('task-1', false, 'asset-1')],
      ['task-2', task('task-2', false, 'asset-2')],
    ]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: (assetId: string) =>
          sources.has(assetId)
            ? { id: assetId, projectId: 'project-1', mediaType: 'text/html' }
            : undefined,
        resolveContent: vi.fn(async (assetId: string) => {
          const content = new TextEncoder().encode(sources.get(assetId)!);
          return {
            contentStatus: { availability: 'available', checkedTime: 1 },
            handle: {
              capabilities: new Set(['read-bytes', 'write-bytes']),
              readBytes: vi.fn(async () => ({
                content,
                revision: createTextRevision(content),
              })),
              writeBytes: vi.fn(),
              close: vi.fn(async () => undefined),
            },
          };
        }),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );

    const first = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    const second = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-2'),
    )) as { editId: string };
    await service.replace(first.editId, 'First updated', toolContext('task-1'));
    await service.replace(second.editId, 'Second updated', toolContext('task-2'));

    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject({
      pendingChanges: [{ before: 'First', after: 'First updated' }],
    });
    await expect(service.review('project-1', 'asset-2')).resolves.toMatchObject({
      pendingChanges: [{ before: 'Second', after: 'Second updated' }],
    });
  });

  it('projects only currently applied task steps into review and status', async () => {
    const original =
      '<!doctype html><html><body><p id="first">A</p><p id="second">B</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
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
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );

    for (const [selector, replacement] of [
      ['#first', 'AA'],
      ['#second', 'BB'],
    ] as const) {
      const begun = (await service.begin(
        { locator: { kind: 'selector', selector }, scope: 'contents' },
        toolContext('task-1'),
      )) as { editId: string };
      await service.replace(
        begun.editId,
        replacement,
        toolContext('task-1'),
      );
    }

    snapshots.set('task-1', task('task-1', true));
    await service.handleTaskSnapshot(task('task-1', true) as never);
    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject(
      {
        entries: [{ taskId: 'task-1', changes: [{ after: 'AA' }, { after: 'BB' }] }],
        pendingChanges: [],
      },
    );

    await service.undo('project-1', 'asset-1');
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toBe(
      original,
    );
    await expect(service.review('project-1', 'asset-1')).resolves.toEqual({
      entries: [],
      pendingChanges: [],
    });
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: {
        stepCount: 0,
        changeCount: 0,
        canUndo: false,
        canRedo: true,
      },
    });
    await service.redo('project-1', 'asset-1');
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toContain(
      '<p id="first">AA</p><p id="second">BB</p>',
    );
  });

  it('keeps exactly the latest twenty completed Agent turns', async () => {
    const original = '<html><body><p id="target">v0</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const snapshots = new Map(
      Array.from({ length: 22 }, (_, index) => {
        const taskId = `task-${index + 1}`;
        return [taskId, task(taskId)] as const;
      }),
    );
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );

    for (let index = 1; index <= 22; index += 1) {
      const taskId = `task-${index}`;
      const begun = (await service.begin(
        { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
        toolContext(taskId),
      )) as { editId: string };
      await service.replace(begun.editId, `v${index}`, toolContext(taskId));
      const completed = task(taskId, true);
      snapshots.set(taskId, completed);
      await service.handleTaskSnapshot(completed as never);
    }

    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [
        { taskId: 'task-3' },
        ...Array.from({ length: 18 }, () => ({})),
        { taskId: 'task-22' },
      ],
    });
    for (let index = 0; index < 20; index += 1) {
      await service.undo('project-1', 'asset-1');
    }
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toContain(
      '<p id="target">v2</p>',
    );
    await expect(service.undo('project-1', 'asset-1')).rejects.toThrow(
      /没有可撤销/u,
    );
  });

  it('queues sync until the task settles and writes only the stable draft', async () => {
    const original = '<!doctype html><html><body><h1 id="title">Before</h1></body></html>';
    const bytes = new TextEncoder().encode(original);
    const sourceRevision = createTextRevision(bytes);
    const writeBytes = vi.fn(async ({ content }: { content: Uint8Array }) => ({
      revision: createTextRevision(content),
    }));
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({ content: bytes, revision: sourceRevision })),
            writeBytes,
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#title' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'After', toolContext('task-1'));

    await expect(service.requestSync('project-1', 'asset-1')).resolves.toMatchObject({
      disposition: 'queued',
    });
    expect(writeBytes).not.toHaveBeenCalled();

    snapshots.set('task-1', task('task-1', true));
    await service.handleTaskSnapshot(task('task-1', true) as never);

    expect(writeBytes).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(writeBytes.mock.calls[0]![0].content)).toContain(
      '<h1 id="title">After</h1>',
    );
  });

  it('serializes replace and sync for the same Asset', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const writeBytes = vi.fn(async ({ content }: { content: Uint8Array }) => ({
      revision: createTextRevision(content),
    }));
    const data = new Map<string, WorkbenchStateDataRecord>();
    let blockNextDataSave = false;
    let releaseDataSave: (() => void) | undefined;
    let notifyDataSaveStarted: (() => void) | undefined;
    const dataSaveStarted = new Promise<void>((resolve) => {
      notifyDataSaveStarted = resolve;
    });
    const stateDataDatabase = {
      get: vi.fn(async (assetId: string) => data.get(assetId)),
      save: vi.fn(async (record: WorkbenchStateDataRecord) => {
        if (blockNextDataSave) {
          blockNextDataSave = false;
          notifyDataSaveStarted?.();
          await new Promise<void>((resolve) => {
            releaseDataSave = resolve;
          });
        }
        data.set(record.assetId, structuredClone(record));
      }),
      delete: vi.fn(async (assetId: string) => {
        data.delete(assetId);
      }),
    };
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes,
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
      stateDataDatabase,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };

    blockNextDataSave = true;
    const replacement = service.replace(
      begun.editId,
      'After',
      toolContext('task-1'),
    );
    await dataSaveStarted;
    const sync = service.requestSync('project-1', 'asset-1');
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseDataSave?.();

    await expect(replacement).resolves.toMatchObject({ applied: true });
    await expect(sync).resolves.toMatchObject({ disposition: 'queued' });
    expect(writeBytes).not.toHaveBeenCalled();
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      content: expect.stringContaining('>After<'),
      status: { pending: true, syncRequested: true },
    });

    const completed = task('task-1', true);
    snapshots.set('task-1', completed);
    await Promise.all([
      service.handleTaskSnapshot(completed as never),
      service.handleTaskSnapshot(completed as never),
    ]);

    expect(writeBytes).toHaveBeenCalledOnce();
    expect(
      new TextDecoder().decode(writeBytes.mock.calls[0]![0].content),
    ).toContain('>After<');
    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [{ taskId: 'task-1' }],
      pendingChanges: [],
    });
  });

  it('keeps the draft and rejects sync after an external source change', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const originalBytes = new TextEncoder().encode(original);
    const externalBytes = new TextEncoder().encode(
      '<html><body><p id="target">External</p></body></html>',
    );
    let current = originalBytes;
    const writeBytes = vi.fn();
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: current,
              revision: createTextRevision(current),
            })),
            writeBytes,
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'Draft', toolContext('task-1'));
    snapshots.set('task-1', task('task-1', true));
    await service.handleTaskSnapshot(task('task-1', true) as never);
    current = externalBytes;

    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
    expect(writeBytes).not.toHaveBeenCalled();
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toContain(
      '>Draft<',
    );
  });

  it('settles duplicate and out-of-order terminal events idempotently', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    let listener:
      | ((event: { type: string; snapshot?: unknown }) => void)
      | undefined;
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      {
        get: (taskId: string) => snapshots.get(taskId),
        subscribe: (next: typeof listener) => {
          listener = next;
          return () => undefined;
        },
      } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'After', toolContext('task-1'));
    snapshots.set('task-1', task('task-1', true));

    const completed = task('task-1', true);
    listener?.({ type: 'task-completed', snapshot: completed });
    listener?.({ type: 'task-changed', snapshot: completed });
    listener?.({ type: 'task-completed', snapshot: completed });

    await vi.waitFor(async () => {
      await expect(service.review('project-1', 'asset-1')).resolves.toEqual({
        entries: [
          {
            taskId: 'task-1',
            changes: [{ before: 'Before', after: 'After' }],
          },
        ],
        pendingChanges: [],
      });
    });
  });

  it('materializes the current draft for the next GenerationTask reference', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: () => task('task-1') } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'Draft', toolContext('task-1'));

    const path = await service.materializeReference('project-1', 'asset-1');
    try {
      expect(path).toMatch(/\.html$/u);
      expect(await readFile(path!, 'utf8')).toContain('>Draft<');
    } finally {
      if (path) await unlink(path);
    }
  });

  it('materializes a readable source without exposing edit tools', async () => {
    const original = '<html><body><p>Read only</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({
          id: 'asset-1',
          projectId: 'project-1',
          mediaType: 'text/html',
        }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: () => undefined } as never,
    );

    const path = await service.materializeReference('project-1', 'asset-1');
    try {
      await expect(readFile(path, 'utf8')).resolves.toBe(original);
      await expect(service.canEdit('project-1', 'asset-1')).resolves.toBe(false);
    } finally {
      await unlink(path);
    }
  });

  it('refreshes the original before materializing when no draft exists', async () => {
    let source = new TextEncoder().encode(
      '<html><body><p>Before</p></body></html>',
    );
    const service = new HtmlAgentEditingService(
      {
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
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: () => undefined } as never,
    );
    await service.getDraftSnapshot('project-1', 'asset-1');
    source = new TextEncoder().encode(
      '<html><body><p>Externally updated</p></body></html>',
    );

    const path = await service.materializeReference('project-1', 'asset-1');
    try {
      await expect(readFile(path, 'utf8')).resolves.toContain(
        '>Externally updated<',
      );
    } finally {
      await unlink(path);
    }
  });

  it('removes the materialized cache and draft state when discarded', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const snapshots = new Map([['task-1', task('task-1')]]);
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({ id: 'asset-1', projectId: 'project-1', mediaType: 'text/html' }),
        resolveContent: vi.fn(async () => ({
          contentStatus: { availability: 'available', checkedTime: 1 },
          handle: {
            capabilities: new Set(['read-bytes', 'write-bytes']),
            readBytes: vi.fn(async () => ({
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: (taskId: string) => snapshots.get(taskId) } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'Draft', toolContext('task-1'));
    const completed = task('task-1', true);
    snapshots.set('task-1', completed);
    await service.handleTaskSnapshot(completed as never);
    const path = await service.materializeReference('project-1', 'asset-1');

    await service.discard('project-1', 'asset-1');

    await expect(readFile(path!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toBeUndefined();
    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [],
      pendingChanges: [],
    });
  });

  it('rolls back the whole pending step when its GenerationTask is cancelled', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const service = new HtmlAgentEditingService(
      {
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
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      { get: () => task('task-1') } as never,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'Draft', toolContext('task-1'));

    await service.handleTaskSnapshot({
      ...task('task-1'),
      cancelledTime: 3,
      updatedTime: 3,
    } as never);

    await expect(service.getDraft('project-1', 'asset-1')).resolves.toBeUndefined();
    await expect(service.review('project-1', 'asset-1')).resolves.toEqual({
      entries: [],
      pendingChanges: [],
    });
  });

  it('drains lifecycle persistence and removes materialized drafts on shutdown', async () => {
    const original = '<html><body><p id="target">Before</p></body></html>';
    const bytes = new TextEncoder().encode(original);
    const data = new Map<string, WorkbenchStateDataRecord>();
    let blockSave = false;
    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const stateDataDatabase = {
      get: vi.fn(async (assetId: string) => data.get(assetId)),
      save: vi.fn(async (record: WorkbenchStateDataRecord) => {
        if (blockSave) await saveGate;
        data.set(record.assetId, structuredClone(record));
      }),
      delete: vi.fn(async (assetId: string) => {
        data.delete(assetId);
      }),
    };
    let snapshot = task('task-1');
    let lifecycleListener: ((event: never) => void) | undefined;
    const unsubscribe = vi.fn();
    const service = new HtmlAgentEditingService(
      {
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
              content: bytes,
              revision: createTextRevision(bytes),
            })),
            writeBytes: vi.fn(),
            close: vi.fn(async () => undefined),
          },
        })),
      } as never,
      {
        get: () => snapshot,
        subscribe: vi.fn((listener: (event: never) => void) => {
          lifecycleListener = listener;
          return unsubscribe;
        }),
      } as never,
      stateDataDatabase,
    );
    const begun = (await service.begin(
      { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
      toolContext('task-1'),
    )) as { editId: string };
    await service.replace(begun.editId, 'Draft', toolContext('task-1'));
    const materializedPath = await service.materializeReference(
      'project-1',
      'asset-1',
    );
    await expect(readFile(materializedPath, 'utf8')).resolves.toContain('Draft');

    snapshot = task('task-1', true);
    blockSave = true;
    lifecycleListener?.({
      type: 'task-completed',
      snapshot,
      result: {},
    } as never);
    await vi.waitFor(() =>
      expect(stateDataDatabase.save).toHaveBeenCalledTimes(2),
    );
    let shutdownSettled = false;
    const shutdown = service.shutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();

    releaseSave!();
    await shutdown;
    await service.shutdown();
    await expect(readFile(materializedPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
    service.dispose();
    service.dispose();
  });

  it('rejects a tool context whose task belongs to another Project', async () => {
    const resolveContent = vi.fn();
    const service = new HtmlAgentEditingService(
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({
          id: 'asset-1',
          projectId: 'project-1',
          mediaType: 'text/html',
        }),
        resolveContent,
      } as never,
      {
        get: () => ({ ...task('task-1'), projectId: 'project-2' }),
      } as never,
    );

    await expect(
      service.begin(
        { locator: { kind: 'selector', selector: '#target' }, scope: 'contents' },
        toolContext('task-1'),
      ),
    ).rejects.toThrow('当前任务没有唯一有效的 HTML Asset');
    expect(resolveContent).not.toHaveBeenCalled();
  });
});
