import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
          (item) =>
            item.projectId === projectId && item.assetId === assetId,
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
      { get: vi.fn(() => asset) } as never,
    );
    const monitor = new LearningOutlineBriefMonitor(
      { get: vi.fn(() => asset) } as never,
      realAttachments,
      { prepare: vi.fn(async () => directory) } as never,
    );

    await monitor.start('project-1', 'outline-1');
    await new Promise((resolve) => setTimeout(resolve, 120));

    const first = [...stored.values()][0];
    expect(first).toMatchObject({
      typeId: LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE,
      typeVersion: LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION,
    });
    expect(first?.content).toBeDefined();

    const readyBrief = {
      ...createEmptyLearningBrief(),
      readiness: 'ready' as const,
      readinessNote: '可以开始生成。',
    };
    await writeFile(
      join(directory, 'learning-brief.json'),
      `${JSON.stringify(readyBrief)}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 160));

    expect(stored.size).toBe(1);
    expect(monitor.getState('outline-1')).toMatchObject({
      valid: true,
      ready: true,
    });
    await monitor.shutdown();
  });
});
