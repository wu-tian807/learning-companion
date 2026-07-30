import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { ExternalProcessTerminator } from './external-process-terminator';

function createChild(pid = 1234): ChildProcess {
  return {
    pid,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  } as unknown as ChildProcess;
}

describe('ExternalProcessTerminator', () => {
  it('uses graceful and forceful signals on POSIX', () => {
    const child = createChild();
    const terminator = new ExternalProcessTerminator({
      platform: 'darwin',
    });

    terminator.terminate(child, false);
    terminator.terminate(child, true);

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('uses the absolute Windows taskkill executable for a process tree', () => {
    const child = createChild(4321);
    const taskkill = new EventEmitter() as ChildProcess;
    const spawnProcess = vi.fn(() => taskkill);
    const terminator = new ExternalProcessTerminator({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      spawnProcess,
    });

    terminator.terminate(child, false);

    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4321', '/T', '/F'],
      {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to direct forceful termination when taskkill fails', () => {
    const child = createChild();
    const taskkill = new EventEmitter() as ChildProcess;
    const terminator = new ExternalProcessTerminator({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      spawnProcess: () => taskkill,
    });

    terminator.terminate(child, false);
    taskkill.emit('error', new Error('taskkill unavailable'));

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
