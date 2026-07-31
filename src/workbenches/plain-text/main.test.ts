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
import {
  createPlainTextBufferCommand,
  DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
  isPlainTextWorkbenchPayload,
  PLAIN_TEXT_RECOVERY_DATA_KEY,
  PLAIN_TEXT_WORKBENCH_ID,
  plainTextCommands,
} from './shared';
import { PlainTextWorkbenchProvider } from './main';

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
  state: WorkbenchStateRecord | undefined,
): WorkbenchProviderContext {
  const asset = createAssetSnapshot({
    id: 'asset',
    projectId: 'project',
    name: '资料',
    mediaType: 'text/plain',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef('/tmp/notes.txt'),
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
  content: '已保存正文',
  encoding: 'utf-8',
  lineEnding: 'lf',
  hasByteOrderMark: false,
  revision: 'revision-0',
};
const viewState = { anchor: 2, head: 2, scrollTop: 12 };

describe('PlainTextWorkbenchProvider', () => {
  it('persists an unsaved recovery snapshot when the session closes', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data, {
      now: () => 200,
    });
    const { handle } = createHandle(source);
    const context = createContext('session', handle, undefined);

    const opened = await provider.open(context);
    expect(isPlainTextWorkbenchPayload(opened.payload)).toBe(true);
    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.syncBuffer, {
        content: '未保存正文',
        lineEnding: 'lf',
        viewState,
      }),
    );
    await provider.close(context);

    const state = await states.get('asset', PLAIN_TEXT_WORKBENCH_ID);
    const recovery = await data.get(
      'asset',
      PLAIN_TEXT_WORKBENCH_ID,
      PLAIN_TEXT_RECOVERY_DATA_KEY,
    );
    expect(state?.payload).toMatchObject({
      viewState,
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
      recovery: {
        baseRevision: 'revision-0',
        updatedTime: 200,
      },
    });
    expect(new TextDecoder().decode(recovery?.data)).toBe('未保存正文');
  });

  it('offers a saved recovery snapshot on the next open', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle } = createHandle(source);
    await states.save({
      assetId: 'asset',
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      schemaVersion: 1,
      payload: {
        viewState,
        recovery: {
          dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
          baseRevision: 'older-revision',
          encoding: 'utf-8',
          lineEnding: 'lf',
          hasByteOrderMark: false,
          updatedTime: 200,
        },
      },
      updatedTime: 200,
    });
    await data.save({
      assetId: 'asset',
      workbenchId: PLAIN_TEXT_WORKBENCH_ID,
      dataKey: PLAIN_TEXT_RECOVERY_DATA_KEY,
      data: new TextEncoder().encode('恢复正文'),
      updatedTime: 200,
    });
    const context = createContext(
      'session',
      handle,
      await states.get('asset', PLAIN_TEXT_WORKBENCH_ID),
    );

    const opened = await provider.open(context);

    expect(opened.payload).toMatchObject({
      content: '已保存正文',
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
      recovery: {
        content: '恢复正文',
        lineEnding: 'lf',
        sourceChanged: true,
      },
    });
  });

  it('saves through the byte ContentHandle and clears recovery data', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data, {
      now: () => 300,
    });
    const { handle, writeBytes } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);
    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.backup, {
        content: '准备保存',
        lineEnding: 'lf',
        viewState,
      }),
    );

    const saved = await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.save, {
        content: '正式保存',
        lineEnding: 'lf',
        viewState,
      }),
    );

    expect(saved.payload).toMatchObject({
      revision: 'revision-1',
      savedTime: 300,
    });
    expect(writeBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 'revision-0',
      }),
    );
    expect(
      new TextDecoder().decode(
        writeBytes.mock.calls[0]?.[0].content,
      ),
    ).toBe('正式保存');
    await expect(
      data.get(
        'asset',
        PLAIN_TEXT_WORKBENCH_ID,
        PLAIN_TEXT_RECOVERY_DATA_KEY,
      ),
    ).resolves.toBeUndefined();
    expect(
      (await states.get('asset', PLAIN_TEXT_WORKBENCH_ID))?.payload,
    ).toEqual({
      viewState,
      viewOptions: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
    });
  });

  it('persists Plain Text view options in V2 state', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);

    const result = await provider.command(context, {
      type: plainTextCommands.setViewOptions,
      payload: {
        wordWrap: false,
        lineNumbers: false,
      },
    });

    expect(result.payload).toEqual({
      wordWrap: false,
      lineNumbers: false,
    });
    expect(
      await states.get('asset', PLAIN_TEXT_WORKBENCH_ID),
    ).toMatchObject({
      schemaVersion: 2,
      payload: {
        viewOptions: {
          wordWrap: false,
          lineNumbers: false,
        },
      },
    });
  });

  it('recovers a line-ending-only unsaved change', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data, {
      now: () => 400,
    });
    const { handle } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);

    await provider.command(context, {
      type: plainTextCommands.setLineEnding,
      payload: { lineEnding: 'crlf' },
    });
    await provider.close(context);

    const savedState = await states.get(
      'asset',
      PLAIN_TEXT_WORKBENCH_ID,
    );
    expect(savedState?.payload).toMatchObject({
      recovery: {
        lineEnding: 'crlf',
        updatedTime: 400,
      },
    });
    expect(
      new TextDecoder().decode(
        (
          await data.get(
            'asset',
            PLAIN_TEXT_WORKBENCH_ID,
            PLAIN_TEXT_RECOVERY_DATA_KEY,
          )
        )?.data,
      ),
    ).toBe(source.content);

    const reopenedContext = createContext(
      'reopened-session',
      handle,
      savedState,
    );
    const reopened = await provider.open(reopenedContext);

    expect(reopened.payload).toMatchObject({
      content: source.content,
      lineEnding: 'lf',
      recovery: {
        content: source.content,
        lineEnding: 'crlf',
      },
    });
  });

  it('saves a line-ending-only change through the byte ContentHandle', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle, writeBytes } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);
    await provider.command(context, {
      type: plainTextCommands.setLineEnding,
      payload: { lineEnding: 'crlf' },
    });

    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.save, {
        content: source.content,
        lineEnding: 'crlf',
        viewState,
      }),
    );

    expect(
      new TextDecoder().decode(
        writeBytes.mock.calls[0]?.[0].content,
      ),
    ).toBe(source.content);
    expect(
      (await states.get('asset', PLAIN_TEXT_WORKBENCH_ID))?.payload,
    ).not.toHaveProperty('recovery');
  });

  it('clears a persisted recovery after returning to the saved format', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);
    await provider.command(context, {
      type: plainTextCommands.setLineEnding,
      payload: { lineEnding: 'crlf' },
    });
    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.backup, {
        content: source.content,
        lineEnding: 'crlf',
        viewState,
      }),
    );

    await provider.command(context, {
      type: plainTextCommands.setLineEnding,
      payload: { lineEnding: 'lf' },
    });

    expect(
      (await states.get('asset', PLAIN_TEXT_WORKBENCH_ID))?.payload,
    ).not.toHaveProperty('recovery');
    await expect(
      data.get(
        'asset',
        PLAIN_TEXT_WORKBENCH_ID,
        PLAIN_TEXT_RECOVERY_DATA_KEY,
      ),
    ).resolves.toBeUndefined();
  });

  it('reopens a clean source with the requested encoding', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle, readBytes } = createHandle(source);
    readBytes
      .mockResolvedValueOnce({
        content: encodeTextContent(source),
        revision: source.revision,
      })
      .mockResolvedValueOnce({
        content: encodeTextContent({
          content: '以 GBK 打开',
          encoding: 'gbk',
          lineEnding: 'crlf',
          hasByteOrderMark: false,
        }),
        revision: 'revision-gbk',
      });
    const context = createContext('session', handle, undefined);
    await provider.open(context);

    const result = await provider.command(context, {
      type: plainTextCommands.reopenWithEncoding,
      payload: { encoding: 'gbk' },
    });

    expect(readBytes).toHaveBeenCalledTimes(2);
    expect(result.payload).toEqual({
      content: '以 GBK 打开',
      encoding: 'gbk',
      lineEnding: 'lf',
      hasByteOrderMark: false,
      revision: 'revision-gbk',
    });
  });

  it('rejects encoding reopen while the editor is dirty', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data);
    const { handle, readBytes } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);
    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.syncBuffer, {
        content: '未保存内容',
        lineEnding: 'lf',
        viewState,
      }),
    );

    await expect(
      provider.command(context, {
        type: plainTextCommands.reopenWithEncoding,
        payload: { encoding: 'gbk' },
      }),
    ).rejects.toMatchObject({
      code: 'CONTENT_HAS_UNSAVED_CHANGES',
    });
    expect(readBytes).toHaveBeenCalledOnce();
  });
});
