import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyLearningBrief } from '../shared';
import { LearningOutlineBriefMonitor } from './learning-outline-brief-monitor';

describe('LearningOutlineBriefMonitor', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('restores a snapshot, observes a valid rewrite, and releases the watcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-'));
    temporaryDirectories.push(directory);
    const createWithContent = vi.fn(async () => ({ updatedTime: 42 }));
    const assets = {
      get: vi.fn(() => ({
        id: 'outline-1',
        projectId: 'project-1',
        mediaType: 'application/vnd.learning-companion.learning-outline',
      })),
    };
    const attachments = {
      listByAsset: vi.fn(async () => []),
      readTextContent: vi.fn(async () => undefined),
      createWithContent,
      updateWithContent: vi.fn(),
    };
    const workspaces = {
      prepare: vi.fn(async () => directory),
    };
    const monitor = new LearningOutlineBriefMonitor(
      assets as never,
      attachments as never,
      workspaces as never,
    );

    const workspace = await monitor.ensureWorkspace('project-1', 'outline-1');
    expect(workspace).toBe(directory);
    await expect(readFile(join(directory, 'learning-brief.json'), 'utf8'))
      .resolves.toContain('learning-companion/learning-brief');

    const events: unknown[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.start('project-1', 'outline-1');
    await writeFile(
      join(directory, 'learning-brief.json'),
      `${JSON.stringify(createEmptyLearningBrief())}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 160));

    expect(createWithContent).toHaveBeenCalledOnce();
    expect(monitor.getState('outline-1')).toMatchObject({
      valid: true,
      ready: false,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'brief-changed', assetId: 'outline-1' }),
    ]);

    await monitor.shutdown();
    monitor.dispose();
    expect(monitor.getState('outline-1')).toEqual({ valid: false });
  });
});
