import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  isAgentProviderConnectionId,
  isAgentProviderId,
} from '../../shared/agent-providers';
import { AppError } from '../errors/app-error';

export interface AgentProviderSecretStore {
  get(providerId: string, connectionId: string): Promise<string | undefined>;
  set(providerId: string, connectionId: string, secret: string): Promise<void>;
  delete(providerId: string, connectionId: string): Promise<void>;
}

export interface AgentProviderSecretEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredSecrets {
  readonly version: 1;
  readonly secrets: Readonly<Record<string, string>>;
}

function secretKey(providerId: string, connectionId: string): string {
  if (
    !isAgentProviderId(providerId) ||
    !isAgentProviderConnectionId(connectionId)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return `${providerId}/${connectionId}`;
}

function parseStoredSecrets(content: string): StoredSecrets {
  const value: unknown = JSON.parse(content);

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('secrets' in value) ||
    typeof value.secrets !== 'object' ||
    value.secrets === null ||
    Array.isArray(value.secrets) ||
    !Object.entries(value.secrets).every(
      ([key, encrypted]) =>
        key.length > 0 && typeof encrypted === 'string' && encrypted.length > 0,
    )
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return Object.freeze({
    version: 1,
    secrets: Object.freeze({ ...(value.secrets as Record<string, string>) }),
  });
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export class EncryptedAgentProviderSecretFile
  implements AgentProviderSecretStore
{
  private initializeTask: Promise<void> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private secrets: Readonly<Record<string, string>> = Object.freeze({});

  constructor(
    private readonly filePath: string,
    private readonly encryption: AgentProviderSecretEncryption,
  ) {}

  async get(
    providerId: string,
    connectionId: string,
  ): Promise<string | undefined> {
    await this.initialize();
    const encrypted = this.secrets[secretKey(providerId, connectionId)];

    if (!encrypted) {
      return undefined;
    }

    this.requireEncryption();

    try {
      const value = this.encryption.decryptString(
        Buffer.from(encrypted, 'base64'),
      );
      return value.trim().length > 0 ? value : undefined;
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }
  }

  async set(
    providerId: string,
    connectionId: string,
    secret: string,
  ): Promise<void> {
    await this.initialize();
    const normalized = secret.trim();

    if (!normalized) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    this.requireEncryption();
    const key = secretKey(providerId, connectionId);
    const encrypted = this.encryption.encryptString(normalized).toString('base64');
    await this.enqueueWrite((current) => ({ ...current, [key]: encrypted }));
  }

  async delete(providerId: string, connectionId: string): Promise<void> {
    await this.initialize();
    const key = secretKey(providerId, connectionId);

    if (!(key in this.secrets)) {
      return;
    }

    await this.enqueueWrite((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  private initialize(): Promise<void> {
    this.initializeTask ??= this.load();
    return this.initializeTask;
  }

  private async load(): Promise<void> {
    try {
      this.secrets = parseStoredSecrets(
        await readFile(this.filePath, 'utf8'),
      ).secrets;
    } catch (error) {
      if (isFileNotFound(error)) {
        this.secrets = Object.freeze({});
        return;
      }

      throw error;
    }
  }

  private requireEncryption(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new AppError('SERVICE_NOT_READY', {
        cause: new Error('系统凭证加密当前不可用'),
      });
    }
  }

  private async enqueueWrite(
    update: (
      current: Readonly<Record<string, string>>,
    ) => Readonly<Record<string, string>>,
  ): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const normalized = Object.freeze({ ...update(this.secrets) });
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFileAtomic(
        this.filePath,
        `${JSON.stringify({ version: 1, secrets: normalized }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      this.secrets = normalized;
    });

    this.writeQueue = task.catch(() => undefined);
    await task;
  }
}
