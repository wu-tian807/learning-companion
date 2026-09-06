import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { ProjectLearningNoteReferenceLink } from '../../../shared/project-learning-notes';
import { resolveLearningNoteSourceMarks } from './learning-note-source-marks';

const target = {
  scope: 'content' as const,
  targetType: 'epub.cfi-range',
  targetVersion: 1,
  targetPayload: { cfiRange: 'epubcfi(/6/2!/4/2)' },
};

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  typeId: 'epub.ai-explanation',
  typeVersion: 1,
  target,
  metadata: {},
  createdTime: 1,
  updatedTime: 1,
};

describe('learning-note source marks', () => {
  it('resolves Attachment links back to their current AssetTarget', () => {
    const references: ProjectLearningNoteReferenceLink[] = [{
      projectId: 'project-1',
      assetId: 'asset-1',
      attachmentId: 'attachment-1',
    }];

    expect(
      resolveLearningNoteSourceMarks(
        'project-1',
        'asset-1',
        references,
        [attachment],
      ),
    ).toEqual([{ id: 'attachment:attachment-1', target }]);
  });

  it('keeps legacy direct targets visible and rejects foreign or deleted links', () => {
    const references: ProjectLearningNoteReferenceLink[] = [
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-1',
        target,
      },
      {
        projectId: 'project-2',
        assetId: 'asset-1',
        attachmentId: 'attachment-1',
      },
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        attachmentId: 'deleted',
      },
    ];

    const marks = resolveLearningNoteSourceMarks(
      'project-1',
      'asset-1',
      references,
      [attachment],
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]?.target).toEqual(target);
    expect(marks[0]?.id).toContain('legacy:');
  });
});
