import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import { inspectCodexGenerationEnvironment } from './codex-generation-environment';

describe('inspectCodexGenerationEnvironment', () => {
  it('disables only MCP servers backed by actual config entries', async () => {
    const workspacePath = resolve('test-fixtures', 'generation-mindmap');
    const readConfig = vi.fn(async () => ({
      config: {
        mcp_servers: {
          node_repl: { command: 'node-repl' },
        },
      },
    }));
    const listMcpServers = vi.fn(async () => ({
      data: [
        { name: 'codex_apps', authStatus: null, tools: {} },
        { name: 'node_repl', authStatus: null, tools: {} },
      ],
      nextCursor: null,
    }));
    const runtime = {
      readConfig,
      listMcpServers,
      listSkills: vi.fn(async () => [
        {
          cwd: workspacePath,
          skills: [
            {
              name: 'ambient-skill',
              description: 'Ambient Skill',
              path: resolve('ambient-skills', 'SKILL.md'),
              enabled: true,
            },
          ],
        },
      ]),
    } as unknown as CodexRuntimeServiceApi;
    const request = {
      workspaces: {
        primary: {
          key: 'generation-mindmap',
          instanceKey: 'task-1',
          path: workspacePath,
          permissions: { read: true, write: false },
        },
        secondary: [],
      },
    } as unknown as GenerationAgentTurnRequest;

    await expect(
      inspectCodexGenerationEnvironment(runtime, request),
    ).resolves.toEqual({
      disabledMcpServers: ['node_repl'],
      disabledSkillPaths: [resolve('ambient-skills', 'SKILL.md')],
    });
    expect(readConfig).toHaveBeenCalledOnce();
    expect(listMcpServers).not.toHaveBeenCalled();
  });
});
