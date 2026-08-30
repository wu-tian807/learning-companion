import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentFunctionToolRegistry } from '../../../main/agents/function-tools/agent-function-tool-registry';
import type {
  GenerationTaskServiceListener,
} from '../../../main/generation/generation-task-service';
import { HtmlAgentEditingService } from '../editing/html-agent-editing-service';
import { htmlAssistantMainFeature } from './main';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('HTML assistant Main lifecycle', () => {
  it('waits for an accepted GenerationTask settlement during shutdown', async () => {
    const recoveryDirectory = await mkdtemp(
      join(tmpdir(), 'html-assistant-main-'),
    );
    temporaryDirectories.push(recoveryDirectory);
    let finishSettlement: (() => void) | undefined;
    vi.spyOn(
      HtmlAgentEditingService.prototype,
      'handleTaskSnapshot',
    ).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSettlement = resolve;
        }),
    );
    let listener: GenerationTaskServiceListener | undefined;
    const unsubscribe = vi.fn();
    const generationTasks = {
      subscribe: vi.fn((next: GenerationTaskServiceListener) => {
        listener = next;
        return unsubscribe;
      }),
      get: vi.fn(),
    };

    htmlAssistantMainFeature.registerAgentFunctionTools({
      functionTools: new AgentFunctionToolRegistry(),
      assets: {} as never,
      recoveryDirectory,
    });
    const runtime = htmlAssistantMainFeature.start({
      generationTasks,
    } as never);
    listener?.({
      type: 'task-changed',
      snapshot: {
        id: 'task-1',
        projectId: 'project-1',
        completed: { completedTime: 2, result: {} },
        agentCalls: [],
      },
    } as never);

    let shutdownFinished = false;
    const shutdown = Promise.resolve(runtime.shutdown?.()).then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(shutdownFinished).toBe(false);

    finishSettlement?.();
    await shutdown;
    runtime.dispose();
  });
});
