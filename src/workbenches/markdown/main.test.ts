import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssetSnapshot } from '../../main/assets/asset';
import type {
  ContentHandle,
  WriteByteContentRequest,
} from '../../main/content/content-handle';
import {
  encodeTextContent,
  type ResolvedTextContent,
} from '../../main/content/text-content';
import {
  createAssetContentStatus,
  createAbsoluteLocalFileContentRef,
} from '../../main/content/content-ref';
import type { WorkbenchProviderContext } from '../../main/workbench/workbench-session';
import { WorkbenchEventBus } from '../../main/workbench/workbench-event-bus';
import type {
  WorkbenchStateDataRecord,
  WorkbenchStateDataDatabaseApi,
} from '../../main/workbench/workbench-state-data-database';
import type {
  WorkbenchStateRecord,
  WorkbenchStateDatabaseApi,
} from '../../main/workbench/workbench-state-database';
import { MarkdownWorkbenchProvider } from './main';
import {
  createMarkdownInsertImageCommand,
  createMarkdownReadImageCommand,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownAdoptSharedPayload,
  isMarkdownReadConflictStateResult,
  isMarkdownResolveConflictPayload,
  isMarkdownWorkbenchPayload,
  MARKDOWN_RECOVERY_DATA_KEY,
  MARKDOWN_STATE_SCHEMA_VERSION,
  MARKDOWN_WORKBENCH_ID,
  markdownCommands,
} from './shared';

class MemoryStateDatabase implements WorkbenchStateDatabaseApi {
  readonly records = new Map<string, WorkbenchStateRecord>();

  async get(assetId: string, workbenchId: string) {
    return this.records.get(`${assetId}:${workbenchId}`);
  }

  async save(record: WorkbenchStateRecord) {
    this.records.set(`${record.assetId}:${record.workbenchId}`, record);
  }

  async delete(assetId: string, workbenchId: string) {
    this.records.delete(`${assetId}:${workbenchId}`);
  }
}

class MemoryDataDatabase implements WorkbenchStateDataDatabaseApi {
  readonly records = new Map<string, WorkbenchStateDataRecord>();

  async get(assetId: string, workbenchId: string, dataKey: string) {
    return this.records.get(`${assetId}:${workbenchId}:${dataKey}`);
  }

  async save(record: WorkbenchStateDataRecord) {
    this.records.set(
      `${record.assetId}:${record.workbenchId}:${record.dataKey}`,
      record,
    );
  }

  async delete(assetId: string, workbenchId: string, dataKey: string) {
    this.records.delete(`${assetId}:${workbenchId}:${dataKey}`);
  }
}

function createHandle(initial: ResolvedTextContent) {
  let currentContent = encodeTextContent(initial);
  let currentRevision = initial.revision;
  const readBytes = vi.fn(async () => ({
    content: currentContent,
    revision: currentRevision,
  }));
  const writeBytes = vi.fn(async (request: WriteByteContentRequest) => {
    if (request.expectedRevision !== currentRevision) {
      throw new Error('revision mismatch');
    }

    currentContent = Buffer.from(request.content);
    currentRevision = `revision-${writeBytes.mock.calls.length}`;
    return { revision: currentRevision };
  });
  const handle: ContentHandle = {
    capabilities: new Set(['read-bytes', 'write-bytes']),
    readBytes,
    writeBytes,
    close: vi.fn(async () => undefined),
  };

  return { handle, readBytes, writeBytes };
}

function createContext(
  sessionId: string,
  handle: ContentHandle,
  state?: WorkbenchStateRecord,
): WorkbenchProviderContext {
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: 'text/markdown',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef('/tmp/notes.md'),
    createdTime: 100,
    updatedTime: 100,
  });

  return {
    sessionId,
    asset,
    content: {
      contentRef: asset.contentRef,
      contentStatus: createAssetContentStatus('available', 100),
      handle,
    },
    attachments: [],
    state,
    selectionReason: 'matched',
  };
}

const source: ResolvedTextContent = {
  content: '# 已保存标题\n',
  encoding: 'utf-8',
  lineEnding: 'lf',
  hasByteOrderMark: false,
  revision: 'revision-0',
};
const sourceViewState = { anchor: 1, head: 3, scrollTop: 12 };

