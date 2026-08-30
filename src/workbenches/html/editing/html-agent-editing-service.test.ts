import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentFunctionToolExecutionContext } from '../../../main/agents/function-tools/agent-function-tool';
import { createTextRevision } from '../../../main/content/text-content';
import type { ContentHandle } from '../../../main/content/content-handle';
import { createProjectWorkspaceContentRef } from '../../../main/content/content-ref';
import { LocalFileContentResolver } from '../../../main/content/resolvers/local-file/local-file-content-resolver';
import { HtmlEditError } from './html-document-parser';
import { HtmlAgentEditingService } from './html-agent-editing-service';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'html-agent-editing-'));
  roots.push(root);
  let original = '<html><body><p>A</p></body></html>';
  let originalRevision = createTextRevision(new TextEncoder().encode(original));
  const writeBytes = vi.fn<NonNullable<ContentHandle['writeBytes']>>(
    async ({ content, expectedRevision }) => {
      if (expectedRevision !== originalRevision) {
        throw new Error('revision mismatch');
      }
      original = new TextDecoder().decode(content);
      originalRevision = createTextRevision(content);
      return { revision: originalRevision };
    },
  );
  const handle: ContentHandle = {
    capabilities: new Set(['read-bytes', 'read-stream', 'write-bytes']),
    async readBytes() {
      return {
        content: new TextEncoder().encode(original),
        revision: originalRevision,
      };
    },
    async openByteStream() {
      const content = new TextEncoder().encode(original);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        }),
        byteLength: content.length,
        revision: originalRevision,
      };
    },
    writeBytes,
    close: vi.fn(async () => undefined),
  };
  const assets = {
    getActiveProjectId: () => 'project-1',
    get: (assetId: string) =>
      assetId === 'asset-1'
        ? {
            id: 'asset-1',
            projectId: 'project-1',
            mediaType: 'text/html',
          }
        : undefined,
    resolveContent: vi.fn(async () => ({
      contentStatus: { availability: 'available', checkedTime: 1 },
      handle,
    })),
  };
  const service = new HtmlAgentEditingService(root, assets as never);
  const context: AgentFunctionToolExecutionContext = {
    taskId: 'task-1',
    callKey: 'answer',
    projectId: 'project-1',
    executionId: 'turn-1',
    assetReferences: {
      source: [
        {
          alias: 'source-0001',
          assetId: 'asset-1',
          name: 'lesson.html',
          mediaType: 'text/html',
          materializedMediaType: 'text/html',
          contentRevision: originalRevision,
          relativePath: 'references/source-0001/source.html',
        },
      ],
    },
    workspaces: {} as never,
  };
  return {
    root,
    assets,
    service,
    context,
    writeBytes,
    handle,
    changeOriginal(content: string) {
      original = content;
      originalRevision = createTextRevision(
        new TextEncoder().encode(content),
      );
    },
    original: () => original,
  };
}

async function beginParagraph(
  service: HtmlAgentEditingService,
  context: AgentFunctionToolExecutionContext,
) {
  return service.begin(
    {
      locator: { kind: 'selector', selector: 'p' },
      scope: 'contents',
    },
    context,
  );
}

