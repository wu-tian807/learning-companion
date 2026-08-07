import { randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { requireAgentCapabilityId } from '../capabilities/agent-capability-id';
import { AppError } from '../../errors/app-error';
import type {
  AgentSkillDefinition,
  InstallAgentSkillInput,
} from './agent-skill';
import {
  parseAgentSkillFrontmatter,
  requireAgentSkillVersion,
} from './agent-skill';

const registrationFileName = 'learning-companion-skill.json';
const skillFileName = 'SKILL.md';
const registrationFormat = 'learning-companion/agent-skill';
const registrationSchemaVersion = 1;

interface AgentSkillRegistration {
  readonly format: typeof registrationFormat;
  readonly schemaVersion: typeof registrationSchemaVersion;
  readonly id: string;
  readonly version: number;
}

export interface AgentSkillLookup {
  get(id: string): Promise<AgentSkillDefinition | undefined>;
}

export interface AgentSkillServiceApi extends AgentSkillLookup {
  initialize(): Promise<void>;
  install(input: InstallAgentSkillInput): Promise<AgentSkillDefinition>;
  list(): Promise<readonly AgentSkillDefinition[]>;
  remove(id: string): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return (
    isRecord(error) &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export class AgentSkillService implements AgentSkillServiceApi {
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

  install(input: InstallAgentSkillInput): Promise<AgentSkillDefinition> {
    return this.runExclusive(async () => {
      const id = requireAgentCapabilityId(input.id);
      const version = requireAgentSkillVersion(input.version);

      if (!isAbsolute(input.sourceDirectory)) {
        throw new AppError('INVALID_EXTENSION_DEFINITION');
      }

      const sourceDirectory = resolve(input.sourceDirectory);
      await this.readSkillFile(sourceDirectory, id);
      await this.initialize();
      const nonce = randomUUID();
      const stagingPath = join(this.rootPath, `.${id}.${nonce}.staging`);
      const backupPath = join(this.rootPath, `.${id}.${nonce}.backup`);
      const targetPath = join(this.rootPath, id);
      let movedExisting = false;
      let preserveBackup = false;

      try {
        await cp(sourceDirectory, stagingPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        await writeFileAtomic(
          join(stagingPath, registrationFileName),
          `${JSON.stringify(
            {
              format: registrationFormat,
              schemaVersion: registrationSchemaVersion,
              id,
              version,
            } satisfies AgentSkillRegistration,
            undefined,
            2,
          )}\n`,
          { encoding: 'utf8' },
        );

        if (await this.pathExists(targetPath)) {
          await rename(targetPath, backupPath);
          movedExisting = true;
        }

        await rename(stagingPath, targetPath);
        const installed = await this.readInstalledSkill(targetPath, id);

        if (movedExisting) {
          await rm(backupPath, { recursive: true, force: true });
          movedExisting = false;
        }

        return installed;
      } catch (error) {
        if (movedExisting) {
          try {
            if (await this.pathExists(targetPath)) {
              await rm(targetPath, { recursive: true, force: true });
            }
            await rename(backupPath, targetPath);
            movedExisting = false;
          } catch {
            preserveBackup = true;
          }
        }
        throw error;
      } finally {
        await rm(stagingPath, { recursive: true, force: true }).catch(
          () => undefined,
        );
        if (!preserveBackup) {
          await rm(backupPath, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }
    });
  }

  async get(id: string): Promise<AgentSkillDefinition | undefined> {
    const normalizedId = requireAgentCapabilityId(id);

    try {
      return await this.readInstalledSkill(
        join(this.rootPath, normalizedId),
        normalizedId,
      );
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async list(): Promise<readonly AgentSkillDefinition[]> {
    await this.initialize();
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    const skills: AgentSkillDefinition[] = [];

    for (const entry of entries
      .filter((candidate) => candidate.isDirectory() && !candidate.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const skill = await this.get(entry.name);

      if (skill) {
        skills.push(skill);
      }
    }

    return Object.freeze(skills);
  }

  remove(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const normalizedId = requireAgentCapabilityId(id);
      const targetPath = join(this.rootPath, normalizedId);

      if (!(await this.pathExists(targetPath))) {
        return false;
      }

      await rm(targetPath, { recursive: true, force: true });
      return true;
    });
  }

  private async readInstalledSkill(
    directoryPath: string,
    expectedId: string,
  ): Promise<AgentSkillDefinition> {
    const registrationValue: unknown = JSON.parse(
      await readFile(join(directoryPath, registrationFileName), 'utf8'),
    );

    if (
      !isRecord(registrationValue) ||
      registrationValue.format !== registrationFormat ||
      registrationValue.schemaVersion !== registrationSchemaVersion ||
      registrationValue.id !== expectedId ||
      typeof registrationValue.version !== 'number'
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const version = requireAgentSkillVersion(registrationValue.version);
    const frontmatter = await this.readSkillFile(directoryPath, expectedId);

    return Object.freeze({
      id: expectedId,
      version,
      description: frontmatter.description,
      directoryPath,
      skillFilePath: join(directoryPath, skillFileName),
    });
  }

  private async readSkillFile(directoryPath: string, expectedId: string) {
    const skillPath = join(directoryPath, skillFileName);
    const metadata = await stat(skillPath);

    if (!metadata.isFile()) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    const frontmatter = parseAgentSkillFrontmatter(
      await readFile(skillPath, 'utf8'),
    );

    if (frontmatter.name !== expectedId) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }

    return frontmatter;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }
      throw error;
    }
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