describe('MarkdownWorkbenchProvider', () => {
  it('treats a future document version as invalid IPC without locking the writer', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(), new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    await provider.command(context, createMarkdownSyncSourceCommand({
      content: '# first\n', lineEnding: 'lf', sourceViewState,
      baseDocumentVersion: 0, updateId: 1,
    }));

    await expect(provider.command(context, createMarkdownSyncSourceCommand({
      content: '# malformed\n', lineEnding: 'lf', sourceViewState,
      baseDocumentVersion: 99, updateId: 2,
    }))).rejects.toThrow('INVALID_IPC_REQUEST');

    await expect(provider.command(context, createMarkdownSyncSourceCommand({
      content: '# still editable\n', lineEnding: 'lf', sourceViewState,
      baseDocumentVersion: 1, updateId: 3,
    }))).resolves.toMatchObject({ payload: { accepted: true } });
  });

  it('releases every conflict owned by one session while retaining the backups', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(), new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const first = createContext('first', handle);
    const second = createContext('second', handle);
    await provider.open(first);
    await provider.open(second);
    await provider.command(first, createMarkdownSyncSourceCommand({
      content: '# shared\n', lineEnding: 'lf', sourceViewState,
      baseDocumentVersion: 0, updateId: 1,
    }));
    for (const content of ['# rejected one\n', '# rejected two\n']) {
      await expect(provider.command(second, createMarkdownSyncSourceCommand({
        content, lineEnding: 'lf', sourceViewState,
        baseDocumentVersion: 0, updateId: 1,
      }))).rejects.toThrow('CONTENT_HAS_UNSAVED_CHANGES');
    }
    const state = await provider.command(second, {
      type: markdownCommands.readConflictState,
    });
    expect(isMarkdownReadConflictStateResult(state.payload)).toBe(true);
    const conflicts = (state.payload as { conflicts: readonly { conflictId: string }[] }).conflicts;
    expect(conflicts).toHaveLength(2);
    await expect(provider.command(first, {
      type: markdownCommands.adoptShared,
      payload: { conflictId: conflicts[0]!.conflictId },
    })).rejects.toThrow('INVALID_IPC_REQUEST');
    await provider.command(second, {
      type: markdownCommands.adoptShared,
      payload: { conflictId: conflicts[0]!.conflictId },
    });

    await expect(provider.command(second, createMarkdownSyncSourceCommand({
      content: '# resumed\n', lineEnding: 'lf', sourceViewState,
      baseDocumentVersion: 1, updateId: 2,
    }))).resolves.toMatchObject({ payload: { accepted: true } });
    const after = await provider.command(second, {
      type: markdownCommands.readConflictState,
    });
    expect((after.payload as { conflicts: unknown[] }).conflicts).toHaveLength(2);
  });

  it('validates the closed conflict command and result protocol', () => {
    expect(isMarkdownResolveConflictPayload({
      conflictId: 'conflict', expectedDocumentVersion: 1, content: 'merged',
    })).toBe(true);
    expect(isMarkdownResolveConflictPayload({
      conflictId: 'conflict', expectedDocumentVersion: Number.NaN, content: 'merged',
    })).toBe(false);
    expect(isMarkdownAdoptSharedPayload({ conflictId: 'conflict', extra: true })).toBe(false);
    expect(isMarkdownReadConflictStateResult({
      sharedContent: 'shared', documentVersion: 1,
      conflicts: [{ conflictId: 'missing', unavailable: true, baseRevision: 'r1', sharedDocumentVersion: 0 }],
    })).toBe(true);
    expect(isMarkdownReadConflictStateResult({
      sharedContent: 'shared', documentVersion: -1, conflicts: [],
    })).toBe(false);
  });

  it('opens disk source with the default Markdown state', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);

    const opened = await provider.open(
      createContext('session', handle),
    );

    expect(isMarkdownWorkbenchPayload(opened.payload)).toBe(true);
    expect(opened.payload).toEqual({
      diskSource: source.content,
      encoding: 'utf-8',
      lineEnding: 'lf',
      hasByteOrderMark: false,
      revision: 'revision-0',
      documentVersion: 0,
      state: DEFAULT_MARKDOWN_WORKBENCH_STATE,
    });
  });

  it('allows a Source edit through the ordinary save command', async () => {
    const states = new MemoryStateDatabase();
    const data = new MemoryDataDatabase();
    const provider = new MarkdownWorkbenchProvider(states, data, {
      now: () => 300,
    });
    const { handle, writeBytes } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    const synced = await provider.command(
      context,
      createMarkdownSyncSourceCommand({
        content: '# Source 修改\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );

    expect(synced.payload).toEqual({
      accepted: true,
      dirty: true,
      documentVersion: 1,
    });
    const saved = await provider.command(context, {
      type: markdownCommands.save,
    });

    expect(saved.payload).toEqual({
      revision: 'revision-1',
      savedTime: 300,
    });
    expect(writeBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 'revision-0',
      }),
    );
    expect(
      new TextDecoder().decode(writeBytes.mock.calls[0]?.[0].content),
    ).toBe('# Source 修改\n');
  });

  it('shares one Markdown document buffer across viewport sessions and keeps it after one closes', async () => {
    const events = new WorkbenchEventBus();
    const received: unknown[] = [];
    events.subscribe((event) => received.push(event));
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
      { workbenchEvents: events },
    );
    const { handle } = createHandle(source);
    const first = createContext('first', handle);
    const second = createContext('second', handle);
    await provider.open(first);
    await provider.open(second);

    await provider.command(
      first,
      createMarkdownSyncSourceCommand({
        content: '# 两个视口看见同一份草稿\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );

    expect(received).toContainEqual({
      sessionId: 'second',
      type: 'markdown:document-changed',
      payload: expect.objectContaining({
        content: '# 两个视口看见同一份草稿\n',
      }),
    });
    const third = await provider.open(createContext('third', handle));
    expect(third.payload).toMatchObject({
      diskSource: source.content,
      workingBuffer: '# 两个视口看见同一份草稿\n',
      documentDirty: true,
    });

    await provider.close(first);
    const saved = await provider.command(second, {
      type: markdownCommands.save,
    });
    expect(saved.payload).toMatchObject({ revision: 'revision-1' });
  });

  it('rejects a stale viewport buffer instead of silently replacing a peer edit', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const first = createContext('first', handle);
    const second = createContext('second', handle);
    await provider.open(first);
    await provider.open(second);
    await provider.command(
      first,
      createMarkdownSyncSourceCommand({
        content: '# first\n',
        lineEnding: 'lf',
        sourceViewState,
        baseDocumentVersion: 0,
        updateId: 1,
      }),
    );
    await expect(
      provider.command(
        second,
        createMarkdownSyncSourceCommand({
          content: '# stale second\n',
          lineEnding: 'lf',
          sourceViewState,
          baseDocumentVersion: 0,
          updateId: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_HAS_UNSAVED_CHANGES' });
    const reopened = await provider.open(createContext('third', handle));
    expect(reopened.payload).toMatchObject({ workingBuffer: '# first\n' });
  });

  it('rejects a writer that claims a future document version', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    await expect(
      provider.command(
        context,
        createMarkdownSyncSourceCommand({
          content: '# impossible future\n',
          lineEnding: 'lf',
          sourceViewState,
          baseDocumentVersion: 999,
          updateId: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
  });

  it('serializes simultaneous saves from two Markdown sessions into one write', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle, writeBytes } = createHandle(source);
    const first = createContext('first', handle);
    const second = createContext('second', handle);
    await provider.open(first);
    await provider.open(second);
    await provider.command(
      first,
      createMarkdownSyncSourceCommand({
        content: '# shared\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );
    const [left, right] = await Promise.all([
      provider.command(first, { type: markdownCommands.save }),
      provider.command(second, { type: markdownCommands.save }),
    ]);
    expect(left.payload).toMatchObject({ revision: 'revision-1' });
    expect(right.payload).toMatchObject({ revision: 'revision-1' });
    expect(writeBytes).toHaveBeenCalledOnce();
  });

  it('keeps input that arrives while a save is writing as a recoverable dirty buffer', async () => {
    const states = new MemoryStateDatabase();
    const data = new MemoryDataDatabase();
    let diskContent = source.content;
    let diskRevision = source.revision;
    let releaseWrite!: () => void;
    let reportWriteStarted!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    const writeBytes = vi.fn(async (request: WriteByteContentRequest) => {
      expect(request.expectedRevision).toBe(diskRevision);
      reportWriteStarted();
      await writeGate;
      diskContent = new TextDecoder().decode(request.content);
      diskRevision = 'revision-1';
      return { revision: diskRevision };
    });
    const handle: ContentHandle = {
      capabilities: new Set(['read-bytes', 'write-bytes']),
      readBytes: vi.fn(async () => ({
        content: encodeTextContent({ ...source, content: diskContent }),
        revision: diskRevision,
      })),
      writeBytes,
      close: vi.fn(async () => undefined),
    };
    const provider = new MarkdownWorkbenchProvider(states, data);
    const context = createContext('session', handle);
    await provider.open(context);
    await provider.command(
      context,
      createMarkdownSyncSourceCommand({
        content: '# first edit\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );

    const saving = provider.command(context, { type: markdownCommands.save });
    await writeStarted;
    await provider.command(
      context,
      createMarkdownSyncSourceCommand({
        content: '# second edit during save\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );
    releaseWrite();
    await saving;
    await provider.close(context);

    expect(diskContent).toBe('# first edit\n');
    expect(
      new TextDecoder().decode(
        (
          await data.get(
            'asset',
            MARKDOWN_WORKBENCH_ID,
            MARKDOWN_RECOVERY_DATA_KEY,
          )
        )?.data,
      ),
    ).toBe('# second edit during save\n');
  });

  it('allows a WYSIWYG edit through the ordinary save command', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
      { now: () => 400 },
    );
    const { handle, writeBytes } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    const synced = await provider.command(
      context,
      createMarkdownSyncWysiwygCommand({
        content: '# 可视化修改\n',
        lineEnding: 'lf',
        wysiwygScrollTop: 32,
      }),
    );

    expect(synced.payload).toEqual({
      accepted: true,
      dirty: true,
      documentVersion: 1,
    });
    const saved = await provider.command(context, {
      type: markdownCommands.save,
    });

    expect(saved.payload).toEqual({
      revision: 'revision-1',
      savedTime: 400,
    });
    expect(writeBytes).toHaveBeenCalledOnce();
  });

  it('keeps the latest buffer when switching from WYSIWYG to Source', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    await provider.command(
      context,
      createMarkdownSyncWysiwygCommand({
        content: '# 可视化修改\n',
        lineEnding: 'lf',
        wysiwygScrollTop: 0,
      }),
    );

    const sourceSync = await provider.command(
      context,
      createMarkdownSyncSourceCommand({
        content: '# 切到源码继续修改\n',
        lineEnding: 'lf',
        sourceViewState,
      }),
    );

    expect(sourceSync.payload).toEqual({
      accepted: true,
      dirty: true,
      documentVersion: 2,
    });
    await expect(
      provider.command(context, { type: markdownCommands.save }),
    ).resolves.toMatchObject({
      payload: { revision: 'revision-1' },
    });
  });

  it('persists the latest recovery on close', async () => {
    const states = new MemoryStateDatabase();
    const data = new MemoryDataDatabase();
    const provider = new MarkdownWorkbenchProvider(states, data, {
      now: () => 500,
    });
    const { handle } = createHandle(source);
    const context = createContext('session', handle);
    await provider.open(context);
    await provider.command(
      context,
      createMarkdownSyncWysiwygCommand({
        content: '# 待恢复\n',
        lineEnding: 'crlf',
        wysiwygScrollTop: 72,
      }),
    );

    await provider.close(context);

    expect(
      (await states.get('asset', MARKDOWN_WORKBENCH_ID))?.payload,
    ).toMatchObject({
      viewMode: 'wysiwyg',
      wysiwygScrollTop: 72,
      recovery: {
        dataKey: MARKDOWN_RECOVERY_DATA_KEY,
        baseRevision: 'revision-0',
        editedFrom: 'wysiwyg',
        lineEnding: 'crlf',
        updatedTime: 500,
      },
    });
    const recovery = await data.get(
      'asset',
      MARKDOWN_WORKBENCH_ID,
      MARKDOWN_RECOVERY_DATA_KEY,
    );
    expect(new TextDecoder().decode(recovery?.data)).toBe('# 待恢复\n');
  });

  it('offers a persisted recovery without silently replacing disk source', async () => {
    const states = new MemoryStateDatabase();
    const data = new MemoryDataDatabase();
    const provider = new MarkdownWorkbenchProvider(states, data);
    const { handle } = createHandle(source);
    await states.save({
      assetId: 'asset',
      workbenchId: MARKDOWN_WORKBENCH_ID,
      schemaVersion: MARKDOWN_STATE_SCHEMA_VERSION,
      payload: {
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        recovery: {
          dataKey: MARKDOWN_RECOVERY_DATA_KEY,
          baseRevision: 'older-revision',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          editedFrom: 'wysiwyg',
          updatedTime: 600,
        },
      },
      updatedTime: 600,
    });
    await data.save({
      assetId: 'asset',
      workbenchId: MARKDOWN_WORKBENCH_ID,
      dataKey: MARKDOWN_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode('# 恢复内容\n'),
      updatedTime: 600,
    });
    const context = createContext(
      'session',
      handle,
      await states.get('asset', MARKDOWN_WORKBENCH_ID),
    );

    const opened = await provider.open(context);

    expect(opened.payload).toMatchObject({
      diskSource: source.content,
      recovery: {
        content: '# 恢复内容\n',
        sourceChanged: true,
      },
    });
  });

  it('falls back from invalid state and rejects invalid open context', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    const { handle } = createHandle(source);
    const invalidState: WorkbenchStateRecord = {
      assetId: 'asset',
      workbenchId: MARKDOWN_WORKBENCH_ID,
      schemaVersion: MARKDOWN_STATE_SCHEMA_VERSION,
      payload: {
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        wysiwygScrollTop: -1,
      },
      updatedTime: 100,
    };

    await expect(
      provider.open(createContext('fallback', handle, invalidState)),
    ).resolves.toMatchObject({
      payload: { state: DEFAULT_MARKDOWN_WORKBENCH_STATE },
    });
    await expect(
      provider.open({
        ...createContext('invalid', handle),
        selectionReason: 'missing-capability',
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('does not resurrect a stale recovery while an explicit save waits for persistence', async () => {
    vi.useFakeTimers();
    try {
      const states = new MemoryStateDatabase();
      const data = new MemoryDataDatabase();
      let releaseRecovery!: () => void;
      let reportRecoveryStarted!: () => void;
      const recoveryGate = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });
      const recoveryStarted = new Promise<void>((resolve) => {
        reportRecoveryStarted = resolve;
      });
      const originalSave = data.save.bind(data);
      data.save = vi.fn(async (record: WorkbenchStateDataRecord) => {
        reportRecoveryStarted();
        await recoveryGate;
        await originalSave(record);
      });
      const provider = new MarkdownWorkbenchProvider(states, data, {
        now: () => 700,
        recoveryDebounceMs: 1,
      });
      const { handle, writeBytes } = createHandle(source);
      const context = createContext('session', handle);
      await provider.open(context);
      await provider.command(
        context,
        createMarkdownSyncSourceCommand({
          content: '# 即将保存\n',
          lineEnding: 'lf',
          sourceViewState,
        }),
      );

      vi.advanceTimersByTime(1);
      await recoveryStarted;
      const savePromise = provider.command(context, {
        type: markdownCommands.save,
      });
      await Promise.resolve();
      expect(writeBytes).not.toHaveBeenCalled();

      releaseRecovery();
      await savePromise;

      expect(writeBytes).toHaveBeenCalledOnce();
      await expect(
        data.get(
          'asset',
          MARKDOWN_WORKBENCH_ID,
          MARKDOWN_RECOVERY_DATA_KEY,
        ),
      ).resolves.toBeUndefined();
      expect(
        (await states.get('asset', MARKDOWN_WORKBENCH_ID))?.payload,
      ).not.toHaveProperty('recovery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps automatic recovery scheduled after an unsupported command', async () => {
    vi.useFakeTimers();
    try {
      const states = new MemoryStateDatabase();
      const data = new MemoryDataDatabase();
      const provider = new MarkdownWorkbenchProvider(states, data, {
        now: () => 800,
        recoveryDebounceMs: 1,
      });
      const { handle } = createHandle(source);
      const context = createContext('session', handle);
      await provider.open(context);
      await provider.command(
        context,
        createMarkdownSyncSourceCommand({
          content: '# 保留自动恢复\n',
          lineEnding: 'lf',
          sourceViewState,
        }),
      );

      await expect(
        provider.command(context, { type: 'markdown:unsupported' }),
      ).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' });
      await vi.advanceTimersByTimeAsync(1);

      expect(
        new TextDecoder().decode(
          (
            await data.get(
              'asset',
              MARKDOWN_WORKBENCH_ID,
              MARKDOWN_RECOVERY_DATA_KEY,
            )
          )?.data,
        ),
      ).toBe('# 保留自动恢复\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears scheduled recovery after an ordinary WYSIWYG save', async () => {
    vi.useFakeTimers();
    try {
      const states = new MemoryStateDatabase();
      const data = new MemoryDataDatabase();
      const provider = new MarkdownWorkbenchProvider(states, data, {
        now: () => 900,
        recoveryDebounceMs: 1,
      });
      const { handle } = createHandle(source);
      const context = createContext('session', handle);
      await provider.open(context);
      await provider.command(
        context,
        createMarkdownSyncWysiwygCommand({
          content: '# 直接保存\n',
          lineEnding: 'lf',
          wysiwygScrollTop: 0,
        }),
      );

      await expect(
        provider.command(context, { type: markdownCommands.save }),
      ).resolves.toMatchObject({
        payload: { revision: 'revision-1' },
      });
      await vi.advanceTimersByTimeAsync(1);

      expect(
        (await states.get('asset', MARKDOWN_WORKBENCH_ID))?.payload,
      ).not.toHaveProperty('recovery');
      await expect(
        data.get(
          'asset',
          MARKDOWN_WORKBENCH_ID,
          MARKDOWN_RECOVERY_DATA_KEY,
        ),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MarkdownWorkbenchProvider image insertion', () => {
  async function openWithDirectory(): Promise<{
    readonly provider: MarkdownWorkbenchProvider;
    readonly context: WorkbenchProviderContext;
    readonly directory: string;
    readonly cleanup: () => Promise<void>;
  }> {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-markdown-image-'),
    );
    const { handle } = createHandle(source);
    const base = createContext('session', handle);
    const context: WorkbenchProviderContext = {
      ...base,
      content: {
        ...base.content,
        location: {
          kind: 'local-file',
          absolutePath: join(directory, 'notes.md'),
        },
      },
    };
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateDatabase(),
      new MemoryDataDatabase(),
    );
    await provider.open(context);
    return {
      provider,
      context,
      directory,
      cleanup: () => provider.close(context).then(() => rm(directory, {
        recursive: true,
        force: true,
      })),
    };
  }

  it('copies an inserted image beside the Markdown and reads it back', async () => {
    const fixture = await openWithDirectory();
    try {
      const bytes = Buffer.from('fake-png-bytes', 'utf8');
      const inserted = await fixture.provider.command(
        fixture.context,
        createMarkdownInsertImageCommand({
          name: '截图 1.png',
          mediaType: 'image/png',
          data: bytes.toString('base64'),
        }),
      );

      expect(inserted.payload).toEqual({
        relativePath: 'images/截图 1.png',
      });
      await expect(
        readFile(
          join(
            fixture.directory,
            'images',
            '截图 1.png',
          ),
        ),
      ).resolves.toEqual(bytes);

      const read = await fixture.provider.command(
        fixture.context,
        createMarkdownReadImageCommand(
          (inserted.payload as { readonly relativePath: string })
            .relativePath,
        ),
      );
      expect(read.payload).toEqual({
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('deduplicates repeated image names', async () => {
    const fixture = await openWithDirectory();
    try {
      const bytes = Buffer.from('a', 'utf8');
      const payload = {
        name: 'repeat.png',
        mediaType: 'image/png' as const,
        data: bytes.toString('base64'),
      };
      const first = await fixture.provider.command(
        fixture.context,
        createMarkdownInsertImageCommand(payload),
      );
      const second = await fixture.provider.command(
        fixture.context,
        createMarkdownInsertImageCommand(payload),
      );

      expect(first.payload).toEqual({
        relativePath: 'images/repeat.png',
      });
      expect(second.payload).toEqual({
        relativePath: 'images/repeat-2.png',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects oversized or unsafe image requests', async () => {
    const fixture = await openWithDirectory();
    try {
      await expect(
        fixture.provider.command(
          fixture.context,
          createMarkdownReadImageCommand('../secret.png'),
        ),
      ).rejects.toThrow();
      await expect(
        fixture.provider.command(
          fixture.context,
          createMarkdownInsertImageCommand({
            name: 'huge.png',
            mediaType: 'image/png',
            data: 'A'.repeat(1024 * 1024 * 32),
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });
});
