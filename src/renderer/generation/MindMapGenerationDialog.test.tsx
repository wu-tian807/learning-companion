import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { MindMapGenerationDialog } from './MindMapGenerationDialog';

const now = Date.parse('2026-08-02T10:00:00.000Z');
const sourceAssets: readonly AssetSnapshot[] = [
  {
    id: 'pdf-source',
    projectId: 'project',
    name: '机器学习课程讲义',
    mediaType: 'application/pdf',
    creationKind: 'imported',
    contentRef: createProjectWorkspaceContentRef(
      '.learning-companion/assets/imported/machine-learning.pdf',
    ),
    contentStatus: {
      availability: 'available',
      checkedTime: now,
    },
    createdTime: now,
    updatedTime: now,
  },
  {
    id: 'text-source',
    projectId: 'project',
    name: '期末复习重点',
    mediaType: 'text/plain',
    creationKind: 'imported',
    contentRef: createProjectWorkspaceContentRef(
      '.learning-companion/assets/imported/review.txt',
    ),
    contentStatus: {
      availability: 'available',
      checkedTime: now,
    },
    createdTime: now,
    updatedTime: now,
  },
];

describe('MindMapGenerationDialog', () => {
  it('renders the fixed source summary and unrestricted prompt', () => {
    const html = renderToStaticMarkup(
      <MindMapGenerationDialog
        projectId="project"
        sourceAssets={sourceAssets}
        mediaLabel={(mediaType) =>
          mediaType === 'application/pdf' ? 'PDF' : '纯文本'
        }
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('生成思维导图');
    expect(html).toContain('2 项');
    expect(html).toContain('机器学习课程讲义');
    expect(html).toContain('期末复习重点');
    expect(html).toContain('PDF');
    expect(html).toContain('纯文本');
    expect(html).toContain('补充要求');
    expect(html).not.toContain('maxlength');
    expect(html).not.toContain('type="checkbox"');
  });
});
