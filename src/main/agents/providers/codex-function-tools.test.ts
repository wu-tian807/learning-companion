import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors/app-error';
import type { AgentToolRequirement } from '../../generation/contracts/task-definition';
import type { AgentFunctionToolDefinition } from '../function-tools/agent-function-tool';
import { AgentFunctionToolRegistry } from '../function-tools/agent-function-tool-registry';
import {
  WORKSPACE_READ_TOOL_ID,
  WORKSPACE_SEARCH_TOOL_ID,
  WORKSPACE_VIEW_IMAGE_TOOL_ID,
  WORKSPACE_WRITE_TOOL_ID,
} from '../function-tools/builtin-agent-function-tool-ids';
import {
  PDF_READ_FUNCTION_TOOL_ID,
  pdfFunctionTool,
} from '../../../workbenches/pdf/agent/pdf-function-tool';
import {
  CODEX_FUNCTION_TOOL_NAMESPACE,
  handleCodexGenerationServerRequest,
  resolveCodexGenerationTools,
} from './codex-function-tools';

function createRegistry(
  execute: AgentFunctionToolDefinition['execute'] = vi.fn(
    async () => ({ ok: true } as const),
  ),
) {
  const registry = new AgentFunctionToolRegistry();
  registry.register({
    id: 'read_asset_anchor',
    version: 2,
    description: 'Read one selected asset anchor.',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' } },
      required: ['assetId'],
      additionalProperties: false,
    },
    deferLoading: true,
    execute,
  });
  return registry;
}

function serverRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: 'server-request' as const,
    threadId: 'thread-1',
    turnId: 'turn-1',
    request: {
      requestId: 'request-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-1',
        namespace: CODEX_FUNCTION_TOOL_NAMESPACE,
        tool: 'read_asset_anchor',
        arguments: { assetId: 'asset-1' },
        ...overrides,
      },
    },
  };
}

