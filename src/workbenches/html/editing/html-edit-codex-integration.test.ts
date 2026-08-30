import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentFunctionToolRegistry } from '../../../main/agents/function-tools/agent-function-tool-registry';
import {
  CODEX_FUNCTION_TOOL_NAMESPACE,
  handleCodexGenerationServerRequest,
  resolveCodexGenerationTools,
} from '../../../main/agents/providers/codex-function-tools';
import type { ContentHandle } from '../../../main/content/content-handle';
import { createTextRevision } from '../../../main/content/text-content';
import { GenerationAssetReferencePreparer } from '../../../main/generation/preparation/generation-asset-reference-preparer';
import { WorkbenchEventBus } from '../../../main/workbench/workbench-event-bus';
import { WorkbenchRegistry } from '../../../main/workbench/workbench-registry';
import type { WorkbenchEvent } from '../../../shared/workbench/protocol';
import { HtmlWorkbenchProvider } from '../main';
import { htmlEditEvents } from '../shared';
import { UnsupportedWorkbenchProvider } from '../../unsupported/main';
import { HtmlAgentEditingService } from './html-agent-editing-service';
import { createHtmlEditFunctionTools } from './html-edit-function-tools';
import {
  HTML_BEGIN_EDIT_TOOL_ID,
  HTML_REPLACE_EDIT_TOOL_ID,
} from './html-edit-tool-contracts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function toolEvent(tool: string, argumentsValue: unknown, requestId: string) {
  return {
    type: 'server-request' as const,
    threadId: 'thread-1',
    turnId: 'turn-1',
    request: {
      requestId,
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: `call-${requestId}`,
        namespace: CODEX_FUNCTION_TOOL_NAMESPACE,
        tool,
        arguments: argumentsValue,
      },
    },
  };
}

function successfulToolResult(respond: ReturnType<typeof vi.fn>): unknown {
  const response = respond.mock.calls.at(-1)?.[1] as
    | {
        result?: {
          success?: boolean;
          contentItems?: Array<{ text?: string }>;
        };
      }
    | undefined;
  expect(response?.result?.success).toBe(true);
  return JSON.parse(response?.result?.contentItems?.[0]?.text ?? 'null');
}

