import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTextRevision, type ResolvedTextContent } from '../../../main/content/text-content';
import { beginHtmlSourceEdit, replaceHtmlSourceEdit } from './html-source-editor';
import type { HtmlEditExecutionIdentity } from './html-edit-history';
import {
  createHtmlDraftRevision,
  HtmlEditingRecoveryError,
  HtmlEditingSessionFile,
} from './html-editing-session-file';
import { HtmlEditingSession } from './html-editing-session';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture(content = '<html><body><p>A</p></body></html>') {
  const root = await mkdtemp(join(tmpdir(), 'html-editing-session-'));
  directories.push(root);
  const files = new HtmlEditingSessionFile(root);
  const source: ResolvedTextContent = {
    content,
    encoding: 'utf-8',
    lineEnding: 'lf',
    hasByteOrderMark: false,
    revision: createTextRevision(new TextEncoder().encode(content)),
  };
  const session = await HtmlEditingSession.openOrCreate(
    files,
    'project-1',
    'asset-1',
    source,
  );
  return { root, files, source, session };
}

const identity = (executionId: string): HtmlEditExecutionIdentity => ({
  taskId: `task-${executionId}`,
  callKey: 'conversation',
  executionId,
});

async function replaceParagraph(
  session: HtmlEditingSession,
  execution: HtmlEditExecutionIdentity,
  replacement: string,
) {
  const edit = beginHtmlSourceEdit({
    source: session.getDraft(),
    locator: { kind: 'selector', selector: 'p' },
    scope: 'contents',
  });
  const replaced = replaceHtmlSourceEdit({ edit, replacement });
  await session.applyOperation({
    identity: execution,
    rangeStart: edit.range.start,
    beforeHtml: edit.currentHtml,
    afterHtml: replacement,
    beforeTarget: edit.resolvedTarget,
    afterTarget: replaced.resolvedTarget,
    nextDraft: replaced.source,
  });
}

