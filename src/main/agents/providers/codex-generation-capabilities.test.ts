import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveCodexGenerationCapabilities } from './codex-generation-capabilities';

describe('resolveCodexGenerationCapabilities', () => {
  it('resolves explicit Skills and maps MCP definitions without provider types in TaskDefinition', async () => {
    const skillPath = resolve('skills', 'pdf-reading', 'SKILL.md');
    const selection = await resolveCodexGenerationCapabilities(
      [{ id: 'pdf-reading', availability: 'required' }],
      [{ id: 'document-tools', availability: 'required' }],
      {
        skills: {
          get: vi.fn(async () => ({
            id: 'pdf-reading',
            version: 2,
            description: 'Read PDF files.',
            directoryPath: resolve('skills', 'pdf-reading'),
            skillFilePath: skillPath,
          })),
        },
        mcpServers: {
          get: vi.fn(async () => ({
            id: 'document-tools',
            version: 3,
            description: 'Document utilities.',
            transport: {
              type: 'stdio' as const,
              command: 'node',
              args: ['server.mjs'],
              environmentVariables: ['DOCUMENT_TOKEN'],
            },
            startupTimeoutMs: 15_000,
            enabledTools: ['read_document'],
          })),
        },
      },
    );

    expect(selection.skills).toEqual([
      {
        id: 'pdf-reading',
        version: 2,
        description: 'Read PDF files.',
        directoryPath: resolve('skills', 'pdf-reading'),
        path: skillPath,
      },
    ]);
    expect(selection.mcpServers).toEqual([
      expect.objectContaining({
        id: 'document-tools',
        wireName: 'learning_companion_document-tools',
        config: {
          enabled: true,
          required: true,
          default_tools_approval_mode: 'approve',
          startup_timeout_ms: 15_000,
          enabled_tools: ['read_document'],
          command: 'node',
          args: ['server.mjs'],
          env_vars: ['DOCUMENT_TOKEN'],
        },
      }),
    ]);
    expect(
      selection.mcpServerIdsByWireName.get(
        'learning_companion_document-tools',
      ),
    ).toBe('document-tools');
  });

  it('omits missing optional capabilities and rejects missing required ones', async () => {
    const dependencies = {
      skills: { get: vi.fn(async () => undefined) },
      mcpServers: { get: vi.fn(async () => undefined) },
    };

    await expect(
      resolveCodexGenerationCapabilities(
        [{ id: 'optional-skill', availability: 'optional' }],
        [{ id: 'optional-mcp', availability: 'optional' }],
        dependencies,
      ),
    ).resolves.toMatchObject({ skills: [], mcpServers: [] });
    await expect(
      resolveCodexGenerationCapabilities(
        [{ id: 'required-skill', availability: 'required' }],
        [],
        dependencies,
      ),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
