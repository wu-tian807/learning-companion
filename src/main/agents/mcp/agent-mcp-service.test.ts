import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentMcpServerDefinition } from './agent-mcp-server';
import { AgentMcpService } from './agent-mcp-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function definition(version = 1): AgentMcpServerDefinition {
  return {
    id: 'document-tools',
    version,
    description: 'Application document conversion tools.',
    transport: {
      type: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      environmentVariables: ['DOCUMENT_TOKEN'],
    },
    startupTimeoutMs: 12_000,
    toolTimeoutMs: 60_000,
    enabledTools: ['convert_document', 'read_document'],
  };
}

describe('AgentMcpService', () => {
  it('persists provider-neutral MCP definitions and registers idempotently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-mcp-'));
    temporaryDirectories.push(directory);
    const service = new AgentMcpService(join(directory, 'mcp'));

    const registered = await service.register(definition());
    await expect(service.register(definition())).resolves.toEqual(registered);
    await expect(service.get('document-tools')).resolves.toEqual(registered);
    await expect(service.list()).resolves.toEqual([registered]);
    expect(
      JSON.parse(
        await readFile(join(directory, 'mcp', 'document-tools.json'), 'utf8'),
      ),
    ).toMatchObject({
      format: 'learning-companion/agent-mcp-server',
      definition: { id: 'document-tools', version: 1 },
    });
  });

  it('requires explicit replacement when a registered definition changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-mcp-'));
    temporaryDirectories.push(directory);
    const service = new AgentMcpService(join(directory, 'mcp'));
    await service.register(definition());

    await expect(service.register(definition(2))).rejects.toThrow(
      'REGISTRATION_CONFLICT',
    );
    await expect(service.replace(definition(2))).resolves.toMatchObject({
      version: 2,
    });
    await expect(service.remove('document-tools')).resolves.toBe(true);
    await expect(service.remove('document-tools')).resolves.toBe(false);
  });

  it('supports streamable HTTP without storing a token value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-mcp-'));
    temporaryDirectories.push(directory);
    const service = new AgentMcpService(join(directory, 'mcp'));

    await expect(
      service.register({
        id: 'remote-search',
        version: 1,
        description: 'Remote search server.',
        transport: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          bearerTokenEnvironmentVariable: 'REMOTE_SEARCH_TOKEN',
          environmentHeaders: { 'X-Tenant': 'REMOTE_SEARCH_TENANT' },
        },
      }),
    ).resolves.toMatchObject({
      transport: {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        bearerTokenEnvironmentVariable: 'REMOTE_SEARCH_TOKEN',
      },
    });
  });

  it('rejects overlapping enabled and disabled tool lists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-mcp-'));
    temporaryDirectories.push(directory);
    const service = new AgentMcpService(join(directory, 'mcp'));

    await expect(
      service.register({
        ...definition(),
        enabledTools: ['read_document'],
        disabledTools: ['read_document'],
      }),
    ).rejects.toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
