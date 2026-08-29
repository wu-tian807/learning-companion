import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  ATTACHMENT_MARKER_MOTION_CLASS,
  AttachmentHost,
} from './AttachmentHost';

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project',
  assetId: 'asset',
  typeId: 'ai.annotation',
  typeVersion: 1,
  target: { scope: 'asset' },
  metadata: { questionPreview: '解释这里' },
  createdTime: 1,
  updatedTime: 1,
};

describe('AttachmentHost', () => {
  it('does not animate marker coordinates while the document scrolls', () => {
    expect(ATTACHMENT_MARKER_MOTION_CLASS).toBe('transition-colors');
    expect(ATTACHMENT_MARKER_MOTION_CLASS).not.toContain('transition-all');
  });

  it('renders the annotation sidebar only when the header action opens it', () => {
    const html = renderToStaticMarkup(
      <AttachmentHost
        attachments={[attachment]}
        assetId="asset"
        projectId="project"
        sidebarOpen={false}
        onSidebarOpenChange={() => undefined}
      />,
    );

    expect(html).not.toContain('标注 1');
    expect(html).not.toContain('文档标注');
  });
});