describe('HtmlAgentEditingService', () => {
  it('does not create a recovery draft while only reading preview state', async () => {
    const { service } = await harness();

    await expect(service.getDraft('project-1', 'asset-1')).resolves.toBeUndefined();
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects cross-project references and reports read-only Assets as non-editable', async () => {
    const { service, context, handle } = await harness();
    await expect(
      beginParagraph(service, { ...context, projectId: 'project-2' }),
    ).rejects.toThrow('AssetReference 已失效');

    (handle as { writeBytes?: ContentHandle['writeBytes'] }).writeBytes =
      undefined;
    await expect(service.canEdit('project-1', 'asset-1')).resolves.toBe(false);
  });

  it('writes only the recovery draft and commits one Provider execution', async () => {
    const { service, context, writeBytes, original } = await harness();
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));

    const begun = await beginParagraph(service, context);
    const result = await service.replace(begun.editId, '<strong>B</strong>', context);

    expect(result.applied).toBe(true);
    expect(await service.getDraft('project-1', 'asset-1')).toContain(
      '<p><strong>B</strong></p>',
    );
    expect(original()).toContain('<p>A</p>');
    expect(writeBytes).not.toHaveBeenCalled();
    expect(events).toEqual(['started', 'applied']);

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [
        {
          callKey: 'answer',
          purpose: 'html-reading-conversation',
          completedTime: 1,
          sessionId: 'session-1',
          providerExecutionId: 'turn-1',
        },
      ],
    } as never);
    const review = await service.review('project-1', 'asset-1');
    expect(review.entries).toHaveLength(1);
    expect(review.entries[0].changes).toHaveLength(1);
  });

  it('keeps editId after an unclosed replacement so the Agent can retry', async () => {
    const { service, context } = await harness();
    const begun = await beginParagraph(service, context);

    await expect(
      service.replace(begun.editId, '<strong>broken', context),
    ).rejects.toBeInstanceOf(HtmlEditError);
    await expect(
      service.replace(begun.editId, '<strong>fixed</strong>', context),
    ).resolves.toMatchObject({ applied: true });
  });

  it('ends a begun target without refreshing when the turn completes without replace', async () => {
    const { service, context } = await harness();
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));
    await beginParagraph(service, context);

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    expect(events).toEqual(['started', 'ended']);
    expect(events).not.toContain('applied');
  });

  it('ends an abandoned begin before the same call starts a new execution', async () => {
    const { service, context } = await harness();
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));
    await beginParagraph(service, context);

    await expect(
      beginParagraph(service, { ...context, executionId: 'turn-2' }),
    ).resolves.toMatchObject({ currentHtml: 'A' });

    expect(events).toEqual(['started', 'ended', 'started']);
  });

  it('rolls back all draft changes when the GenerationTask fails', async () => {
    const { service, context } = await harness();
    const first = await beginParagraph(service, context);
    await service.replace(first.editId, 'B', context);
    const second = await beginParagraph(service, context);
    await service.replace(second.editId, 'C', context);

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      failure: { phase: 'process' },
      agentCalls: [],
    } as never);

    expect(await service.getDraft('project-1', 'asset-1')).toContain('<p>A</p>');
    expect((await service.review('project-1', 'asset-1')).entries).toHaveLength(0);
  });

  it('queues sync during a pending turn and writes only after settle', async () => {
    const { service, context, writeBytes, original } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);

    await expect(service.requestSync('project-1', 'asset-1')).resolves.toMatchObject({
      disposition: 'queued',
    });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(original()).toContain('<p>A</p>');

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [
        {
          callKey: 'answer',
          providerExecutionId: 'turn-1',
        },
      ],
    } as never);
    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(original()).toContain('<p>B</p>');
    expect(await service.getDraft('project-1', 'asset-1')).toContain('<p>B</p>');
  });

  it('queues sync during an active edit and writes the replacement after settle', async () => {
    const { service, context, writeBytes, original } = await harness();
    const first = await beginParagraph(service, context);
    await service.replace(first.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    const nextContext = {
      ...context,
      taskId: 'task-2',
      executionId: 'turn-2',
    };
    const active = await beginParagraph(service, nextContext);

    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).resolves.toMatchObject({ disposition: 'queued' });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(original()).toContain('<p>A</p>');

    await service.replace(active.editId, 'C', nextContext);
    await service.handleTaskSnapshot({
      id: 'task-2',
      projectId: 'project-1',
      completed: { completedTime: 3, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-2' }],
    } as never);

    expect(writeBytes).toHaveBeenCalledOnce();
    expect(original()).toContain('<p>C</p>');
  });

  it('finishes queued sync when an active edit ends before replace', async () => {
    const { service, context, writeBytes, original } = await harness();
    const first = await beginParagraph(service, context);
    await service.replace(first.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    const nextContext = {
      ...context,
      taskId: 'task-2',
      executionId: 'turn-2',
    };
    await beginParagraph(service, nextContext);
    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).resolves.toMatchObject({ disposition: 'queued' });

    await service.handleTaskSnapshot({
      id: 'task-2',
      projectId: 'project-1',
      failure: { phase: 'process' },
      agentCalls: [],
    } as never);

    expect(writeBytes).toHaveBeenCalledOnce();
    expect(original()).toContain('<p>B</p>');
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { unsynced: false, syncRequested: false },
    });
  });

  it.runIf(process.platform === 'win32')(
    'syncs a draft through the real managed local-file ContentHandle when the imported copy is read-only',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'html-agent-managed-sync-'));
      roots.push(root);
      const workspace = join(root, 'project');
      const sourcePath = join(
        workspace,
        '.learning-companion',
        'assets',
        'imported',
        'lesson.html',
      );
      await mkdir(
        join(workspace, '.learning-companion', 'assets', 'imported'),
        { recursive: true },
      );
      await writeFile(sourcePath, '<html><body><p>A</p></body></html>');
      await chmod(sourcePath, 0o400);
      const ref = createProjectWorkspaceContentRef(
        '.learning-companion/assets/imported/lesson.html',
      );
      const resolver = new LocalFileContentResolver({
        resolveLocalFile: async () => sourcePath,
      } as never);
      const assets = {
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
      };
      const service = new HtmlAgentEditingService(
        join(root, 'recovery'),
        assets as never,
      );
      const context = {
        taskId: 'task-1',
        callKey: 'answer',
        projectId: 'project-1',
        executionId: 'turn-1',
        assetReferences: {
          source: [
            {
              alias: 'source-0001',
              assetId: 'asset-1',
              name: 'lesson.html',
              mediaType: 'text/html',
              materializedMediaType: 'text/html',
              contentRevision: 'prepared',
              relativePath: 'references/source-0001/source.html',
            },
          ],
        },
        workspaces: {} as never,
      } as AgentFunctionToolExecutionContext;

      const begun = await beginParagraph(service, context);
      await service.replace(begun.editId, 'B', context);
      await service.handleTaskSnapshot({
        id: 'task-1',
        projectId: 'project-1',
        completed: { completedTime: 2, result: {} },
        agentCalls: [
          { callKey: 'answer', providerExecutionId: 'turn-1' },
        ],
      } as never);

      await expect(
        service.requestSync('project-1', 'asset-1'),
      ).resolves.toMatchObject({ disposition: 'ready' });
      await expect(readFile(sourcePath, 'utf8')).resolves.toContain('<p>B</p>');
    },
  );

  it('does not overwrite an externally changed source during sync', async () => {
    const { service, context, writeBytes, changeOriginal } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);
    changeOriginal('<html><body><p>external</p></body></html>');

    await expect(
      service.requestSync('project-1', 'asset-1'),
    ).rejects.toMatchObject({ code: 'CONTENT_CHANGED_EXTERNALLY' });
    expect(writeBytes).not.toHaveBeenCalled();
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      content: expect.stringContaining('<p>B</p>'),
      status: { editable: false, conflict: 'SOURCE_REVISION_MISMATCH' },
    });
  });

  it('recovers a sync that wrote the source before persisting its manifest', async () => {
    const { root, assets, service, context, changeOriginal } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    const draft = await service.getDraft('project-1', 'asset-1');
    const recoveryRoot = join(root, 'html-agent-editing');
    const [sessionDirectory] = await readdir(recoveryRoot);
    const manifestPath = join(recoveryRoot, sessionDirectory!, 'session.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, syncRequested: true }, null, 2)}\n`,
    );
    changeOriginal(draft!);
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      content: draft,
      status: {
        editable: true,
        unsynced: false,
        syncRequested: false,
        conflict: null,
      },
    });
  });

  it('resumes a persisted sync intent after restart before the source write', async () => {
    const { root, assets, service, context, original } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    const recoveryRoot = join(root, 'html-agent-editing');
    const [sessionDirectory] = await readdir(recoveryRoot);
    const manifestPath = join(recoveryRoot, sessionDirectory!, 'session.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, syncRequested: true }, null, 2)}\n`,
    );
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
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
    expect(original()).toContain('<p>B</p>');
  });

  it('fails closed when the completed checkpoint identity does not match', async () => {
    const { service, context, writeBytes } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [
        { callKey: 'answer', providerExecutionId: 'different-turn' },
      ],
    } as never);

    expect(writeBytes).not.toHaveBeenCalled();
    await expect(service.undo('project-1', 'asset-1')).rejects.toThrow(
      '恢复冲突',
    );
  });

  it('restores and settles a completed pending turn after restart', async () => {
    const { root, assets, service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
    restored.attachGenerationTasks({
      get: () =>
        ({
          id: 'task-1',
          projectId: 'project-1',
          completed: { completedTime: 2, result: {} },
          agentCalls: [
            { callKey: 'answer', providerExecutionId: 'turn-1' },
          ],
        }) as never,
    });

    await expect(restored.getDraft('project-1', 'asset-1')).resolves.toContain(
      '<p>B</p>',
    );
    await expect(restored.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [{ executionId: 'turn-1' }],
      pendingChanges: [],
    });
  });

  it('restores and rolls back a failed pending turn after restart', async () => {
    const { root, assets, service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
    restored.attachGenerationTasks({
      get: () =>
        ({
          id: 'task-1',
          projectId: 'project-1',
          failure: { phase: 'process' },
          agentCalls: [],
        }) as never,
    });

    await expect(restored.getDraft('project-1', 'asset-1')).resolves.toContain(
      '<p>A</p>',
    );
    await expect(restored.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [],
      pendingChanges: [],
    });
  });

  it('marks recovery conflict when a pending task no longer exists', async () => {
    const { root, assets, service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
    restored.attachGenerationTasks({ get: () => undefined });

    await expect(
      restored.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toMatchObject({
      status: { editable: false, conflict: 'RECOVERY_INCONSISTENT' },
    });
  });

  it('surfaces a damaged recovery manifest instead of hiding the draft', async () => {
    const { root, assets, service, context } = await harness();
    await beginParagraph(service, context);
    const recoveryRoot = join(root, 'html-agent-editing');
    const [sessionDirectory] = await readdir(recoveryRoot);
    await writeFile(
      join(recoveryRoot, sessionDirectory!, 'session.json'),
      '{invalid json',
    );
    service.dispose();

    const restored = new HtmlAgentEditingService(root, assets as never);
    await expect(
      restored.getDraft('project-1', 'asset-1'),
    ).rejects.toThrow('session JSON 损坏');
  });

  it('rolls back an abandoned execution before the same call begins again', async () => {
    const { service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    const retriedContext = { ...context, executionId: 'turn-2' };

    const retried = await beginParagraph(service, retriedContext);

    expect(retried.currentHtml).toBe('A');
    await expect(
      service.replace(retried.editId, 'C', retriedContext),
    ).resolves.toMatchObject({ applied: true });
    await expect(service.getDraft('project-1', 'asset-1')).resolves.toContain(
      '<p>C</p>',
    );
  });

  it('does not recreate a discarded draft during later preview reads', async () => {
    const { service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    await service.discard('project-1', 'asset-1');

    await expect(service.getDraft('project-1', 'asset-1')).resolves.toBeUndefined();
    await expect(
      service.getDraftSnapshot('project-1', 'asset-1'),
    ).resolves.toBeUndefined();
  });

  it('counts only currently applied history after undo', async () => {
    const { service, context } = await harness();
    const begun = await beginParagraph(service, context);
    await service.replace(begun.editId, 'B', context);
    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);

    await expect(service.undo('project-1', 'asset-1')).resolves.toMatchObject({
      stepCount: 0,
      changeCount: 0,
      canRedo: true,
    });
  });
});
