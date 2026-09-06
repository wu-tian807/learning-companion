import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptyLearningBrief,
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
  LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
} from '../shared';
import { createProjectWorkspaceContentRef } from '../../../shared/assets';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { AttachmentRegistry } from '../../../main/attachments/attachment-registry';
import type { AttachmentContentFile } from '../../../main/attachments/attachment-content-file';
import type { AttachmentDatabaseApi } from '../../../main/attachments/attachment-database';
import { AttachmentService } from '../../../main/attachments/attachment-service';
import { AssetTargetRegistry } from '../../../main/workbench/asset-target-registry';
import { registerMainWorkbenchAttachments } from '../../catalog/register-main-workbenches';
import { LearningOutlineBriefMonitor } from './learning-outline-brief-monitor';

function completeBrief() {
  return { ...createEmptyLearningBrief(), goal: '读懂论文', currentLevel: '有基础',
    difficulties: '暂无', constraints: '每周两天', preferences: '实践', scope: '核心方法',
    roadmap: [{ id: 'week-1', title: '基础与方法' }],
    readiness: 'ready' as const, readinessNote: '可以开始生成。' };
}

describe('LearningOutlineBriefMonitor', () => {
  const temporaryDirectories: string[] = [];
  const monitors: LearningOutlineBriefMonitor[] = [];

  afterEach(async () => {
    await Promise.all(monitors.splice(0).map(async (monitor) => {
      await monitor.shutdown();
      monitor.dispose();
    }));
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it.runIf(process.platform === 'win32')('observes rewrites through a Windows 8.3 workspace path without aborting', async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-short-path-'));
    temporaryDirectories.push(directory);
    const shortDirectory = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:LC_TEST_SHORT_PATH).ShortPath',
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, LC_TEST_SHORT_PATH: directory },
    }).trim();
    if (shortDirectory.toLowerCase() === (await realpath(directory)).toLowerCase()) {
      context.skip(); // The test volume does not provide 8.3 aliases.
      return;
    }
    const asset = {
      id: 'outline-1', projectId: 'project-1',
      mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
    };
    const monitor = new LearningOutlineBriefMonitor(
      { get: vi.fn(() => asset) } as never,
      {
        listByAsset: vi.fn(async () => []),
        createWithContent: vi.fn(async () => ({ updatedTime: 42 })),
      } as never,
      { prepare: vi.fn(async () => shortDirectory) } as never,
    );
    monitors.push(monitor);
    await monitor.start(asset.projectId, asset.id);
    await monitor.flush(asset.id);
    await writeFile(join(directory, 'learning-brief.json'), JSON.stringify({
      ...completeBrief(),
    }));
    // No flush here: this assertion must be driven by the actual native watcher.
    await vi.waitFor(() => expect(monitor.getState(asset.id)).toMatchObject({
      valid: true, ready: true,
    }));
  });

  it('restores a snapshot, observes a valid rewrite, and releases the watcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-'));
    temporaryDirectories.push(directory);
    const createWithContent = vi.fn(async () => ({ updatedTime: 42 }));
    const assets = {
      get: vi.fn((projectId: string, assetId: string) =>
        projectId === 'project-1' && assetId === 'outline-1'
          ? {
              id: assetId,
              projectId,
              mediaType: 'application/vnd.learning-companion.learning-outline',
            }
          : undefined,
      ),
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

    monitors.push(monitor);
    const workspace = await monitor.ensureWorkspace('project-1', 'outline-1');
    expect(workspace).toBe(directory);
    await expect(
      readFile(join(directory, 'learning-brief.json'), 'utf8'),
    ).resolves.toContain('learning-companion/learning-brief');

    const events: unknown[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.start('project-1', 'outline-1');
    await writeFile(
      join(directory, 'learning-brief.json'),
      `${JSON.stringify(createEmptyLearningBrief())}\n`,
    );
    await vi.waitFor(() => expect(monitor.getState('outline-1').valid).toBe(true));

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

  it('persists snapshots through the registered real Attachment type', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-real-'));
    temporaryDirectories.push(directory);
    const stored = new Map<string, AssetAttachment>();
    const database: AttachmentDatabaseApi = {
      get: (id) => stored.get(id),
      listByProject: (projectId) =>
        [...stored.values()].filter((item) => item.projectId === projectId),
      listByAsset: (projectId, assetId) =>
        [...stored.values()].filter(
          (item) => item.projectId === projectId && item.assetId === assetId,
        ),
      create: (attachment) => {
        stored.set(attachment.id, attachment);
        return attachment;
      },
      update: (attachment) => {
        stored.set(attachment.id, attachment);
        return attachment;
      },
      delete: (id) => {
        stored.delete(id);
      },
    };
    const attachmentRegistry = new AttachmentRegistry();
    registerMainWorkbenchAttachments({ attachments: attachmentRegistry });
    const contentFiles = {
      write: vi.fn(async ({ attachmentId, fileName, mediaType }) => ({
        ref: createProjectWorkspaceContentRef(
          `.learning-companion/attachments/${attachmentId}/${fileName}`,
        ),
        mediaType,
      })),
      removeContent: vi.fn(async () => undefined),
      removeAttachment: vi.fn(async () => undefined),
    } as unknown as AttachmentContentFile;
    const asset = {
      id: 'outline-1',
      projectId: 'project-1',
      mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
    };
    const realAttachments = new AttachmentService(
      database,
      attachmentRegistry,
      new AssetTargetRegistry(),
      contentFiles,
      {
        get: vi.fn((projectId: string, assetId: string) =>
          projectId === asset.projectId && assetId === asset.id
            ? asset
            : undefined,
        ),
      } as never,
    );
    const monitor = new LearningOutlineBriefMonitor(
      {
        get: vi.fn((projectId: string, assetId: string) =>
          projectId === asset.projectId && assetId === asset.id
            ? asset
            : undefined,
        ),
      } as never,
      realAttachments,
      { prepare: vi.fn(async () => directory) } as never,
    );

    monitors.push(monitor);
    await monitor.start('project-1', 'outline-1');
    await vi.waitFor(() => expect(monitor.getState('outline-1').valid).toBe(true));

    const first = [...stored.values()][0];
    expect(first).toMatchObject({
      typeId: LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
      typeVersion: LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
    });
    expect(first?.content).toBeDefined();

    const readyBrief = {
      ...completeBrief(),
      readiness: 'ready' as const,
      readinessNote: '可以开始生成。',
    };
    await writeFile(
      join(directory, 'learning-brief.json'),
      `${JSON.stringify(readyBrief)}\n`,
    );
    await vi.waitFor(() => expect(monitor.getState('outline-1').ready).toBe(true));

    expect(stored.size).toBe(1);
    expect(monitor.getState('outline-1')).toMatchObject({
      valid: true,
      ready: true,
    });
    await monitor.shutdown();
  });

  it('flushes a debounced rewrite during shutdown', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-flush-'));
    temporaryDirectories.push(directory);
    const createWithContent = vi.fn(async () => ({ updatedTime: 42 }));
    const asset = {
      id: 'outline-1',
      projectId: 'project-1',
      mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
    };
    const monitor = new LearningOutlineBriefMonitor(
      {
        get: vi.fn((projectId: string, assetId: string) =>
          projectId === asset.projectId && assetId === asset.id
            ? asset
            : undefined,
        ),
      } as never,
      {
        listByAsset: vi.fn(async () => []),
        readTextContent: vi.fn(async () => undefined),
        createWithContent,
        updateWithContent: vi.fn(),
      } as never,
      { prepare: vi.fn(async () => directory) } as never,
    );

    monitors.push(monitor);
    await monitor.start('project-1', 'outline-1');
    await monitor.shutdown();

    expect(createWithContent).toHaveBeenCalledOnce();
  });

  it('keeps the last valid brief visible when a rewrite is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-brief-invalid-'));
    temporaryDirectories.push(directory);
    const asset = {
      id: 'outline-1',
      projectId: 'project-1',
      mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
    };
    const monitor = new LearningOutlineBriefMonitor(
      {
        get: vi.fn((projectId: string, assetId: string) =>
          projectId === asset.projectId && assetId === asset.id
            ? asset
            : undefined,
        ),
      } as never,
      {
        listByAsset: vi.fn(async () => []),
        readTextContent: vi.fn(async () => undefined),
        createWithContent: vi.fn(async () => ({ updatedTime: 42 })),
        updateWithContent: vi.fn(),
      } as never,
      { prepare: vi.fn(async () => directory) } as never,
    );

    monitors.push(monitor);
    await monitor.start('project-1', 'outline-1');
    await monitor.flush('outline-1');
    const validState = monitor.getState('outline-1');
    await writeFile(join(directory, 'learning-brief.json'), '{ invalid');
    await monitor.flush('outline-1');

    expect(monitor.getState('outline-1')).toMatchObject({
      valid: false,
      revision: validState.revision,
      brief: validState.brief,
      error: '学习需求 JSON 格式无效。',
    });
    await monitor.shutdown();
  });

  it('gates premature readiness, reports exact schema errors and retains optional detail across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-outline-completion-'));
    temporaryDirectories.push(directory);
    const asset = { id: 'outline-1', projectId: 'project-1', mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE };
    const makeMonitor = () => {
      const monitor = new LearningOutlineBriefMonitor(
        { get: () => asset } as never,
        { listByAsset: async () => [], createWithContent: async () => ({ updatedTime: 42 }) } as never,
        { prepare: async () => directory } as never,
      );
      monitors.push(monitor);
      return monitor;
    };
    const monitor = makeMonitor();
    await monitor.start(asset.projectId, asset.id);
    const file = join(directory, 'learning-brief.json');
    await writeFile(file, JSON.stringify({ ...completeBrief(), difficulties: '' }));
    await monitor.flush(asset.id);
    expect(monitor.getState(asset.id)).toMatchObject({ valid: true, ready: false });
    const completed = { ...completeBrief(), detailed: '我还希望有例子。' };
    await writeFile(file, JSON.stringify(completed));
    await monitor.flush(asset.id);
    const revision = monitor.getState(asset.id).revision;
    await writeFile(file, JSON.stringify({ ...completed, roadmap: [{ chapter: '第 1 周', outcomes: '读懂基础' }] }));
    await monitor.flush(asset.id);
    expect(monitor.getState(asset.id)).toMatchObject({ valid: false, revision,
      brief: { detailed: '我还希望有例子。' } });
    expect(monitor.getState(asset.id).error).toContain('roadmap[0].id');
    expect(monitor.getState(asset.id).error).toContain('roadmap[0].title');
    expect(monitor.getState(asset.id).ready).toBeUndefined();
    await writeFile(file, JSON.stringify(completed));
    await monitor.shutdown();
    const restarted = makeMonitor();
    await restarted.start(asset.projectId, asset.id);
    await restarted.flush(asset.id);
    expect(restarted.getState(asset.id)).toMatchObject({ valid: true, ready: true,
      brief: { detailed: '我还希望有例子。' } });
  });
});
