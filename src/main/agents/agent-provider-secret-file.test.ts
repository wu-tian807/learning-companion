import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EncryptedAgentProviderSecretFile,
  type AgentProviderSecretEncryption,
} from './agent-provider-secret-file';

const temporaryDirectories: string[] = [];

function encryption(available = true): AgentProviderSecretEncryption {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value) => {
      const content = value.toString('utf8');
      if (!content.startsWith('sealed:')) {
        throw new Error('invalid encrypted payload');
      }
      return content.slice('sealed:'.length);
    },
  };
}

async function createPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'provider-secrets-'));
  temporaryDirectories.push(directory);
  return join(directory, 'agent-provider-secrets.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('EncryptedAgentProviderSecretFile', () => {
  it('只把系统加密后的 API Key 写入应用私有文件', async () => {
    const filePath = await createPath();
    const store = new EncryptedAgentProviderSecretFile(
      filePath,
      encryption(),
    );

    await Promise.all([
      store.set('codex', 'codex-api-1', 'secret-one'),
      store.set('codex', 'codex-api-2', 'secret-two'),
    ]);

    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).not.toContain('secret-one');
    expect(persisted).not.toContain('secret-two');
    expect(JSON.parse(persisted)).toMatchObject({
      version: 1,
      secrets: {
        'codex/codex-api-1': expect.any(String),
        'codex/codex-api-2': expect.any(String),
      },
    });

    const reloaded = new EncryptedAgentProviderSecretFile(
      filePath,
      encryption(),
    );
    await expect(reloaded.get('codex', 'codex-api-1')).resolves.toBe(
      'secret-one',
    );
    await reloaded.delete('codex', 'codex-api-1');
    await expect(reloaded.get('codex', 'codex-api-1')).resolves.toBeUndefined();
  });

  it('系统加密不可用时拒绝写入，不退化为明文', async () => {
    const filePath = await createPath();
    const store = new EncryptedAgentProviderSecretFile(
      filePath,
      encryption(false),
    );

    await expect(
      store.set('codex', 'codex-api-1', 'must-not-be-plaintext'),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_READY' });
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
