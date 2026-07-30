import { describe, expect, it, vi } from 'vitest';

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
import type {
  WorkbenchStateDataRecord,
  WorkbenchStateDataRepository,
} from '../../main/workbench/workbench-state-data-repository';
import type {
  WorkbenchStateRecord,
  WorkbenchStateRepository,
} from '../../main/workbench/workbench-state-repository';
import { MarkdownWorkbenchProvider } from './main';
import {
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  isMarkdownWorkbenchPayload,
  MARKDOWN_RECOVERY_DATA_KEY,
  MARKDOWN_STATE_SCHEMA_VERSION,
  MARKDOWN_WORKBENCH_ID,
  markdownCommands,
} from './shared';

class MemoryStateRepository implements WorkbenchStateRepository {
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

class MemoryDataRepository implements WorkbenchStateDataRepository {
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
    contentRef: createAbsoluteLocalFileContentRef('/tmp/notes.md'),
    createdTime: 100,
    lastUsedTime: 100,
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
  it('opens disk source with the default Markdown state', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateRepository(),
      new MemoryDataRepository(),
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
      state: DEFAULT_MARKDOWN_WORKBENCH_STATE,
    });
  });

  it('allows a Source edit through the ordinary save command', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
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

  it('allows a WYSIWYG edit through the ordinary save command', async () => {
    const provider = new MarkdownWorkbenchProvider(
      new MemoryStateRepository(),
      new MemoryDataRepository(),
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
      new MemoryStateRepository(),
      new MemoryDataRepository(),
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
    });
    await expect(
      provider.command(context, { type: markdownCommands.save }),
    ).resolves.toMatchObject({
      payload: { revision: 'revision-1' },
    });
  });

  it('persists the latest recovery on close', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
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
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
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
      new MemoryStateRepository(),
      new MemoryDataRepository(),
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
      const states = new MemoryStateRepository();
      const data = new MemoryDataRepository();
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
      const states = new MemoryStateRepository();
      const data = new MemoryDataRepository();
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
      const states = new MemoryStateRepository();
      const data = new MemoryDataRepository();
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
