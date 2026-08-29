import type { WorkbenchActionBundle } from '../../../renderer/workbench/actions/workbench-action-bundle';

export function createDocumentAnnotationActions({
  attachmentCount,
  questionAnchorsVisible,
  attachmentsVisible,
  indexOpen,
  onToggleQuestionAnchors,
  onToggleAttachments,
  onToggleIndex,
}: {
  readonly attachmentCount: number;
  readonly questionAnchorsVisible: boolean;
  readonly attachmentsVisible: boolean;
  readonly indexOpen: boolean;
  readonly onToggleQuestionAnchors: () => void;
  readonly onToggleAttachments: () => void;
  readonly onToggleIndex: () => void;
}): WorkbenchActionBundle {
  return {
    actions: [
      { id: 'document.questions.toggle-markers', enabled: true, execute: onToggleQuestionAnchors },
      { id: 'document.attachments.toggle-markers', enabled: attachmentCount > 0, execute: onToggleAttachments },
      { id: 'document.attachments.toggle-index', enabled: attachmentCount > 0, execute: onToggleIndex },
    ],
    contributions: [
      {
        id: 'document.questions.toggle-markers.header',
        actionId: 'document.questions.toggle-markers',
        surface: 'header',
        group: '10-document-annotations',
        order: 10,
        presentation: {
          kind: 'checkbox',
          label: questionAnchorsVisible ? '隐藏提问' : '显示提问',
          checked: !questionAnchorsVisible,
          description: questionAnchorsVisible ? '隐藏文档上的提问区域' : '显示文档上的提问区域',
        },
      },
      {
        id: 'document.attachments.toggle-markers.header',
        actionId: 'document.attachments.toggle-markers',
        surface: 'header',
        group: '10-document-annotations',
        order: 20,
        presentation: {
          kind: 'checkbox',
          label: attachmentsVisible ? '隐藏附着' : '显示附着',
          checked: !attachmentsVisible,
          badge: String(attachmentCount),
          disabledReason: attachmentCount === 0 ? '当前文档还没有附着内容' : undefined,
          description: attachmentsVisible ? '隐藏文档上的附着区域' : '显示文档上的附着区域',
        },
      },
      {
        id: 'document.attachments.toggle-index.header',
        actionId: 'document.attachments.toggle-index',
        surface: 'header',
        group: '10-document-annotations',
        order: 30,
        presentation: {
          kind: 'action',
          label: '文档标注',
          badge: String(attachmentCount),
          expanded: indexOpen,
          disabledReason: attachmentCount === 0 ? '当前文档还没有附着内容' : undefined,
          description: '打开标注列表并定位到原文',
        },
      },
    ],
  };
}
