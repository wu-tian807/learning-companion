import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServerConnectionFactory } from './codex-app-server-process';
import { resolveCodexExecutablePath } from './codex-runtime-paths';
import { CodexRuntimeService } from './codex-runtime-service';

describe.runIf(
  ['darwin', 'win32'].includes(process.platform) &&
    ['arm64', 'x64'].includes(process.arch),
)('Codex Runtime integration', () => {
  it(
    'initializes the pinned app-server and reads isolated auth state',
    async () => {
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'learning-companion-codex-integration-'),
      );
      const service = new CodexRuntimeService(
        new CodexAppServerConnectionFactory({
          executablePath: resolveCodexExecutablePath({
            isPackaged: false,
            resourcesPath: process.cwd(),
          }),
          codexHomePath: join(temporaryDirectory, 'home'),
        }),
      );

      try {
        await expect(service.ensureReady()).resolves.toEqual({
          phase: 'ready',
        });
        await expect(service.getAccount()).resolves.toEqual({
          account: null,
          requiresOpenaiAuth: true,
        });
      } finally {
        await service.shutdown();
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
    30_000,
  );

  it(
    'creates a thread with an isolated permission profile over ambient legacy sandbox defaults',
    async () => {
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'learning-companion-codex-permissions-'),
      );
      const workspacePath = join(temporaryDirectory, 'workspace');
      const codexHomePath = join(temporaryDirectory, 'home');
      await mkdir(workspacePath, { recursive: true });
      await mkdir(codexHomePath, { recursive: true });
      await writeFile(
        join(codexHomePath, 'config.toml'),
        [
          'approval_policy = "never"',
          'sandbox_mode = "danger-full-access"',
          '',
          '[mcp_servers.ambient]',
          'command = "missing-ambient-mcp"',
          '',
        ].join('\n'),
        'utf8',
      );
      const service = new CodexRuntimeService(
        new CodexAppServerConnectionFactory({
          executablePath: resolveCodexExecutablePath({
            isPackaged: false,
            resourcesPath: process.cwd(),
          }),
          codexHomePath,
        }),
      );
      const profileId = 'lc-integration-read-only';
      const skillGroups = await service.listSkills([workspacePath], true);
      const disabledSkillPaths = [
        ...new Set(
          skillGroups.flatMap(({ skills }) =>
            skills.map(({ path }) => path),
          ),
        ),
      ];
      const configuration = {
        cwd: workspacePath,
        runtimeWorkspaceRoots: [workspacePath],
        approvalPolicy: 'never' as const,
        permissions: profileId,
        developerInstructions: 'Read only the supplied workspace.',
        configOverrides: {
          agents: { enabled: false },
          allow_login_shell: false,
          apps: { _default: { enabled: false } },
          features: {
            apps: false,
            goals: false,
            hooks: false,
            memories: false,
            multi_agent: false,
            remote_plugin: false,
            shell_tool: true,
          },
          tools: { view_image: true },
          web_search: 'disabled',
          'mcp_servers.ambient.enabled': false,
          ...(disabledSkillPaths.length > 0
            ? {
                skills: {
                  config: disabledSkillPaths.map((path) => ({
                    path,
                    enabled: false,
                  })),
                },
              }
            : {}),
          permissions: {
            [profileId]: {
              filesystem: {
                ':minimal': 'read',
                [workspacePath]: 'read',
              },
              network: { enabled: false },
            },
          },
        },
      };

      try {
        await expect(service.readConfig()).resolves.toMatchObject({
          config: {
            mcp_servers: {
              ambient: expect.objectContaining({
                command: 'missing-ambient-mcp',
              }),
            },
          },
        });
        const created = await service.createThread(configuration);
        expect(created.thread.id).toBeTruthy();
        expect(created.model).toBeTruthy();
        await expect(
          service.listMcpServers({
            threadId: created.thread.id,
            detail: 'toolsAndAuthOnly',
          }),
        ).resolves.toMatchObject({
          data: [
            expect.objectContaining({
              name: 'ambient',
              tools: {},
            }),
          ],
        });
      } finally {
        await service.shutdown();
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
    30_000,
  );
});