function executionContext() {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        scope: 'task' as const,
        instanceKey: 'task-1',
        path: resolve('test-fixtures', 'generation-mindmap'),
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

function toolRequest(
  toolRequirements: readonly AgentToolRequirement[] = [],
  write = false,
) {
  const context = executionContext();

  return {
    toolRequirements,
    workspaces: {
      primary: {
        ...context.workspaces.primary,
        permissions: { read: true, write },
      },
      secondary: context.workspaces.secondary,
    },
  };
}

describe('Codex function tools', () => {
  it('combines default workspace tools and additional function tools', () => {
    const registry = createRegistry();
    registry.register(pdfFunctionTool);
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'missing_optional', availability: 'optional' },
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      registry,
      [{ id: PDF_READ_FUNCTION_TOOL_ID, availability: 'required' }],
    );

    expect(selection.effectiveRequirements).toEqual([
      { id: 'read_asset_anchor', availability: 'required' },
      { id: PDF_READ_FUNCTION_TOOL_ID, availability: 'required' },
      { id: WORKSPACE_READ_TOOL_ID, availability: 'required' },
      { id: WORKSPACE_SEARCH_TOOL_ID, availability: 'required' },
      { id: WORKSPACE_VIEW_IMAGE_TOOL_ID, availability: 'required' },
    ]);
    expect(selection.nativeToolIds).toEqual([
      WORKSPACE_READ_TOOL_ID,
      WORKSPACE_SEARCH_TOOL_ID,
      WORKSPACE_VIEW_IMAGE_TOOL_ID,
    ]);
    expect(selection.functionTools.map(({ id, version }) => ({ id, version })))
      .toEqual([
        { id: 'read_asset_anchor', version: 2 },
        { id: PDF_READ_FUNCTION_TOOL_ID, version: 4 },
      ]);
    expect(selection.dynamicTools).toEqual([
      {
        type: 'namespace',
        name: CODEX_FUNCTION_TOOL_NAMESPACE,
        description: 'Application tools provided by Learning Companion.',
        tools: expect.arrayContaining([
          expect.objectContaining({
            type: 'function',
            name: 'read_asset_anchor',
            deferLoading: true,
          }),
          expect.objectContaining({ name: PDF_READ_FUNCTION_TOOL_ID }),
        ]),
      },
    ]);
  });

  it('fails required unknown tools and omits unsupported optional tools', () => {
    const registry = new AgentFunctionToolRegistry();

    expect(() =>
      resolveCodexGenerationTools(
        toolRequest([
          { id: 'missing_required', availability: 'required' },
        ]),
        registry,
      ),
    ).toThrowError(new AppError('FEATURE_NOT_SUPPORTED'));
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'missing_optional', availability: 'optional' },
      ]),
      registry,
    );
    expect(selection.effectiveRequirements).not.toContainEqual(
      expect.objectContaining({ id: 'missing_optional' }),
    );
    expect(selection.dynamicTools).toHaveLength(0);
  });

  it('enables write only when a prepared workspace is writable', () => {
    expect(
      resolveCodexGenerationTools(
        toolRequest([], false),
        createRegistry(),
      ).nativeToolIds,
    ).toEqual([
      WORKSPACE_READ_TOOL_ID,
      WORKSPACE_SEARCH_TOOL_ID,
      WORKSPACE_VIEW_IMAGE_TOOL_ID,
    ]);
    expect(
      resolveCodexGenerationTools(
        toolRequest([], true),
        createRegistry(),
      ).nativeToolIds,
    ).toContain(WORKSPACE_WRITE_TOOL_ID);
    expect(() =>
      resolveCodexGenerationTools(
        toolRequest([
          { id: WORKSPACE_WRITE_TOOL_ID, availability: 'required' },
        ]),
        createRegistry(),
      ),
    ).toThrowError(new AppError('DATA_INTEGRITY_ERROR'));
  });

  it('merges provider defaults with required taking precedence', () => {
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(),
      [
        { id: 'read_asset_anchor', availability: 'optional' },
        { id: 'missing_optional', availability: 'optional' },
      ],
    );

    expect(selection.functionTools.map(({ id }) => id)).toContain(
      'read_asset_anchor',
    );
    expect(selection.effectiveRequirements).toContainEqual({
      id: 'read_asset_anchor',
      availability: 'required',
    });
  });

  it('dispatches a dynamic tool callback and returns its result', async () => {
    const execute = vi.fn(async () => ({ text: 'selected' } as const));
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(execute),
    );
    const respond = vi.fn(async () => undefined);
    const context = executionContext();

    await expect(
      handleCodexGenerationServerRequest({
        event: serverRequest(),
        expectedThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        selection,
        generationRequest: context,
        respond,
      }),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(
      { assetId: 'asset-1' },
      context,
    );
    expect(respond).toHaveBeenCalledWith('request-1', {
      result: {
        contentItems: [
          { type: 'inputText', text: '{"text":"selected"}' },
        ],
        success: true,
      },
    });
  });

  it('maps rich function results to model-visible image content', async () => {
    const execute = vi.fn(async () => ({
      kind: 'content' as const,
      items: [
        { type: 'text' as const, text: 'page 1' },
        {
          type: 'image' as const,
          url: 'data:image/png;base64,cGFnZQ==',
        },
      ],
    }));
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(execute),
    );
    const respond = vi.fn(async () => undefined);

    await handleCodexGenerationServerRequest({
      event: serverRequest(),
      expectedThreadId: 'thread-1',
      activeTurnId: 'turn-1',
      selection,
      generationRequest: executionContext(),
      respond,
    });

    expect(respond).toHaveBeenCalledWith('request-1', {
      result: {
        contentItems: [
          { type: 'inputText', text: 'page 1' },
          {
            type: 'inputImage',
            imageUrl: 'data:image/png;base64,cGFnZQ==',
          },
        ],
        success: true,
      },
    });
  });

  it('returns a sanitized failure without taking over the agent loop', async () => {
    const execute = vi.fn(async () => {
      throw new Error('secret database path');
    });
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(execute),
    );
    const respond = vi.fn(async () => undefined);

    await handleCodexGenerationServerRequest({
      event: serverRequest(),
      expectedThreadId: 'thread-1',
      activeTurnId: 'turn-1',
      selection,
      generationRequest: executionContext(),
      respond,
    });

    expect(respond).toHaveBeenCalledWith('request-1', {
      result: {
        contentItems: [
          {
            type: 'inputText',
            text: 'Learning Companion tool "read_asset_anchor" failed.',
          },
        ],
        success: false,
      },
    });
    expect(JSON.stringify(respond.mock.calls)).not.toContain(
      'secret database path',
    );
  });

  it('propagates cancellation without returning a tool result', async () => {
    const execute = vi.fn(async () => ({ ok: true } as const));
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(execute),
    );
    const controller = new AbortController();
    const respond = vi.fn(async () => undefined);
    controller.abort();

    await expect(
      handleCodexGenerationServerRequest({
        event: serverRequest(),
        expectedThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        selection,
        generationRequest: {
          ...executionContext(),
          signal: controller.signal,
        },
        respond,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('does not attempt a second response after transport failure', async () => {
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(),
    );
    const respond = vi.fn(async () => {
      throw new Error('connection closed');
    });

    await expect(
      handleCodexGenerationServerRequest({
        event: serverRequest(),
        expectedThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        selection,
        generationRequest: executionContext(),
        respond,
      }),
    ).rejects.toThrow('connection closed');
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it('rejects calls outside the selected namespace or active turn', async () => {
    const selection = resolveCodexGenerationTools(
      toolRequest([
        { id: 'read_asset_anchor', availability: 'required' },
      ]),
      createRegistry(),
    );
    const respond = vi.fn(async () => undefined);

    await expect(
      handleCodexGenerationServerRequest({
        event: serverRequest({ namespace: 'unexpected' }),
        expectedThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        selection,
        generationRequest: executionContext(),
        respond,
      }),
    ).rejects.toThrow('CODEX_PROTOCOL_ERROR');
    expect(respond).toHaveBeenCalledWith('request-1', {
      error: {
        code: -32_602,
        message: 'Dynamic tool call context is invalid',
      },
    });
  });

  it('rejects non-tool server requests according to the provider policy', async () => {
    const selection = resolveCodexGenerationTools(
      toolRequest(),
      createRegistry(),
    );
    const event = serverRequest();

    await expect(
      handleCodexGenerationServerRequest({
        event: {
          ...event,
          request: { ...event.request, method: 'tool/requestUserInput' },
        },
        expectedThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        selection,
        generationRequest: executionContext(),
        respond: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
