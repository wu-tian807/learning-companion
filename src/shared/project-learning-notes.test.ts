import { describe, expect, it } from 'vitest';

import {
  createProjectLearningNoteAttachmentHref,
  createProjectLearningNoteTargetHref,
  isProjectLearningNoteProjectRequest,
  isSaveProjectLearningNoteRequest,
  parseProjectLearningNoteAttachmentHref,
  parseProjectLearningNoteReferenceHref,
  parseProjectLearningNoteTargetHref,
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

  it('round-trips a versioned AssetTarget without Markdown URL delimiters', () => {
    const link = {
      projectId: 'project-1',
      assetId: 'asset-epub',
      sourceRevision: 'revision-1',
      target: {
        scope: 'content' as const,
        targetType: 'epub.cfi-range',
        targetVersion: 1,
        targetPayload: {
          cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
          quote: '跨资料（定位）',
        },
      },
    };

    const href = createProjectLearningNoteTargetHref(link);

    expect(href).not.toMatch(/[()]/u);
    expect(parseProjectLearningNoteTargetHref(href)).toEqual(link);
  });

  it('rejects malformed, whole-Asset and unknown-version target links', () => {
    expect(parseProjectLearningNoteTargetHref('https://example.com')).toBeUndefined();
    expect(
      parseProjectLearningNoteTargetHref(
        '#learning-companion-target-v2=%7B%7D',
      ),
    ).toBeUndefined();
    expect(
      parseProjectLearningNoteTargetHref(
        '#learning-companion-target-v1=%E0%A4%A',
      ),
    ).toBeUndefined();

    const wholeAsset = encodeURIComponent(JSON.stringify({
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: 'revision-1',
      target: { scope: 'asset' },
    }));
    expect(
      parseProjectLearningNoteTargetHref(
        `#learning-companion-target-v1=${wholeAsset}`,
      ),
    ).toBeUndefined();
  });

  it('round-trips an Attachment reference without copying its AssetTarget', () => {
    const link = {
      projectId: 'project-1',
      assetId: 'asset-epub',
      attachmentId: 'attachment-explanation-1',
    };
    const href = createProjectLearningNoteAttachmentHref(link);

    expect(href).not.toMatch(/[()]/u);
    expect(parseProjectLearningNoteAttachmentHref(href)).toEqual(link);
    expect(parseProjectLearningNoteReferenceHref(href)).toEqual(link);
    expect(href).not.toContain('target');
  });

  it('rejects malformed Attachment references and unknown versions', () => {
    expect(
      parseProjectLearningNoteAttachmentHref(
        '#learning-companion-attachment-v1=%7B%22projectId%22%3A%22project-1%22%7D',
      ),
    ).toBeUndefined();
    expect(
      parseProjectLearningNoteReferenceHref(
        '#learning-companion-attachment-v2=%7B%7D',
      ),
    ).toBeUndefined();
  });
});
