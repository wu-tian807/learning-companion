import { describe, expect, it, vi } from 'vitest';

import { createAssetSnapshot } from '../../main/assets/asset';
import type {
  ContentHandle,
  ResolvedTextContent,
  WriteTextContentRequest,
} from '../../main/content/content-handle';
import {
  createAssetContentStatus,
  createLocalFileContentRef,
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
  let current = initial;
  const writeText = vi.fn(async (request: WriteTextContentRequest) => {
    if (request.expectedRevision !== current.revision) {
      throw new Error('revision mismatch');
    }

    current = {
      ...current,
      content: request.content,
      revision: `revision-${writeText.mock.calls.length}`,
    };
    return { revision: current.revision };
  });
  const handle: ContentHandle = {
    capabilities: new Set(['read-text', 'write-text']),
    readText: vi.fn(async () => current),
    writeText,
    close: vi.fn(async () => undefined),
  };

  return { handle, writeText };
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
    contentRef: createLocalFileContentRef('/tmp/notes.txt'),
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
      recovery: {
        content: '恢复正文',
        sourceChanged: true,
      },
    });
  });

  it('saves through ContentHandle and clears recovery data', async () => {
    const states = new MemoryStateRepository();
    const data = new MemoryDataRepository();
    const provider = new PlainTextWorkbenchProvider(states, data, {
      now: () => 300,
    });
    const { handle, writeText } = createHandle(source);
    const context = createContext('session', handle, undefined);
    await provider.open(context);
    await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.backup, {
        content: '准备保存',
        viewState,
      }),
    );

    const saved = await provider.command(
      context,
      createPlainTextBufferCommand(plainTextCommands.save, {
        content: '正式保存',
        viewState,
      }),
    );

    expect(saved.payload).toMatchObject({
      revision: 'revision-1',
      savedTime: 300,
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '正式保存',
        expectedRevision: 'revision-0',
      }),
    );
    await expect(
      data.get(
        'asset',
        PLAIN_TEXT_WORKBENCH_ID,
        PLAIN_TEXT_RECOVERY_DATA_KEY,
      ),
    ).resolves.toBeUndefined();
    expect(
      (await states.get('asset', PLAIN_TEXT_WORKBENCH_ID))?.payload,
    ).toEqual({ viewState });
  });
});
