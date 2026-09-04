import { describe, expect, it } from 'vitest';

import {
  isProjectLearningNoteProjectRequest,
  isSaveProjectLearningNoteRequest,
  PROJECT_LEARNING_NOTE_MAX_LENGTH,
} from './project-learning-notes';

describe('Project learning note contracts', () => {
  it('accepts an empty Markdown note and a non-negative revision', () => {
    expect(
      isSaveProjectLearningNoteRequest({
        projectId: 'project-1',
        markdown: '',
        expectedRevision: 0,
      }),
    ).toBe(true);
  });

  it('rejects malformed identities, revisions and oversized Markdown', () => {
    expect(isProjectLearningNoteProjectRequest({ projectId: ' project-1' })).toBe(
      false,
    );
    expect(
      isSaveProjectLearningNoteRequest({
        projectId: 'project-1',
        markdown: '# note',
        expectedRevision: -1,
      }),
    ).toBe(false);
    expect(
      isSaveProjectLearningNoteRequest({
        projectId: 'project-1',
        markdown: 'x'.repeat(PROJECT_LEARNING_NOTE_MAX_LENGTH + 1),
        expectedRevision: 0,
      }),
    ).toBe(false);
  });
});
