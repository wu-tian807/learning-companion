import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type writeFileAtomic from 'write-file-atomic';

import { GenerationTask } from '../generation-task';
import { GenerationPreparedManifestFile } from './generation-prepared-manifest-file';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createTask(id: string) {
  return GenerationTask.create({
    id,
    projectId: 'project-1',
    definitionId: 'html.assistant',
    definitionVersion: 1,
    instruction: {
      format: 'learning-companion/html-assistant-instruction',
      version: 1,
      conversationId: 'conv-1',
      question: '问题 ' + id,
    },
    assetReferences: { sources: [{ assetId: 'asset-1' }] },
    createdTime: 10,
  }).getSnapshot();
}

function references(assetId: string) {
  return Object.freeze({
    sources: Object.freeze([
      Object.freeze({
        alias: 'sources-0001',
        assetId,
        name: 'lesson.html',
        mediaType: 'text/html',
        contentRevision: 'revision-1',
        relativePath: 'references/sources-0001/source.html',
      }),
    ]),
  });
}

describe('GenerationPreparedManifestFile', () => {
  it('writes task-local control files and reads them back consistently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-manifest-'));
    temporaryDirectories.push(directory);
    const workspace = join(directory, 'workspace');
    const file = new GenerationPreparedManifestFile();
    const task = createTask('task-a');

    const written = await file.write(workspace, task, references('asset-1'));
    expect(written.taskId).toBe('task-a');
    expect(written.assetReferences.sources[0]?.assetId).toBe('asset-1');

    // 三个 control 文件都落在 taskId 隔离目录下
    for (const name of ['instruction.json', 'asset-references.json', 'prepared-manifest.json']) {
      await expect(
        readFile(join(workspace, 'control', 'tasks', 'task-a', name), 'utf8'),
      ).resolves.toBeTruthy();
    }
    await expect(
      readFile(join(workspace, 'control', 'prepared-manifest.json'), 'utf8'),
    ).rejects.toThrow();

    // 读回 = 写入内容（含 instruction 原文）
    const restored = await file.read(
      workspace,
      'control/tasks/task-a/prepared-manifest.json',
      task,
    );
    expect(restored).toEqual(written);
    expect(
      JSON.parse(
        await readFile(join(workspace, 'control', 'tasks', 'task-a', 'instruction.json'), 'utf8'),
      ),
    ).toMatchObject({ conversationId: 'conv-1', question: '问题 task-a' });
  });

  it('重复写入幂等：同 taskId 覆盖旧内容，其他 task 不受影响', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-manifest-'));
    temporaryDirectories.push(directory);
    const workspace = join(directory, 'workspace');
    const file = new GenerationPreparedManifestFile();
    const task = createTask('task-a');

    await file.write(workspace, task, references('asset-1'));
    // 模拟 asset reference 变化后的第二次 prepare：同 taskId 覆盖
    await file.write(workspace, task, references('asset-2'));

    const restored = await file.read(
      workspace,
      'control/tasks/task-a/prepared-manifest.json',
      task,
    );
    expect(restored.assetReferences.sources[0]?.assetId).toBe('asset-2');

    // 另一个 task 写入后，第一个 task 的 manifest 仍在（互不覆盖）
    await file.write(workspace, createTask('task-b'), references('asset-1'));
    const restoredA = await file.read(
      workspace,
      'control/tasks/task-a/prepared-manifest.json',
      task,
    );
    expect(restoredA.assetReferences.sources[0]?.assetId).toBe('asset-2');
  });

  it('read 校验身份：taskId/projectId/definition 不匹配时拒绝', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-manifest-'));
    temporaryDirectories.push(directory);
    const workspace = join(directory, 'workspace');
    const file = new GenerationPreparedManifestFile();
    await file.write(workspace, createTask('task-a'), references('asset-1'));

    // 用错误的 taskId 读 → 拒绝（防止同 workspace 串读）
    await expect(
      file.read(
        workspace,
        'control/tasks/task-a/prepared-manifest.json',
        createTask('task-b'),
      ),
    ).rejects.toThrow('Generation prepared manifest 数据无效');
    // projectId 不匹配 → 拒绝
    const foreignTask = {
      ...createTask('task-a'),
      projectId: 'project-2',
    };
    await expect(
      file.read(
        workspace,
        'control/tasks/task-a/prepared-manifest.json',
        foreignTask,
      ),
    ).rejects.toThrow('Generation prepared manifest 数据无效');
  });

  it('write 中途失败：已写文件可重跑，不留半截 manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generation-manifest-'));
    temporaryDirectories.push(directory);
    const workspace = join(directory, 'workspace');
    const failing = new GenerationPreparedManifestFile({
      // 第二次写（asset-references.json）失败，模拟中断
      writeFileAtomic: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() =>
          Promise.reject(new Error('simulated disk failure')),
        ) as unknown as typeof writeFileAtomic,
    });
    const task = createTask('task-a');

    await expect(
      failing.write(workspace, task, references('asset-1')),
    ).rejects.toThrow('simulated disk failure');

    // 重跑成功：覆盖所有文件，最终内容一致（幂等恢复）
    const file = new GenerationPreparedManifestFile();
    const written = await file.write(workspace, task, references('asset-1'));
    const restored = await file.read(
      workspace,
      'control/tasks/task-a/prepared-manifest.json',
      task,
    );
    expect(restored).toEqual(written);
  });
});
