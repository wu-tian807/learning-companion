import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionProjectLifecycle } from '../agents/sessions/agent-session-service';
import { AgentWorkspaceManager } from '../agents/workspaces/agent-workspace-manager';
import type { AssetAssociationServiceApi } from '../asset-associations/asset-association-service';
import type { AssetServiceApi } from '../assets/asset-service';
import type { GenerationTaskProjectLifecycle } from '../generation/generation-task-service';
import type { SettingsRepository } from '../settings/settings-repository';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-service';
import {
  DUBBING_PHRASE_PLANNER_VERSION,
} from '../../workbenches/media-dubbing/dubbing-phrase-planner';
import { openMediaDubbingCheckpoint } from '../../workbenches/media-dubbing/media-dubbing-checkpoint-file';
import {
  DUBBING_SPEAKER_PLANNER_VERSION,
} from '../../workbenches/media-dubbing/dubbing-speaker-planner';
import { createProjectSnapshot } from './project';
import type { ProjectDatabaseApi } from './project-database';
import { ProjectService } from './project-service';
import { ProjectWorkspaceManager } from './project-workspace-manager';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

function createService(input: {
  readonly projectId: string;
  readonly workspacePath: string;
  readonly projectWorkspaces: ProjectWorkspaceManager;
  readonly agentWorkspaces: AgentWorkspaceManager;
  readonly defaultWorkspaceRoot: string;
}): {
  readonly service: ProjectService;
  readonly projectDatabase: ProjectDatabaseApi;
} {
  let project: ReturnType<typeof createProjectSnapshot> | undefined =
    createProjectSnapshot({
      id: input.projectId,
      name: 'Project A',
      icon: 'A',
      createdTime: 1,
      workspacePath: input.workspacePath,
    });
  const projectDatabase = {
    get: vi.fn((id: string) => (id === project?.id ? project : undefined)),
    delete: vi.fn((id: string) => {
      if (id === project?.id) project = undefined;
    }),
  } as unknown as ProjectDatabaseApi;
  const assetService = {
    getActiveProjectId: vi.fn(() => undefined),
    cancelProjectArtifactGeneration: vi.fn(async () => undefined),
  } as unknown as AssetServiceApi;
  const service = new ProjectService(
    projectDatabase,
    assetService,
    {
      loadFromProject: vi.fn(),
      unloadProject: vi.fn(),
    } as unknown as AssetAssociationServiceApi,
    {
      loadFromProject: vi.fn(),
      unloadProject: vi.fn(async () => undefined),
    } as AgentSessionProjectLifecycle,
    {
      loadFromProject: vi.fn(() => []),
      unloadProject: vi.fn(async () => undefined),
    } as GenerationTaskProjectLifecycle,
    {
      closeActive: vi.fn(async () => undefined),
    } as WorkbenchSessionLifecycle,
    input.projectWorkspaces,
    input.agentWorkspaces,
    {
      getDefaultProjectWorkspace: vi.fn(
        () => input.defaultWorkspaceRoot,
      ),
    } as unknown as SettingsRepository,
  );

  return { service, projectDatabase };
}

describe('Project deletion composition', () => {
  it('removes app data and the Project Agent Workspace without deleting either root', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'learning-companion-project-deletion-'),
    );
    temporaryDirectories.push(root);
    const projectId = 'project-a';
    const defaultWorkspaceRoot = join(root, 'projects');
    const workspacePath = join(defaultWorkspaceRoot, projectId);
    const projectWorkspaces = new ProjectWorkspaceManager();
    const agentWorkspaces = new AgentWorkspaceManager(
      join(root, 'agent-workspaces'),
    );
    await projectWorkspaces.prepareWorkspace({ projectId, workspacePath });
    const externalFile = join(workspacePath, 'keep-me.md');
    await writeFile(externalFile, 'external');
    await writeFile(
      join(
        workspacePath,
        '.learning-companion',
        'assets',
        'generated',
        'lesson.md',
      ),
      'generated lesson',
    );
    const projectAgentFile = join(
      await agentWorkspaces.prepare([
        projectId,
        'generation-mindmap',
        'task-1',
      ]),
      'candidate.json',
    );
    const siblingAgentFile = join(
      await agentWorkspaces.prepare([
        'project-b',
        'document-question',
        'task-2',
      ]),
      'answer.json',
    );
    await writeFile(projectAgentFile, '{}');
    await writeFile(siblingAgentFile, '{"answer":true}');
    const { projectDatabase, service } = createService({
      projectId,
      workspacePath,
      projectWorkspaces,
      agentWorkspaces,
      defaultWorkspaceRoot,
    });

    await service.deleteProject(projectId);

    await expect(lstat(workspacePath)).resolves.toBeDefined();
    await expect(readFile(externalFile, 'utf8')).resolves.toBe('external');
    await expect(
      lstat(join(workspacePath, '.learning-companion')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      lstat(join(root, 'agent-workspaces', projectId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(siblingAgentFile, 'utf8')).resolves.toBe(
      '{"answer":true}',
    );
    expect(projectDatabase.get(projectId)).toBeUndefined();
  });

  it('removes an interrupted dubbing checkpoint from a user-selected Workspace', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'learning-companion-project-deletion-'),
    );
    temporaryDirectories.push(root);
    const projectId = 'project-a';
    const workspacePath = join(root, 'chosen-workspace');
    await mkdir(workspacePath);
    const userFile = join(workspacePath, 'keep-me.md');
    await writeFile(userFile, 'user content');
    const projectWorkspaces = new ProjectWorkspaceManager();
    const agentWorkspaces = new AgentWorkspaceManager(
      join(root, 'agent-workspaces'),
    );
    await projectWorkspaces.prepareWorkspace({ projectId, workspacePath });
    const checkpoint = await openMediaDubbingCheckpoint({
      workspacePath,
      assetId: 'video-asset',
      sourceRevision: 'source-revision',
      producerVersion: 'producer-version',
      phrasePlannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
      speakerPlannerVersion: DUBBING_SPEAKER_PLANNER_VERSION,
      inputRevision: 'input-revision',
    });
    await writeFile(checkpoint.paths.originalAudioPath, 'partial audio');
    await writeFile(checkpoint.paths.progressPath, '{"completed":1}');
    const checkpointRoot = join(
      workspacePath,
      '.learning-companion',
      'checkpoints',
      'video-dubbing',
    );
    const { projectDatabase, service } = createService({
      projectId,
      workspacePath,
      projectWorkspaces,
      agentWorkspaces,
      defaultWorkspaceRoot: join(root, 'projects'),
    });

    await service.deleteProject(projectId);

    await expect(lstat(checkpointRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(userFile, 'utf8')).resolves.toBe('user content');
    await expect(
      lstat(
        join(
          workspacePath,
          '.learning-companion',
          'workspace.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(projectDatabase.get(projectId)).toBeUndefined();
  });
});
