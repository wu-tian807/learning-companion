import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isIpcResult } from '../../shared/ipc-error';
import type { AssetSnapshot } from '../../shared/assets';
import type { ProjectNotebookAssetServiceApi } from '../project-notebook-assets/project-notebook-asset-service';
import {
  registerProjectNotebookAssetHandlers,
  removeProjectNotebookAssetHandlers,
} from './project-notebook-assets';

const electron = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: electron }));

function handler(channel: string) {
  const registration = electron.handle.mock.calls.find(([name]) => name === channel);
  if (!registration) throw new Error(`missing ${channel}`);
  return async (request: unknown) => {
    const result = await registration[1]({}, request);
    if (!isIpcResult<unknown>(result)) throw new Error('invalid IPC response');
    if (!result.ok) throw result.error;
    return result.data;
  };
}

describe('Project notebook Asset IPC', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and forwards the simple Asset notebook contract', async () => {
    const get = vi.fn(async (projectId: string) => ({ projectId }));
    const create = vi.fn(async (): Promise<AssetSnapshot> => ({
      id: 'note', projectId: 'project', name: '笔记', mediaType: 'text/markdown',
      creationKind: 'generated', contentRef: { kind: 'local-file', base: 'absolute', path: '/tmp/note.md' },
      contentStatus: { availability: 'available', checkedTime: 1 }, createdTime: 1, updatedTime: 1,
    }));
    const select = vi.fn(async (projectId: string, assetId: string) => ({ projectId, assetId }));
    registerProjectNotebookAssetHandlers({ get, create, select } satisfies ProjectNotebookAssetServiceApi);

    await expect(handler(IPC_CHANNELS.getProjectNotebook)({ projectId: 'project' }))
      .resolves.toEqual({ projectId: 'project' });
    await expect(handler(IPC_CHANNELS.createProjectNotebook)({ projectId: 'project', name: '笔记' }))
      .resolves.toMatchObject({ id: 'note' });
    await expect(handler(IPC_CHANNELS.selectProjectNotebookAsset)({ projectId: 'project', assetId: 'note' }))
      .resolves.toEqual({ projectId: 'project', assetId: 'note' });
    expect(get).toHaveBeenCalledWith('project');
    expect(create).toHaveBeenCalledWith('project', '笔记');
    expect(select).toHaveBeenCalledWith('project', 'note');
  });

  it('rejects malformed requests before invoking the service', async () => {
    const get = vi.fn();
    registerProjectNotebookAssetHandlers({ get, create: vi.fn(), select: vi.fn() } as never);
    await expect(handler(IPC_CHANNELS.getProjectNotebook)({ projectId: ' project ' }))
      .rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    expect(get).not.toHaveBeenCalled();
  });

  it('removes the three notebook channels', () => {
    removeProjectNotebookAssetHandlers();
    expect(electron.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.getProjectNotebook,
      IPC_CHANNELS.createProjectNotebook,
      IPC_CHANNELS.selectProjectNotebookAsset,
    ]);
  });
});
