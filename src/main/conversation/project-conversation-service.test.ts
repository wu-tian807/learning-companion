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
});
