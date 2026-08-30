import { describe, expect, it, vi } from 'vitest';

import { AgentFunctionToolRegistry } from '../../../main/agents/function-tools/agent-function-tool-registry';
import { createTextRevision } from '../../../main/content/text-content';
import { htmlMainWorkbenchContribution } from '../main-contribution';
import { htmlAssistantMainFeature, setHtmlEditToolRuntime } from './main';

describe('HTML assistant Main integration', () => {
  it('resolves the editable Asset from the GenerationTask using the existing tool context', async () => {
    const source = '<!doctype html><html><body><h1 id="title">Before</h1></body></html>';
    const bytes = new TextEncoder().encode(source);
    const generationTasks = {
      get: vi.fn(() => ({
        id: 'task-1',
        projectId: 'project-1',
        definitionId: 'builtin.workbench-conversation',
        instruction: {
          format: 'workbench-conversation',
          version: 1,
          contextProviderId: 'builtin.html.conversation',
          assetId: 'asset-1',
          conversationId: 'conversation-1',
          question: '修改标题',
        },
        prepared: {
          assetReferences: {
            source: [
              {
                assetId: 'asset-1',
                mediaType: 'text/html',
                materializedMediaType: 'text/html',
              },
            ],
          },
        },
      })),
      subscribe: vi.fn(() => () => undefined),
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
        handle: {
          capabilities: new Set(['read-bytes', 'read-stream', 'write-bytes']),
          readBytes: vi.fn(async () => ({
            content: bytes,
            revision: createTextRevision(bytes),
          })),
          writeBytes: vi.fn(),
          close: vi.fn(async () => undefined),
        },
      })),
    };
    const functionTools = new AgentFunctionToolRegistry();
    htmlAssistantMainFeature.registerAgentFunctionTools({ functionTools });

    htmlMainWorkbenchContribution.createProvider?.({
      assetService: assets,
      generationTasks,
      stateDatabase: {
        get: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      stateDataDatabase: {
        get: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      contentResourceService: {},
      sandboxFrameScripts: {},
      workbenchEvents: {},
    } as never);

    try {
      await expect(
        functionTools.require('html_begin_edit').execute(
          {
            locator: { kind: 'selector', selector: '#title' },
            scope: 'contents',
          },
          {
            taskId: 'task-1',
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
          },
        ),
      ).resolves.toMatchObject({ currentHtml: 'Before' });
      expect(generationTasks.get).toHaveBeenCalledWith('task-1');
      expect(assets.resolveContent).toHaveBeenCalledWith('asset-1');
    } finally {
      setHtmlEditToolRuntime(undefined);
    }
  });
});
