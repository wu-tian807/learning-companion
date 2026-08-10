import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentSession, createAgentSessionLocator } from './agent-session';
import {
  AGENT_SESSION_FILE_FORMAT,
  AGENT_SESSION_FILE_VERSION,
  AgentSessionFile,
} from './agent-session-file';

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-agent-session-file-'),
  );
  temporaryDirectories.push(directory);
  const workspacePath = join(directory, 'project-workspace');
  await mkdir(workspacePath);
  return workspacePath;
}

const locator = createAgentSessionLocator({
  projectId: 'project-1',
  workspaceKey: 'generation-mindmap',
  instanceKey: 'task-1',
});

function createBoundSession(): AgentSession {
  const session = AgentSession.create(locator, 10);
  session.bindProvider({
    providerId: 'codex',
    sessionId: 'thread-1',
    updatedTime: 11,
  });
  return session;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('AgentSessionFile', () => {
  it('resolves a provider-neutral file outside the Agent workspace tree', () => {
    expect(
      new AgentSessionFile('/project', { pathRules: posix }).resolve(
        locator,
      ),
    ).toBe(
      '/project/.learning-companion/agent-sessions/generation-mindmap/task-1/session.json',
    );
    expect(
      new AgentSessionFile('C:\\Project', { pathRules: win32 }).resolve(
        locator,
      ),
    ).toBe(
      'C:\\Project\\.learning-companion\\agent-sessions\\generation-mindmap\\task-1\\session.json',
    );
  });

  it('round-trips a versioned session document atomically', async () => {
    const workspacePath = await createWorkspace();
    const file = new AgentSessionFile(workspacePath);
    const session = createBoundSession();

    await file.write(session.getSnapshot());

    await expect(file.read(locator)).resolves.toEqual(
      session.getSnapshot(),
    );
    const document = JSON.parse(await readFile(file.resolve(locator), 'utf8'));
    expect(document).toMatchObject({
      format: AGENT_SESSION_FILE_FORMAT,
      version: AGENT_SESSION_FILE_VERSION,
      locator,
    });
  });

  it('reads a legacy fingerprint document and removes it on rewrite', async () => {
    const workspacePath = await createWorkspace();
    const file = new AgentSessionFile(workspacePath);
    const snapshot = createBoundSession().getSnapshot();
    await file.write(snapshot);
    const filePath = file.resolve(locator);

    await writeFile(
      filePath,
      JSON.stringify({
        format: AGENT_SESSION_FILE_FORMAT,
        version: 1,
        ...snapshot,
        providerBindings: {
          codex: {
            ...snapshot.providerBindings.codex,
            configurationFingerprint: 'legacy-configuration',
          },
        },
      }),
    );

    const restored = await file.read(locator);
    expect(restored).toEqual(snapshot);
    await file.write(restored!);

    const rewritten = JSON.parse(await readFile(filePath, 'utf8'));
    expect(rewritten.version).toBe(AGENT_SESSION_FILE_VERSION);
    expect(
      rewritten.providerBindings.codex,
    ).not.toHaveProperty('configurationFingerprint');
  });

  it('returns undefined without creating metadata for a missing mapping', async () => {
    const workspacePath = await createWorkspace();
    const file = new AgentSessionFile(workspacePath);

    await expect(file.read(locator)).resolves.toBeUndefined();
    await expect(
      lstat(join(workspacePath, '.learning-companion')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid JSON and a locator that disagrees with its path', async () => {
    const workspacePath = await createWorkspace();
    const file = new AgentSessionFile(workspacePath);
    await file.write(createBoundSession().getSnapshot());
    const filePath = file.resolve(locator);

    await writeFile(filePath, '{bad json');
    await expect(file.read(locator)).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );

    await writeFile(
      filePath,
      JSON.stringify({
        format: AGENT_SESSION_FILE_FORMAT,
        version: AGENT_SESSION_FILE_VERSION,
        ...createBoundSession().getSnapshot(),
        locator: { ...locator, projectId: 'project-2' },
      }),
    );
    await expect(file.read(locator)).rejects.toThrow(
      'AGENT_SESSION_CONFLICT',
    );
  });

  it('rejects symlink traversal in the project metadata path', async () => {
    const workspacePath = await createWorkspace();
    const outsidePath = join(workspacePath, '..', 'outside-metadata');
    await mkdir(outsidePath);
    await symlink(
      outsidePath,
      join(workspacePath, '.learning-companion'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const file = new AgentSessionFile(workspacePath);

    await expect(
      file.write(createBoundSession().getSnapshot()),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(
      lstat(join(outsidePath, 'agent-sessions')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a missing Project workspace instead of recreating it', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-agent-session-missing-'),
    );
    temporaryDirectories.push(directory);
    const missingWorkspace = join(directory, 'missing-project');
    const file = new AgentSessionFile(missingWorkspace);

    await expect(file.read(locator)).rejects.toThrow(
      'PROJECT_WORKSPACE_UNAVAILABLE',
    );
    await expect(
      file.write(createBoundSession().getSnapshot()),
    ).rejects.toThrow('PROJECT_WORKSPACE_UNAVAILABLE');
  });
});
