import { describe, expect, it, vi } from 'vitest';

import type { ConversationRecord } from '../../shared/project-conversations';
import type { ProjectConversationDatabaseApi } from './project-conversation-database';
import { ProjectConversationService } from './project-conversation-service';

function record(): ConversationRecord {
  return {
    id: 'conversation-1',
    modeId: 'project.general',
    title: '对话',
    messages: [
      { id: 'message-1', role: 'user', text: '问题', createdTime: 1 },
    ],
    createdTime: 1,
    updatedTime: 1,
  };
}

function createDatabase(): ProjectConversationDatabaseApi {
  return {
    get: vi.fn(),
    getBound: vi.fn(),
    list: vi.fn(() => [record()]),
    save: vi.fn((_projectId, conversation) => conversation),
    remove: vi.fn(),
  };
}

describe('ProjectConversationService', () => {
  it('authorizes every operation against the owning Project', () => {
    const database = createDatabase();
    const projects = { get: vi.fn(() => ({ id: 'project-1' })) };
    const service = new ProjectConversationService(database, projects as never);

    expect(service.list('project-1')).toEqual([record()]);
    expect(service.save('project-1', record())).toEqual([record()]);
    expect(service.remove('project-1', 'conversation-1')).toEqual([record()]);
    expect(projects.get).toHaveBeenCalledTimes(3);
  });

  it('rejects unknown Projects before accessing conversation rows', () => {
    const database = createDatabase();
    const service = new ProjectConversationService(database, {
      get: vi.fn(() => undefined),
    });

    expect(() => service.list('missing')).toThrow();
    expect(database.list).not.toHaveBeenCalled();
  });

  it('reuses an existing Asset-bound conversation and checks Asset ownership', () => {
    const bound: ConversationRecord = {
      ...record(),
      id: 'bound-1',
      modeId: 'learning-outline.intake',
      boundAssetId: 'outline-1',
    };
    const database = createDatabase();
    vi.mocked(database.getBound).mockReturnValue(bound);
    const projects = { get: vi.fn(() => ({ id: 'project-1' })) };
    const assets = {
      get: vi.fn((projectId: string, assetId: string) =>
        projectId === 'project-1' && assetId === 'outline-1'
          ? { id: assetId, projectId }
          : undefined),
    };
    const service = new ProjectConversationService(
      database,
      projects as never,
      assets as never,
    );

    expect(
      service.getOrCreateBoundConversation(
        'project-1',
        'outline-1',
        'learning-outline.intake',
      ),
    ).toEqual(bound);
    expect(database.getBound).toHaveBeenCalledWith(
      'project-1',
      'outline-1',
      'learning-outline.intake',
    );
    expect(database.save).not.toHaveBeenCalled();
    expect(() =>
      service.getOrCreateBoundConversation(
        'project-2',
        'outline-1',
        'learning-outline.intake',
      ),
    ).toThrow();
  });
});
