import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentSkillService } from './agent-skill-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createSource(
  root: string,
  name: string,
  description: string,
): Promise<string> {
  const source = join(root, `source-${name}`);
  await mkdir(join(source, 'references'), { recursive: true });
  await writeFile(
    join(source, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf8',
  );
  await writeFile(join(source, 'references', 'guide.md'), '# Guide\n', 'utf8');
  return source;
}

describe('AgentSkillService', () => {
  it('installs a complete skill directory and reads stable metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-skill-'));
    temporaryDirectories.push(directory);
    const service = new AgentSkillService(join(directory, 'capabilities'));
    const source = await createSource(
      directory,
      'pdf-reading',
      'Read PDF material efficiently.',
    );

    const installed = await service.install({
      id: 'pdf-reading',
      version: 1,
      sourceDirectory: source,
    });

    expect(installed).toEqual(
      expect.objectContaining({
        id: 'pdf-reading',
        version: 1,
        description: 'Read PDF material efficiently.',
      }),
    );
    await expect(
      readFile(join(installed.directoryPath, 'references', 'guide.md'), 'utf8'),
    ).resolves.toBe('# Guide\n');
    await expect(service.get('pdf-reading')).resolves.toEqual(installed);
    await expect(service.list()).resolves.toEqual([installed]);
  });

  it('atomically replaces an installed skill and can remove it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-skill-'));
    temporaryDirectories.push(directory);
    const service = new AgentSkillService(join(directory, 'capabilities'));
    const first = await createSource(directory, 'lesson-plan', 'Version one.');
    const secondRoot = join(directory, 'second');
    await mkdir(secondRoot);
    const second = await createSource(secondRoot, 'lesson-plan', 'Version two.');

    await service.install({ id: 'lesson-plan', version: 1, sourceDirectory: first });
    const replaced = await service.install({
      id: 'lesson-plan',
      version: 2,
      sourceDirectory: second,
    });

    expect(replaced.version).toBe(2);
    expect(replaced.description).toBe('Version two.');
    await expect(service.remove('lesson-plan')).resolves.toBe(true);
    await expect(service.remove('lesson-plan')).resolves.toBe(false);
    await expect(service.get('lesson-plan')).resolves.toBeUndefined();
  });

  it('rejects a directory whose frontmatter name does not match its id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-skill-'));
    temporaryDirectories.push(directory);
    const service = new AgentSkillService(join(directory, 'capabilities'));
    const source = await createSource(directory, 'actual-name', 'Mismatch.');

    await expect(
      service.install({ id: 'declared-name', version: 1, sourceDirectory: source }),
    ).rejects.toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
