import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExternalCommandRunner } from './external-command-runner';

const temporaryDirectories: string[] = [];
const trackedPids = new Set<number>();

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return;
  }

  const systemRoot =
    process.env.SystemRoot?.trim() || process.env.WINDIR?.trim();

  if (!systemRoot || !win32.isAbsolute(systemRoot)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const taskkill = spawn(
      win32.join(systemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'],
      {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    taskkill.once('error', () => resolve());
    taskkill.once('close', () => resolve());
  });
}

afterEach(async () => {
  await Promise.all(
    [...trackedPids].map((pid) => terminateProcessTree(pid)),
  );
  trackedPids.clear();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe.runIf(process.platform === 'win32')(
  'ExternalCommandRunner Windows process-tree integration',
  () => {
    it(
      'does not release until both the parent and its child are terminated',
      async () => {
        const directory = await mkdtemp(
          join(tmpdir(), 'learning-companion-process-tree-'),
        );
        temporaryDirectories.push(directory);
        const processInfoPath = join(directory, 'processes.json');
        const heartbeatPath = join(directory, 'heartbeat');
        const childCode = [
          'const fs = require("node:fs");',
          'const heartbeatPath = process.argv[1];',
          'const beat = () => fs.writeFileSync(heartbeatPath, String(Date.now()));',
          'beat();',
          'setInterval(beat, 25);',
        ].join('\n');
        const parentCode = [
          'const fs = require("node:fs");',
          'const { spawn } = require("node:child_process");',
          `const childCode = ${JSON.stringify(childCode)};`,
          'const child = spawn(process.execPath, ["-e", childCode, process.argv[2]], {',
          '  windowsHide: true,',
          '  stdio: "ignore",',
          '});',
          'fs.writeFileSync(process.argv[1], JSON.stringify({',
          '  parentPid: process.pid,',
          '  childPid: child.pid,',
          '}));',
          'setInterval(() => {}, 1000);',
        ].join('\n');
        const controller = new AbortController();
        const runner = new ExternalCommandRunner();
        const result = runner.run({
          command: process.execPath,
          args: [
            '-e',
            parentCode,
            processInfoPath,
            heartbeatPath,
          ],
          timeoutMs: 10_000,
          signal: controller.signal,
        });
        let parentPid = 0;
        let childPid = 0;

        await expect
          .poll(async () => {
            try {
              const info = JSON.parse(
                await readFile(processInfoPath, 'utf8'),
              ) as {
                parentPid: number;
                childPid: number;
              };
              parentPid = info.parentPid;
              childPid = info.childPid;
              return (
                Number.isSafeInteger(parentPid) &&
                Number.isSafeInteger(childPid) &&
                parentPid > 0 &&
                childPid > 0
              );
            } catch {
              return false;
            }
          })
          .toBe(true);
        trackedPids.add(parentPid);
        trackedPids.add(childPid);
        await expect
          .poll(() =>
            stat(heartbeatPath)
              .then(() => true)
              .catch(() => false),
          )
          .toBe(true);

        controller.abort();

        await expect(result).rejects.toMatchObject({
          name: 'AbortError',
        });
        await expect
          .poll(() => isProcessAlive(parentPid))
          .toBe(false);
        await expect
          .poll(() => isProcessAlive(childPid))
          .toBe(false);
      },
      15_000,
    );
  },
);
