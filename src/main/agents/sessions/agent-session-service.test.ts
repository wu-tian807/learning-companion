import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectLookup } from '../../projects/project-database';
import { createAgentSessionLocator } from './agent-session';
import { AgentSessionFile } from './agent-session-file';
import { AgentSessionService } from './agent-session-service';

const temporaryDirectories: string[] = [];

async function createHarness() {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-agent-session-service-'),
  );
  temporaryDirectories.push(directory);
  const workspacePath = join(directory, 'project-workspace');
  await mkdir(workspacePath);
  const projectLookup: ProjectLookup = {
    get: (id) =>
      id === 'project-1'
        ? {
            id,
            name: 'Project 1',
            icon: 'P',
            pinned: false,
            createdTime: 1,
            workspacePath,
          }
        : undefined,
  };
  let now = 100;
  const createService = () =>
    new AgentSessionService(projectLookup, { now: () => now++ });

  return { workspacePath, createService };
}

const locator = createAgentSessionLocator({
  projectId: 'project-1',
  workspaceKey: 'generation-mindmap',
  instanceKey: 'task-1',
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('AgentSessionService', () => {
  it('persists a binding and restores it in a new service instance', async () => {
    const { workspacePath, createService } = await createHarness();
    const first = createService();
    first.loadFromProject('project-1');

    await expect(
      first.bindProvider({
        locator,
        providerId: 'codex',
        sessionId: 'thread-1',
      }),
    ).resolves.toMatchObject({ sessionId: 'thread-1' });

    const restored = createService();
    restored.loadFromProject('project-1');
    await expect(
      restored.getProviderBinding(locator, 'codex'),
    ).resolves.toMatchObject({
      sessionId: 'thread-1',
    });
    await expect(
      new AgentSessionFile(workspacePath).read(locator),
    ).resolves.toBeDefined();
  });

  it('serializes concurrent first bindings without losing either provider', async () => {
    const { createService } = await createHarness();
    const service = createService();
    service.loadFromProject('project-1');

    await Promise.all([
      service.bindProvider({
        locator,
        providerId: 'codex',
        sessionId: 'thread-codex-1',
      }),
      service.bindProvider({
        locator,
        providerId: 'claude-code',
        sessionId: 'session-claude-1',
      }),
    ]);

    await expect(service.get(locator)).resolves.toMatchObject({
      providerBindings: {
        codex: { sessionId: 'thread-codex-1' },
        'claude-code': { sessionId: 'session-claude-1' },
      },
    });
  });

  it('does not overwrite a conflicting provider binding', async () => {
    const { createService } = await createHarness();
    const service = createService();
    service.loadFromProject('project-1');
    await service.bindProvider({
      locator,
      providerId: 'codex',
      sessionId: 'thread-1',
    });

    await expect(
      service.bindProvider({
        locator,
        providerId: 'codex',
        sessionId: 'thread-2',
      }),
    ).rejects.toThrow('AGENT_SESSION_CONFLICT');
    await expect(
      service.getProviderBinding(locator, 'codex'),
    ).resolves.toMatchObject({ sessionId: 'thread-1' });
  });

  it('supports an explicit compare-and-replace for a rebuilt session', async () => {
    const { createService } = await createHarness();
    const service = createService();
    service.loadFromProject('project-1');
    await service.bindProvider({
      locator,
      providerId: 'codex',
      sessionId: 'thread-1',
    });

    await expect(
      service.replaceProviderBinding({
        locator,
        providerId: 'codex',
        expectedSessionId: 'thread-1',
        sessionId: 'thread-2',
      }),
    ).resolves.toMatchObject({
      sessionId: 'thread-2',
    });
  });

  it('enforces the active Project boundary', async () => {
    const { createService } = await createHarness();
    const service = createService();

    await expect(service.get(locator)).rejects.toThrow(
      'SERVICE_NOT_READY',
    );
    expect(() => service.loadFromProject('missing')).toThrow(
      'PROJECT_NOT_FOUND',
    );
    service.loadFromProject('project-1');
    await expect(
      service.get({ ...locator, projectId: 'project-2' }),
    ).rejects.toThrow('PROJECT_CONTEXT_CHANGED');
    service.unloadProject();
    expect(service.getActiveProjectId()).toBeUndefined();
  });
});
