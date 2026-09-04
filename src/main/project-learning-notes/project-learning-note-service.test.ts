import { describe, expect, it, vi } from 'vitest';

import { PROJECT_LEARNING_NOTE_MAX_LENGTH } from '../../shared/project-learning-notes';
import type { ProjectLearningNoteDatabaseApi } from './project-learning-note-database';
import { ProjectLearningNoteService } from './project-learning-note-service';

const project = {
  id: 'project-1',
  name: 'Project 1',
  icon: '📘',
  createdTime: 1,
  pinned: false,
  workspacePath: '/tmp/project-1',
};

function createDatabase(): ProjectLearningNoteDatabaseApi {
  return {
    get: vi.fn(() => undefined),
    save: vi.fn((projectId, markdown, expectedRevision, updatedTime) => ({
      projectId,
      markdown,
      revision: expectedRevision + 1,
      updatedTime,
    })),
  };
}

describe('ProjectLearningNoteService', () => {
  it('returns an unsaved empty snapshot for a Project without a note', () => {
    const service = new ProjectLearningNoteService(
      createDatabase(),
      { get: vi.fn(() => project) },
      () => 10,
    );

    expect(service.get('project-1')).toEqual({
      projectId: 'project-1',
      markdown: '',
      revision: 0,
      updatedTime: null,
    });
  });

  it('authorizes the Project and forwards a validated Markdown save', () => {
    const database = createDatabase();
    const projects = { get: vi.fn(() => project) };
    const service = new ProjectLearningNoteService(database, projects, () => 20);

    expect(service.save('project-1', '# 跨资料笔记', 2)).toEqual({
      projectId: 'project-1',
      markdown: '# 跨资料笔记',
      revision: 3,
      updatedTime: 20,
    });
    expect(database.save).toHaveBeenCalledWith(
      'project-1',
      '# 跨资料笔记',
      2,
      20,
    );
  });

  it('rejects unknown Projects and oversized content before persistence', () => {
    const database = createDatabase();
    const missingProjectService = new ProjectLearningNoteService(database, {
      get: vi.fn(() => undefined),
    });
    expect(() => missingProjectService.get('missing')).toThrow();
    expect(database.get).not.toHaveBeenCalled();

    const service = new ProjectLearningNoteService(database, {
      get: vi.fn(() => project),
    });
    expect(() =>
      service.save(
        'project-1',
        'x'.repeat(PROJECT_LEARNING_NOTE_MAX_LENGTH + 1),
        0,
      ),
    ).toThrow();
    expect(database.save).not.toHaveBeenCalled();
  });
});
