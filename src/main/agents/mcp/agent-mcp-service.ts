import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { requireAgentCapabilityId } from '../capabilities/agent-capability-id';
import { AppError } from '../../errors/app-error';
import {
  cloneAgentMcpServerDefinition,
  isAgentMcpServerDefinition,
  type AgentMcpServerDefinition,
} from './agent-mcp-server';

const manifestFormat = 'learning-companion/agent-mcp-server';
const manifestSchemaVersion = 1;

interface AgentMcpServerManifest {
  readonly format: typeof manifestFormat;
  readonly schemaVersion: typeof manifestSchemaVersion;
  readonly definition: AgentMcpServerDefinition;
}

export interface AgentMcpServerLookup {
  get(id: string): Promise<AgentMcpServerDefinition | undefined>;
}

export interface AgentMcpServiceApi extends AgentMcpServerLookup {
  initialize(): Promise<void>;
  register(
    definition: AgentMcpServerDefinition,
  ): Promise<AgentMcpServerDefinition>;
  replace(
    definition: AgentMcpServerDefinition,
  ): Promise<AgentMcpServerDefinition>;
  list(): Promise<readonly AgentMcpServerDefinition[]>;
  remove(id: string): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function canonicalDefinition(definition: AgentMcpServerDefinition): string {
  return JSON.stringify(definition);
}

export class AgentMcpService implements AgentMcpServiceApi {
  private readonly rootPath: string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(rootPath: string) {
    if (!isAbsolute(rootPath)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.rootPath = resolve(rootPath);
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true });
  }

  register(
    definition: AgentMcpServerDefinition,
  ): Promise<AgentMcpServerDefinition> {
    return this.runExclusive(async () => {
      const cloned = cloneAgentMcpServerDefinition(definition);
      const existing = await this.get(cloned.id);

      if (existing) {
        if (canonicalDefinition(existing) === canonicalDefinition(cloned)) {
          return existing;
        }
        throw new AppError('REGISTRATION_CONFLICT');
      }

      await this.write(cloned);
      return cloned;
    });
  }

  replace(
    definition: AgentMcpServerDefinition,
  ): Promise<AgentMcpServerDefinition> {
    return this.runExclusive(async () => {
      const cloned = cloneAgentMcpServerDefinition(definition);
      await this.write(cloned);
      return cloned;
    });
  }

  async get(id: string): Promise<AgentMcpServerDefinition | undefined> {
    const normalizedId = requireAgentCapabilityId(id);

    try {
      const value: unknown = JSON.parse(
        await readFile(this.resolveManifest(normalizedId), 'utf8'),
      );

      if (
        !isRecord(value) ||
        value.format !== manifestFormat ||
        value.schemaVersion !== manifestSchemaVersion ||
        !isAgentMcpServerDefinition(value.definition)
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const definition = cloneAgentMcpServerDefinition(value.definition);

      if (definition.id !== normalizedId) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return definition;
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async list(): Promise<readonly AgentMcpServerDefinition[]> {
    await this.initialize();
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    const definitions: AgentMcpServerDefinition[] = [];

    for (const entry of entries
      .filter(
        (candidate) =>
          candidate.isFile() &&
          candidate.name.endsWith('.json') &&
          !candidate.name.startsWith('.'),
      )
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const definition = await this.get(entry.name.slice(0, -'.json'.length));

      if (definition) {
        definitions.push(definition);
      }
    }

    return Object.freeze(definitions);
  }

  remove(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const path = this.resolveManifest(requireAgentCapabilityId(id));

      try {
        await stat(path);
      } catch (error) {
        if (isMissingFile(error)) {
          return false;
        }
        throw error;
      }

      await rm(path, { force: true });
      return true;
    });
  }

  private async write(definition: AgentMcpServerDefinition): Promise<void> {
    await this.initialize();
    const manifest: AgentMcpServerManifest = Object.freeze({
      format: manifestFormat,
      schemaVersion: manifestSchemaVersion,
      definition,
    });
    await writeFileAtomic(
      this.resolveManifest(definition.id),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      { encoding: 'utf8' },
    );
  }

  private resolveManifest(id: string): string {
    return join(this.rootPath, `${id}.json`);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
