import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../shared/attachments/contracts';
import {
  parseProjectLearningNoteAttachmentHref,
  PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX,
  PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX,
} from '../../shared/project-learning-notes';
import {
  createLearningNoteAttachmentMarkdown,
  projectLearningNoteAttachmentOptionLabel,
} from './project-learning-note-links';

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  typeId: 'epub.ai-explanation',
  typeVersion: 1,
  target: {
    scope: 'content',
    targetType: 'epub.cfi-range',
    targetVersion: 1,
    targetPayload: {
      cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
      quote: {
        exact: '  一段会被   展示的原文  ',
        prefix: '',
        suffix: '',
      },
    },
  },
  metadata: {},
  createdTime: 1,
  updatedTime: 1,
};

describe('Project learning-note Attachment links', () => {
  it('keeps the Markdown label limited to the Asset name and locator', () => {
    const markdown = createLearningNoteAttachmentMarkdown(
      '教材 [上]',
      attachment,
    );

    expect(markdown).toContain('[教材 \\[上\\] · 定位]');
    expect(markdown).not.toContain('一段会被 展示的原文');
    expect(markdown).not.toContain('AI 解释');
    expect(markdown).toContain(PROJECT_LEARNING_NOTE_ATTACHMENT_LINK_PREFIX);
    expect(markdown).not.toContain(PROJECT_LEARNING_NOTE_TARGET_LINK_PREFIX);
  });

  it('stores only the Attachment identity in the generated href', () => {
    const markdown = createLearningNoteAttachmentMarkdown('教材', attachment);
    const href = markdown.match(/\((#[^)]+)\)$/u)?.[1];

    expect(parseProjectLearningNoteAttachmentHref(href ?? '')).toEqual({
      projectId: 'project-1',
      assetId: 'asset-1',
      attachmentId: 'attachment-1',
    });
    expect(href).not.toContain('cfiRange');
    expect(href).not.toContain('targetPayload');
  });

  it('shows a bounded source excerpt only in the Attachment selector', () => {
    const longAttachment: AssetAttachment = {
      ...attachment,
      target: {
        scope: 'content',
        targetType: 'epub.cfi-range',
        targetVersion: 1,
        targetPayload: {
          cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
          quote: { exact: '学'.repeat(90), prefix: '', suffix: '' },
        },
      },
    };

    const optionLabel = projectLearningNoteAttachmentOptionLabel(longAttachment);
    expect(optionLabel).toBe(`AI 解释 · “${'学'.repeat(80)}…”`);
    expect(optionLabel).not.toContain('学'.repeat(81));
  });

  it('uses the Attachment type as selector fallback for non-text targets', () => {
    const imageAttachment: AssetAttachment = {
      ...attachment,
      typeId: 'image.region-note',
      target: {
        scope: 'content',
        targetType: 'image.region',
        targetVersion: 1,
        targetPayload: { x: 0, y: 0, width: 0.5, height: 0.5 },
      },
    };

    expect(projectLearningNoteAttachmentOptionLabel(imageAttachment)).toBe(
      'Attachment · image.region-note',
    );
  });
});
