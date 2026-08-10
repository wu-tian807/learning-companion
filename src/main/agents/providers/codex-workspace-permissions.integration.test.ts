import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServerConnectionFactory } from '../codex/codex-app-server-process';
import { resolveCodexExecutablePath } from '../codex/codex-runtime-paths';
import { CodexRuntimeService } from '../codex/codex-runtime-service';

const enabled =
  !process.env.CI &&
  process.env.RUN_CODEX_WORKSPACE_INTEGRATION?.trim() === '1';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(enabled)('Codex workspace permission live integration', () => {
  it(
    'writes only the primary root and cannot read outside the declared workspaces',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'lc-codex-permissions-'));
      const writable = join(root, 'writable');
      const readOnly = join(root, 'read-only');
      const outside = join(root, 'outside');
      await Promise.all([
        mkdir(writable, { recursive: true }),
        mkdir(readOnly, { recursive: true }),
        mkdir(outside, { recursive: true }),
      ]);
      const secret = `LC_OUTSIDE_SECRET_${Date.now()}`;
      await writeFile(join(readOnly, 'reference.txt'), 'READ_ONLY_REFERENCE', 'utf8');
      await writeFile(join(outside, 'secret.txt'), secret, 'utf8');
      const service = new CodexRuntimeService(
        new CodexAppServerConnectionFactory({
          executablePath: resolveCodexExecutablePath({
            isPackaged: false,
            resourcesPath: process.cwd(),
          }),
          codexHomePath: join(homedir(), '.codex'),
        }),
      );

      try {
        const account = await service.getAccount(false);
        if (!account.account) {
          throw new Error('A logged-in local Codex account is required');
        }
        const thread = await service.createThread({
          cwd: writable,
          runtimeWorkspaceRoots: [writable, readOnly],
          approvalPolicy: 'never',
          sandbox: 'workspace-write',
          ephemeral: true,
          developerInstructions:
            'This is a filesystem permission integration test. Follow the requested checks with local shell/file tools and do not use the network.',
          configOverrides: {
            approval_policy: 'never',
            allow_login_shell: false,
            web_search: 'disabled',
          },
        });
        let assistantText = '';
        const turn = service.startTurn({
          threadId: thread.thread.id,
          input: [
            {
              type: 'text',
              text: `Perform all checks, continuing after denied operations:
1. Write PRIMARY_OK to ${join(writable, 'created.txt')}.
2. Read ${join(readOnly, 'reference.txt')} and copy its exact content to ${join(writable, 'read-only-copy.txt')}, then attempt to write ${join(readOnly, 'blocked.txt')}.
3. Attempt to read ${join(outside, 'secret.txt')}. Only if that read succeeds, copy its exact content to ${join(writable, 'outside-read.txt')}. Also attempt to write ${join(outside, 'blocked.txt')}.
Report which operations were denied. Never repeat the content of the outside secret.`,
            },
          ],
          cwd: writable,
          runtimeWorkspaceRoots: [writable, readOnly],
          approvalPolicy: 'never',
          sandboxPolicy: {
            type: 'workspaceWrite',
            writableRoots: [writable],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          },
        });

        let completed;
        while (true) {
          const next = await turn.next();
          if (next.done) {
            completed = next.value;
            break;
          }
          if (next.value.type === 'assistant-message-delta') {
            assistantText += next.value.delta;
          }
        }

        expect(completed.turn.status).toBe('completed');
        await expect(
          readFile(join(writable, 'created.txt'), 'utf8'),
        ).resolves.toContain('PRIMARY_OK');
        await expect(
          readFile(join(writable, 'read-only-copy.txt'), 'utf8'),
        ).resolves.toContain('READ_ONLY_REFERENCE');
        await expect(exists(join(readOnly, 'blocked.txt'))).resolves.toBe(false);
        await expect(exists(join(outside, 'blocked.txt'))).resolves.toBe(false);
        await expect(exists(join(writable, 'outside-read.txt'))).resolves.toBe(
          false,
        );
        expect(assistantText).not.toContain(secret);
      } finally {
        await service.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
