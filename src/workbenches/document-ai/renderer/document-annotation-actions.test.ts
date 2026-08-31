import { describe, expect, it, vi } from 'vitest';

import { createDocumentAnnotationActions } from './document-annotation-actions';

describe('createDocumentAnnotationActions', () => {
  it('places question visibility, attachment visibility and annotation index in one Workbench header group', () => {
    const bundle = createDocumentAnnotationActions({
      attachmentCount: 3,
      questionAnchorsVisible: true,
      attachmentsVisible: false,
      indexOpen: true,
      onToggleQuestionAnchors: vi.fn(),
      onToggleAttachments: vi.fn(),
      onToggleIndex: vi.fn(),
    });

    expect(bundle.contributions.map((item) => ({
      actionId: item.actionId,
      surface: item.surface,
      group: item.group,
      order: item.order,
    }))).toEqual([
      { actionId: 'document.questions.toggle-markers', surface: 'header', group: '10-document-annotations', order: 10 },
      { actionId: 'document.attachments.toggle-markers', surface: 'header', group: '10-document-annotations', order: 20 },
      { actionId: 'document.attachments.toggle-index', surface: 'header', group: '10-document-annotations', order: 30 },
    ]);
    expect(bundle.contributions[2]?.presentation).toMatchObject({
      label: '文档标注',
      badge: '3',
      expanded: true,
    });
  });

  it('disables attachment controls when the document has no attachments', () => {
    const bundle = createDocumentAnnotationActions({
      attachmentCount: 0,
      questionAnchorsVisible: true,
      attachmentsVisible: true,
      indexOpen: false,
      onToggleQuestionAnchors: vi.fn(),
      onToggleAttachments: vi.fn(),
      onToggleIndex: vi.fn(),
    });

    expect(bundle.actions.map((action) => action.enabled)).toEqual([true, false, false]);
  });
});