describe('HTML editing recovery session', () => {
  it('stores multiple replacements in one execution as one undo step', async () => {
    const { session } = await fixture();
    const execution = identity('one');

    await replaceParagraph(session, execution, 'B');
    await replaceParagraph(session, execution, '<strong>C</strong>');
    expect(session.getManifest().pending?.operations).toHaveLength(2);
    expect(session.getManifest().history.entries).toHaveLength(0);

    await expect(session.settle(execution)).resolves.toBe(true);
    expect(session.getManifest().history.entries).toHaveLength(1);
    expect(session.getManifest().history.entries[0].operations).toHaveLength(2);

    await session.undo();
    expect(session.getDraft()).toContain('<p>A</p>');
    await session.redo();
    expect(session.getDraft()).toContain('<p><strong>C</strong></p>');
  });

  it('rolls back every replacement in a failed execution', async () => {
    const { session } = await fixture();
    const execution = identity('rollback');

    await replaceParagraph(session, execution, 'B');
    await replaceParagraph(session, execution, 'C');
    await expect(session.rollback(execution)).resolves.toBe(true);

    expect(session.getDraft()).toContain('<p>A</p>');
    expect(session.getManifest().pending).toBeUndefined();
    expect(session.getManifest().history.entries).toHaveLength(0);
  });

  it('finishes rollback recovery when draft was restored before manifest', async () => {
    const { files, source, session } = await fixture();
    const execution = identity('rollback-crash');
    await replaceParagraph(session, execution, 'B');
    await files.writeDraft('project-1', 'asset-1', source.content);

    const recovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );

    expect(recovered.getDraft()).toBe(source.content);
    expect(recovered.getManifest().pending).toBeUndefined();
    expect(recovered.getManifest().draftRevision).toBe(
      createHtmlDraftRevision(source.content),
    );
  });

  it('queues sync while pending and retains draft/history after syncing', async () => {
    const { session } = await fixture();
    const execution = identity('sync');
    await replaceParagraph(session, execution, 'B');

    await expect(session.requestSync()).resolves.toBe('queued');
    expect(session.getManifest().syncRequested).toBe(true);
    await session.settle(execution);

    const draftRevision = session.getManifest().draftRevision;
    await session.markSynced(draftRevision, 'source-after-sync');
    expect(session.getManifest()).toMatchObject({
      draftRevision,
      syncedDraftRevision: draftRevision,
      sourceRevision: 'source-after-sync',
      syncRequested: false,
    });
    expect(session.getManifest().history.entries).toHaveLength(1);
    expect(session.getDraft()).toContain('<p>B</p>');
  });

  it(
    'truncates redo on a new branch and retains at most 20 turns',
    async () => {
      const { session } = await fixture();
      for (let index = 1; index <= 21; index += 1) {
        const execution = identity(String(index));
        await replaceParagraph(session, execution, String(index));
        await session.settle(execution);
      }
      expect(session.getManifest().history).toMatchObject({
        cursor: 20,
      });
      expect(session.getManifest().history.entries).toHaveLength(20);

      await session.undo();
      await session.undo();
      const branched = identity('branch');
      await replaceParagraph(session, branched, 'branch');
      await session.settle(branched);
      const history = session.getManifest().history;
      expect(history.cursor).toBe(history.entries.length);
      expect(history.entries.at(-1)?.executionId).toBe('branch');
      await expect(session.redo()).rejects.toThrow('没有可重做步骤');
    },
    15_000,
  );

  it('recovers an interrupted undo and redo from adjacent history revisions', async () => {
    const { files, source, session } = await fixture();
    const execution = identity('history-crash');
    await replaceParagraph(session, execution, 'B');
    await session.settle(execution);
    const edited = session.getDraft();

    await files.writeDraft('project-1', 'asset-1', source.content);
    const undoRecovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );
    expect(undoRecovered.getManifest().history.cursor).toBe(0);
    expect(undoRecovered.getDraft()).toBe(source.content);

    await files.writeDraft('project-1', 'asset-1', edited);
    const redoRecovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );
    expect(redoRecovered.getManifest().history.cursor).toBe(1);
    expect(redoRecovered.getDraft()).toBe(edited);
  });

  it('restores a draft write that completed before staged journal finalization', async () => {
    const { files, source, session } = await fixture();
    const execution = identity('crash');
    const edit = beginHtmlSourceEdit({
      source: session.getDraft(),
      locator: { kind: 'selector', selector: 'p' },
      scope: 'contents',
    });
    const replaced = replaceHtmlSourceEdit({ edit, replacement: 'B' });
    const afterRevision = createHtmlDraftRevision(replaced.source);
    const operation = {
      rangeStart: edit.range.start,
      beforeHtml: edit.currentHtml,
      afterHtml: 'B',
      beforeRevision: session.getManifest().draftRevision,
      afterRevision,
      beforeTarget: edit.resolvedTarget,
      afterTarget: replaced.resolvedTarget,
    };
    await files.writeCheckpoint('project-1', 'asset-1', session.getDraft());
    await files.writeManifest({
      ...session.getManifest(),
      pending: {
        ...execution,
        initialRevision: session.getManifest().draftRevision,
        operations: [],
        stagedOperation: operation,
      },
    });
    await files.writeDraft('project-1', 'asset-1', replaced.source);

    const recovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );
    expect(recovered.getDraft()).toBe(replaced.source);
    expect(recovered.getManifest().draftRevision).toBe(afterRevision);
    expect(recovered.getManifest().pending?.operations).toEqual([operation]);
    expect(recovered.getManifest().pending?.stagedOperation).toBeUndefined();
  });

  it('drops a staged operation when the process stopped before writing draft', async () => {
    const { files, source, session } = await fixture();
    const execution = identity('before-draft');
    const edit = beginHtmlSourceEdit({
      source: session.getDraft(),
      locator: { kind: 'selector', selector: 'p' },
      scope: 'contents',
    });
    const replaced = replaceHtmlSourceEdit({ edit, replacement: 'B' });
    await files.writeCheckpoint('project-1', 'asset-1', session.getDraft());
    await files.writeManifest({
      ...session.getManifest(),
      pending: {
        ...execution,
        initialRevision: session.getManifest().draftRevision,
        operations: [],
        stagedOperation: {
          rangeStart: edit.range.start,
          beforeHtml: edit.currentHtml,
          afterHtml: 'B',
          beforeRevision: session.getManifest().draftRevision,
          afterRevision: createHtmlDraftRevision(replaced.source),
          beforeTarget: edit.resolvedTarget,
          afterTarget: replaced.resolvedTarget,
        },
      },
    });

    const recovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );

    expect(recovered.getDraft()).toBe(source.content);
    expect(recovered.getManifest().pending).toBeUndefined();
    await expect(
      files.readCheckpoint('project-1', 'asset-1'),
    ).rejects.toThrow('无法读取');
  });

  it('retains earlier operations when a later staged write never reached draft', async () => {
    const { files, source, session } = await fixture();
    const execution = identity('later-before-draft');
    await replaceParagraph(session, execution, 'B');
    const edit = beginHtmlSourceEdit({
      source: session.getDraft(),
      locator: { kind: 'selector', selector: 'p' },
      scope: 'contents',
    });
    const replaced = replaceHtmlSourceEdit({ edit, replacement: 'C' });
    const manifest = session.getManifest();
    await files.writeManifest({
      ...manifest,
      pending: {
        ...manifest.pending!,
        stagedOperation: {
          rangeStart: edit.range.start,
          beforeHtml: edit.currentHtml,
          afterHtml: 'C',
          beforeRevision: manifest.draftRevision,
          afterRevision: createHtmlDraftRevision(replaced.source),
          beforeTarget: edit.resolvedTarget,
          afterTarget: replaced.resolvedTarget,
        },
      },
    });

    const recovered = await HtmlEditingSession.openOrCreate(
      files,
      'project-1',
      'asset-1',
      source,
    );

    expect(recovered.getDraft()).toContain('<p>B</p>');
    expect(recovered.getManifest().pending?.operations).toHaveLength(1);
    expect(recovered.getManifest().pending?.stagedOperation).toBeUndefined();
    await expect(recovered.settle(execution)).resolves.toBe(true);
  });

  it('fails closed for corrupt manifests and source revision conflicts', async () => {
    const { files, source } = await fixture();
    const sessionFile = join(
      files.directory('project-1', 'asset-1'),
      'session.json',
    );
    await writeFile(sessionFile, '{broken', 'utf8');
    await expect(
      HtmlEditingSession.openOrCreate(
        files,
        'project-1',
        'asset-1',
        source,
      ),
    ).rejects.toBeInstanceOf(HtmlEditingRecoveryError);

    const clean = await fixture();
    const externalSource = { ...clean.source, revision: 'external-change' };
    const conflicted = await HtmlEditingSession.openOrCreate(
      clean.files,
      'project-1',
      'asset-1',
      externalSource,
    );
    expect(conflicted.getManifest().conflict).toBe(
      'SOURCE_REVISION_MISMATCH',
    );
    await expect(conflicted.requestSync()).rejects.toThrow('恢复冲突');
  });

  it('uses a stable digest directory and verifies persisted asset identity', async () => {
    const { files } = await fixture();
    const directory = files.directory('project-1', 'asset-1');
    expect(directory).toMatch(/[a-f0-9]{64}$/);
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    manifest.assetId = 'different-asset';
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await expect(files.load('project-1', 'asset-1')).rejects.toThrow(
      'manifest 无效',
    );
  });
});