describe('HTML editing through Codex dynamic tools', () => {
  it('edits only the draft and settles one native Provider turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'html-edit-codex-'));
    roots.push(root);
    const original = '<html><body><p>A</p></body></html>';
    const originalRevision = createTextRevision(
      new TextEncoder().encode(original),
    );
    const sourcePath = join(root, 'lesson.html');
    await writeFile(sourcePath, original);
    const writeBytes = vi.fn<NonNullable<ContentHandle['writeBytes']>>();
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
          stream: new ReadableStream<Uint8Array>({
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
      get: () => ({
        id: 'asset-1',
        projectId: 'project-1',
        name: 'lesson.html',
        mediaType: 'text/html',
        creationKind: 'imported',
        contentRef: {
          kind: 'local-file',
          base: 'absolute',
          path: sourcePath,
        },
        contentStatus: { availability: 'available', checkedTime: 1 },
        createdTime: 1,
        updatedTime: 1,
      }),
      resolveContent: vi.fn(async () => ({
        contentRef: {
          kind: 'local-file',
          base: 'absolute',
          path: sourcePath,
        },
        contentStatus: { availability: 'available', checkedTime: 1 },
        location: { kind: 'local-file', absolutePath: sourcePath },
        handle,
      })),
    };
    const service = new HtmlAgentEditingService(root, assets as never);
    const eventBus = new WorkbenchEventBus();
    const workbenchEvents: WorkbenchEvent[] = [];
    eventBus.subscribe((event) => workbenchEvents.push(event));
    const provider = new HtmlWorkbenchProvider(
      {
        register: () => 'learning-content://resource/token',
        revokeSession: vi.fn(),
      } as never,
      { executeJavaScript: vi.fn() },
      service,
      eventBus,
    );
    await provider.open({
      sessionId: 'workbench-session-1',
      asset: {
        id: 'asset-1',
        projectId: 'project-1',
        mediaType: 'text/html',
      },
      selectionReason: 'matched',
      content: {
        contentStatus: { availability: 'available', checkedTime: 1 },
        handle,
      },
      attachments: [],
    } as never);
    const workbenches = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
    );
    workbenches.register(provider);
    const referencePreparer = new GenerationAssetReferencePreparer(
      assets as never,
      workbenches,
    );
    const followUpWorkspace = join(root, 'follow-up-workspace');
    const referenceRequest = {
      projectId: 'project-1',
      schema: { source: { required: true, cardinality: 'one' as const } },
      bindings: { source: [{ assetId: 'asset-1' }] },
      primaryWorkspacePath: followUpWorkspace,
    } as const;
    await referencePreparer.prepare(referenceRequest);
    const preparedSourcePath = join(
      followUpWorkspace,
      'references',
      'source-0001',
      'source.html',
    );
    await chmod(preparedSourcePath, 0o400);
    const registry = new AgentFunctionToolRegistry();
    for (const tool of createHtmlEditFunctionTools(service)) {
      registry.register(tool);
    }
    const workspaces = {
      primary: {
        key: 'html-conversation',
        instanceKey: 'conversation-1',
        path: resolve(root, 'workspace'),
        permissions: { read: true, write: false },
      },
      secondary: [],
    } as const;
    const selection = resolveCodexGenerationTools(
      {
        toolRequirements: [
          { id: HTML_BEGIN_EDIT_TOOL_ID, availability: 'required' },
          { id: HTML_REPLACE_EDIT_TOOL_ID, availability: 'required' },
        ],
        workspaces,
      },
      registry,
    );
    const generationRequest = {
      taskId: 'task-1',
      callKey: 'answer',
      projectId: 'project-1',
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
      workspaces,
    };
    const respond = vi.fn(async () => undefined);

    await handleCodexGenerationServerRequest({
      event: toolEvent(
        HTML_BEGIN_EDIT_TOOL_ID,
        {
          locator: { kind: 'selector', selector: 'p' },
          scope: 'contents',
        },
        'begin',
      ),
      expectedThreadId: 'thread-1',
      activeTurnId: 'turn-1',
      selection,
      generationRequest,
      respond,
    });
    const begun = successfulToolResult(respond) as { editId: string };
    expect(workbenchEvents).toEqual([
      expect.objectContaining({
        sessionId: 'workbench-session-1',
        type: htmlEditEvents.started,
      }),
    ]);

    await handleCodexGenerationServerRequest({
      event: toolEvent(
        HTML_REPLACE_EDIT_TOOL_ID,
        { editId: begun.editId, html: '<strong>B</strong>' },
        'replace',
      ),
      expectedThreadId: 'thread-1',
      activeTurnId: 'turn-1',
      selection,
      generationRequest,
      respond,
    });

    expect(successfulToolResult(respond)).toMatchObject({ applied: true });
    expect(workbenchEvents.map((event) => event.type)).toEqual([
      htmlEditEvents.started,
      htmlEditEvents.applied,
    ]);
    expect(await service.getDraft('project-1', 'asset-1')).toContain(
      '<p><strong>B</strong></p>',
    );
    await referencePreparer.prepare(referenceRequest);
    await expect(readFile(preparedSourcePath, 'utf8')).resolves.toContain(
      '<p><strong>B</strong></p>',
    );
    expect(original).toContain('<p>A</p>');
    expect(writeBytes).not.toHaveBeenCalled();

    await service.handleTaskSnapshot({
      id: 'task-1',
      projectId: 'project-1',
      completed: { completedTime: 2, result: {} },
      agentCalls: [{ callKey: 'answer', providerExecutionId: 'turn-1' }],
    } as never);
    await expect(service.review('project-1', 'asset-1')).resolves.toMatchObject({
      entries: [{ executionId: 'turn-1' }],
      pendingChanges: [],
    });
  });
});
