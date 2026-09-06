import { createAssetSnapshot } from '../../../main/assets/asset';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { createProjectWorkspaceContentRef } from '../../../shared/assets';
import { AttachmentContentFile } from '../../../main/attachments/attachment-content-file';
import type { AttachmentDatabaseApi } from '../../../main/attachments/attachment-database';
import { AttachmentRegistry } from '../../../main/attachments/attachment-registry';
import { AttachmentService } from '../../../main/attachments/attachment-service';
import { AssetTargetRegistry } from '../../../main/workbench/asset-target-registry';
import { WorkbenchActionRegistry } from '../../../main/workbench/workbench-action-registry';
import { LearningOutlineService } from '../service/learning-outline-service';
import { LearningOutlineWorkbenchProvider } from '../main';
import { learningOutlineMainWorkbenchContribution } from '../main-contribution';
import { registerMainWorkbenchAttachments } from '../../catalog/register-main-workbenches';
import { createEmptyLearningBrief, LEARNING_OUTLINE_ASSET_MEDIA_TYPE, learningOutlineActions } from '../shared';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lc-brief-recovery-'));
  const asset = createAssetSnapshot({ id: 'outline-1', projectId: 'project-1', name: 'Test',
    mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE, creationKind: 'generated',
    contentRef: createProjectWorkspaceContentRef('outline.outline'), createdTime: 1, updatedTime: 1 });
  let deleted = false;
  const assets = { get: (projectId: string, assetId: string) =>
    !deleted && projectId === asset.projectId && assetId === asset.id ? asset : undefined };
  const stored = new Map<string, AssetAttachment>();
  const database: AttachmentDatabaseApi = {
    get: (id) => stored.get(id),
    listByProject: (id) => [...stored.values()].filter((item) => item.projectId === id),
    listByAsset: (projectId, assetId) => [...stored.values()].filter((item) => item.projectId === projectId && item.assetId === assetId),
    create: (item) => { stored.set(item.id, item); return item; },
    update: (item) => { stored.set(item.id, item); return item; },
    delete: (id) => { stored.delete(id); },
  };
  const registry = new AttachmentRegistry();
  registerMainWorkbenchAttachments({ attachments: registry });
  const projects = { get: (id: string) => ({ id, name: 'Test', icon: '📘', pinned: false, createdTime: 1, workspacePath: directory }) };
  const files = new AttachmentContentFile(projects);
  const attachments = new AttachmentService(database, registry, new AssetTargetRegistry(), files, assets);
  const services: LearningOutlineService[] = [];
  const makeService = () => {
    const service = new LearningOutlineService({} as never, assets, attachments, {} as never,
      projects, {} as never, { prepare: async () => directory } as never);
    services.push(service);
    return service;
  };
  const file = join(directory, 'learning-brief.json');
  cleanups.push(async () => {
    for (const service of services) { await service.shutdown(); service.dispose(); }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, file, makeService, stored, deleteAsset: () => { deleted = true; } };
}

it('rejects cross-project action reads before, during and after cached startup, and after Asset deletion', async () => {
  const f = await fixture();
  const service = f.makeService();
  const actions = new WorkbenchActionRegistry();
  learningOutlineMainWorkbenchContribution.registerActions?.({ actions, provider: new LearningOutlineWorkbenchProvider(service) });
  const read = (projectId: string) => actions.invoke(learningOutlineActions.getBriefState, projectId, { assetId: 'outline-1' });
  await expect(read('project-2')).rejects.toThrow('不属于当前项目');
  const starting = read('project-1');
  await expect(read('project-2')).rejects.toThrow('不属于当前项目');
  await expect(starting).resolves.toMatchObject({ valid: true });
  await expect(read('project-2')).rejects.toThrow('不属于当前项目');
  f.deleteAsset();
  await expect(read('project-1')).rejects.toThrow('不存在');
});

it.each(['invalid', 'missing'] as const)('recovers the last verified Attachment after restart with a %s working copy', async (workingCopy) => {
  const f = await fixture();
  const first = f.makeService();
  await first.readBriefState('project-1', 'outline-1');
  const brief = { ...createEmptyLearningBrief(), goal: '已确认的学习目标', detailed: '额外说明' };
  await writeFile(f.file, JSON.stringify(brief));
  const saved = await first.readBriefState('project-1', 'outline-1');
  await first.shutdown(); first.dispose();
  if (workingCopy === 'invalid') await writeFile(f.file, '{ invalid');
  else await rm(f.file);
  const restarted = f.makeService();
  const state = await restarted.readBriefState('project-1', 'outline-1');
  expect(state).toMatchObject({ valid: workingCopy === 'missing', brief, revision: saved.revision, updatedTime: saved.updatedTime });
  if (workingCopy === 'invalid') {
    expect(state.ready).toBeUndefined();
    await expect(readFile(f.file, 'utf8')).resolves.toBe('{ invalid');
  }
});

it.each(['missing', 'malformed', 'revision-mismatch'] as const)('repairs a %s saved snapshot from a valid working copy', async (damage) => {
  const f = await fixture();
  const first = f.makeService();
  const valid = await first.readBriefState('project-1', 'outline-1');
  await first.shutdown(); first.dispose();
  const snapshot = [...f.stored.values()][0]!;
  const snapshotFile = join(f.directory, snapshot.content!.ref.path);
  if (damage === 'missing') await rm(snapshotFile);
  else await writeFile(snapshotFile, damage === 'malformed' ? '{invalid' : JSON.stringify({ ...valid.brief, goal: 'tampered' }));
  const restarted = f.makeService();
  expect(await restarted.readBriefState('project-1', 'outline-1')).toMatchObject({ valid: true, brief: valid.brief });
  const repaired = [...f.stored.values()][0]!;
  expect(JSON.parse(await readFile(join(f.directory, repaired.content!.ref.path), 'utf8'))).toEqual(valid.brief);
});

it('never presents an unverified snapshot as the last valid brief', async () => {
  const f = await fixture();
  const first = f.makeService();
  await first.readBriefState('project-1', 'outline-1');
  await first.shutdown(); first.dispose();
  const snapshot = [...f.stored.values()][0]!;
  await writeFile(join(f.directory, snapshot.content!.ref.path), '{invalid');
  await writeFile(f.file, '{invalid');
  const restarted = f.makeService();
  const state = await restarted.readBriefState('project-1', 'outline-1');
  expect(state.valid).toBe(false);
  expect(state.brief).toBeUndefined();
});
