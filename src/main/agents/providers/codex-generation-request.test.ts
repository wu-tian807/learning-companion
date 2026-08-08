import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import { AgentFunctionToolRegistry } from '../function-tools/agent-function-tool-registry';
import {
  WORKSPACE_READ_TOOL_ID,
  WORKSPACE_SEARCH_TOOL_ID,
  WORKSPACE_VIEW_IMAGE_TOOL_ID,
  WORKSPACE_WRITE_TOOL_ID,
} from '../function-tools/builtin-agent-function-tool-ids';
import { resolveCodexGenerationTools } from './codex-function-tools';
import type { CodexGenerationCapabilitySelection } from './codex-generation-capabilities';
import {
  createCodexClientUserMessageId,
  createCodexGenerationConfiguration,
  toCodexUserInput,
} from './codex-generation-request';

const emptyCapabilities: CodexGenerationCapabilitySelection = {
  skills: [],
  mcpServers: [],
  mcpServerIdsByWireName: new Map(),
};

function request(): GenerationAgentTurnRequest {
  const path = resolve('test-fixtures', 'generation-mindmap');

  return {
    taskId: 'task-1',
    callKey: 'generate',
    projectId: 'project-1',
    sessionLocator: {
      projectId: 'project-1',
      workspaceKey: 'generation-mindmap',
      instanceKey: 'task-1',
    },
    systemInstruction: 'Generate a mind map candidate.',
    userMessage: {
      role: 'user',
      content: [{ type: 'text', text: 'Generate it.' }],
    },
    toolRequirements: [
      { id: 'read_asset_anchor', availability: 'required' },
    ],
    skills: [],
    mcpServers: [],
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        scope: 'task',
        instanceKey: 'task-1',
        path,
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

function registry(version: number, includeUnselected = false) {
  const result = new AgentFunctionToolRegistry();
  result.register({
    id: 'read_asset_anchor',
    version,
    description: 'Read one selected asset anchor.',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' } },
    },
    execute: vi.fn(async () => null),
  });

  if (includeUnselected) {
    result.register({
      id: 'unused_tool',
      version: 1,
      description: 'Not selected by this task.',
      inputSchema: { type: 'object' },
      execute: vi.fn(async () => null),
    });
  }

  return result;
}

describe('createCodexGenerationConfiguration', () => {
  it('uses the stable logical call key for Provider replay identity', () => {
    const initial = request();
    const sameCallWithRebuiltMessage = {
      ...initial,
      userMessage: {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Rebuilt prompt.' }],
      },
    };
    const repair = { ...initial, callKey: 'repair-1' };

    expect(createCodexClientUserMessageId(initial)).toBe(
      createCodexClientUserMessageId(sameCallWithRebuiltMessage),
    );
    expect(createCodexClientUserMessageId(initial)).not.toBe(
      createCodexClientUserMessageId(repair),
    );
  });

  it('maps Provider default workspace tools to the permission profile', () => {
    const readOnlyRequest = {
      ...request(),
      toolRequirements: [],
    };
    const readOnlyTools = resolveCodexGenerationTools(
      readOnlyRequest,
      new AgentFunctionToolRegistry(),
    );
    const readOnly = createCodexGenerationConfiguration(
      readOnlyRequest,
      { disabledMcpServers: [], disabledSkillPaths: [] },
      readOnlyTools,
      emptyCapabilities,
    );
    const workspacePath = readOnlyRequest.workspaces.primary.path;

    expect(readOnlyTools.nativeToolIds).toEqual([
      WORKSPACE_READ_TOOL_ID,
      WORKSPACE_SEARCH_TOOL_ID,
      WORKSPACE_VIEW_IMAGE_TOOL_ID,
    ]);
    expect(readOnly.threadInput.permissions).toBe(readOnly.profileId);
    expect(readOnly.threadInput.configOverrides).toMatchObject({
      features: { shell_tool: true },
      tools: { view_image: true },
      permissions: {
        [readOnly.profileId]: {
          filesystem: { [workspacePath]: 'read' },
        },
      },
    });
    expect(readOnly.threadInput.configOverrides).not.toHaveProperty(
      'default_permissions',
    );
    expect(readOnly.threadInput.developerInstructions).toContain(
      'It reads embedded text only and is not OCR',
    );
    expect(readOnly.threadInput.developerInstructions).toContain(
      'Do not form the final answer from extracted text alone',
    );

    const writableRequest = {
      ...readOnlyRequest,
      workspaces: {
        ...readOnlyRequest.workspaces,
        primary: {
          ...readOnlyRequest.workspaces.primary,
          permissions: { read: true, write: true },
        },
      },
    };
    const writableTools = resolveCodexGenerationTools(
      writableRequest,
      new AgentFunctionToolRegistry(),
    );
    const writable = createCodexGenerationConfiguration(
      writableRequest,
      { disabledMcpServers: [], disabledSkillPaths: [] },
      writableTools,
      emptyCapabilities,
    );

    expect(writableTools.nativeToolIds).toContain(
      WORKSPACE_WRITE_TOOL_ID,
    );
    expect(writable.threadInput.configOverrides).toMatchObject({
      permissions: {
        [writable.profileId]: {
          filesystem: { [workspacePath]: 'write' },
        },
      },
    });
    expect(writable.threadInput.configOverrides).not.toHaveProperty(
      'default_permissions',
    );
    expect(writable.fingerprint).not.toBe(readOnly.fingerprint);
  });

  it('includes selected dynamic tools and their version in the fingerprint', () => {
    const generationRequest = request();
    const environment = {
      disabledMcpServers: [],
      disabledSkillPaths: [],
    };
    const versionOne = createCodexGenerationConfiguration(
      generationRequest,
      environment,
      resolveCodexGenerationTools(
        generationRequest,
        registry(1),
      ),
      emptyCapabilities,
    );
    const versionTwo = createCodexGenerationConfiguration(
      generationRequest,
      environment,
      resolveCodexGenerationTools(
        generationRequest,
        registry(2),
      ),
      emptyCapabilities,
    );
    const withUnselectedTool = createCodexGenerationConfiguration(
      generationRequest,
      environment,
      resolveCodexGenerationTools(
        generationRequest,
        registry(1, true),
      ),
      emptyCapabilities,
    );

    expect(versionOne.threadInput.dynamicTools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'learning_companion',
      }),
    ]);
    expect(versionOne.fingerprint).not.toBe(versionTwo.fingerprint);
    expect(versionOne.fingerprint).toBe(withUnselectedTool.fingerprint);
  });

  it('injects explicit Skills and only selected MCP server configuration', () => {
    const generationRequest = request();
    const skillPath = resolve('app-skills', 'pdf-reading', 'SKILL.md');
    const capabilities: CodexGenerationCapabilitySelection = {
      skills: [
        {
          id: 'pdf-reading',
          version: 1,
          description: 'Read PDF files.',
          directoryPath: resolve('app-skills', 'pdf-reading'),
          path: skillPath,
        },
      ],
      mcpServers: [
        {
          id: 'document-tools',
          availability: 'required',
          wireName: 'learning_companion_document-tools',
          definition: {
            id: 'document-tools',
            version: 1,
            description: 'Document tools.',
            transport: { type: 'stdio', command: 'document-mcp' },
          },
          config: {
            enabled: true,
            required: true,
            default_tools_approval_mode: 'approve',
            command: 'document-mcp',
          },
        },
      ],
      mcpServerIdsByWireName: new Map([
        ['learning_companion_document-tools', 'document-tools'],
      ]),
    };
    const configuration = createCodexGenerationConfiguration(
      generationRequest,
      {
        disabledMcpServers: [
          'user-mcp',
          'user.mcp',
          'learning_companion_document-tools',
        ],
        disabledSkillPaths: [resolve('user-skills', 'SKILL.md'), skillPath],
      },
      resolveCodexGenerationTools(
        generationRequest,
        registry(1),
      ),
      capabilities,
    );
    const changedSkillVersion = createCodexGenerationConfiguration(
      generationRequest,
      { disabledMcpServers: [], disabledSkillPaths: [] },
      resolveCodexGenerationTools(
        generationRequest,
        registry(1),
      ),
      {
        ...capabilities,
        skills: capabilities.skills.map((skill) => ({
          ...skill,
          version: skill.version + 1,
        })),
      },
    );

    expect(toCodexUserInput(generationRequest, capabilities)).toEqual([
      { type: 'text', text: '$pdf-reading' },
      { type: 'skill', name: 'pdf-reading', path: skillPath },
      { type: 'text', text: 'Generate it.' },
    ]);
    expect(configuration.threadInput.configOverrides).toMatchObject({
      'mcp_servers.user-mcp.enabled': false,
      'mcp_servers."user.mcp".enabled': false,
      mcp_servers: {
        'learning_companion_document-tools': {
          enabled: true,
          required: true,
          command: 'document-mcp',
        },
      },
      skills: {
        config: [
          { path: resolve('user-skills', 'SKILL.md'), enabled: false },
        ],
      },
    });
    expect(configuration.fingerprint).not.toBe(
      changedSkillVersion.fingerprint,
    );
  });
});
