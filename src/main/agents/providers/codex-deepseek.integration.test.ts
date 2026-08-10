import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServerConnectionFactory } from '../codex/codex-app-server-process';
import { resolveCodexExecutablePath } from '../codex/codex-runtime-paths';
import { CodexRuntimeService } from '../codex/codex-runtime-service';
import { normalizeCodexResponsesBaseUrl } from './codex-responses-url';

const deepSeekApiKey = process.env.CI
  ? undefined
  : process.env.DEEPSEEK?.trim();

describe.runIf(Boolean(deepSeekApiKey))('Codex DeepSeek live integration', () => {
  it(
    'runs a real Codex turn through the DeepSeek Responses API',
    async () => {
      if (!deepSeekApiKey) {
        throw new Error('DEEPSEEK is required for this local integration test');
      }

      const apiRoot = normalizeCodexResponsesBaseUrl(
        'https://api.deepseek.com/responses',
      );
      expect(apiRoot).toBe('https://api.deepseek.com');

      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'learning-companion-deepseek-'),
      );
      const workspacePath = join(temporaryDirectory, 'workspace');
      const codexHomePath = join(temporaryDirectory, 'codex-home');
      await Promise.all([
        mkdir(workspacePath, { recursive: true }),
        mkdir(codexHomePath, { recursive: true }),
      ]);

      const environmentKey = 'LC_DEEPSEEK_API_KEY';
      const modelProviderId = 'lc_deepseek_live';
      const permissions = 'lc-deepseek-live';
      const service = new CodexRuntimeService(
        new CodexAppServerConnectionFactory({
          executablePath: resolveCodexExecutablePath({
            isPackaged: false,
            resourcesPath: process.cwd(),
          }),
          codexHomePath,
          environment: { [environmentKey]: deepSeekApiKey },
        }),
      );

      try {
        const configOverrides = {
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
            shell_tool: false,
          },
          tools: { view_image: false },
          web_search: 'disabled',
          model_providers: {
            [modelProviderId]: {
              name: 'Learning Companion DeepSeek integration',
              base_url: apiRoot,
              env_key: environmentKey,
              requires_openai_auth: false,
              wire_api: 'responses',
            },
          },
          permissions: {
            [permissions]: {
              filesystem: { ':minimal': 'read' },
              network: { enabled: false },
            },
          },
        } as const;
        const thread = await service.createThread({
          model: 'deepseek-v4-flash',
          modelProvider: modelProviderId,
          cwd: workspacePath,
          runtimeWorkspaceRoots: [workspacePath],
          approvalPolicy: 'never',
          permissions,
          ephemeral: true,
          developerInstructions:
            'This is a connectivity test. Do not call tools. Reply briefly.',
          configOverrides,
        });

        let assistantText = '';
        const turn = service.startTurn({
          threadId: thread.thread.id,
          input: [
            {
              type: 'text',
              text: 'Reply with exactly LC_DEEPSEEK_OK and nothing else.',
            },
          ],
          cwd: workspacePath,
          runtimeWorkspaceRoots: [workspacePath],
          approvalPolicy: 'never',
          model: 'deepseek-v4-flash',
          effort: 'low',
        });

        let result;
        while (true) {
          const next = await turn.next();
          if (next.done) {
            result = next.value;
            break;
          }
          if (next.value.type === 'assistant-message-delta') {
            assistantText += next.value.delta;
          }
        }

        expect(result.threadId).toBe(thread.thread.id);
        expect(result.turn.status).toBe('completed');
        expect(assistantText).toContain('LC_DEEPSEEK_OK');
      } finally {
        await service.shutdown();
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
