import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { AttachmentHost } from './AttachmentHost';

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project',
  assetId: 'asset',
  typeId: 'ai.annotation',
  typeVersion: 1,
  target: {
    scope: 'content',
    anchorType: 'pdf.region',
    anchorVersion: 1,
    anchorPayload: {
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
    },
  },
  metadata: { questionPreview: '解释这里' },
  createdTime: 1,
  updatedTime: 1,
};

describe('AttachmentHost', () => {
  it('does not render a floating annotation count launcher', () => {
    const html = renderToStaticMarkup(
      <AttachmentHost
        attachments={[attachment]}
        assetId="asset"
        projectId="project"
      />,
    );

    expect(html).not.toContain('标注 1');
    expect(html).not.toContain('文档标注');
  });
});
