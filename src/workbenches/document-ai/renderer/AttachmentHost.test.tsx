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
  target: { scope: 'asset' },
  metadata: { questionPreview: '解释这里' },
  createdTime: 1,
  updatedTime: 1,
};

describe('AttachmentHost', () => {
  it('places the annotation launcher in the lower-right empty area', () => {
    const html = renderToStaticMarkup(
      <AttachmentHost attachments={[attachment]} assetId="asset" projectId="project" />,
    );

    expect(html).toContain('标注 1');
    expect(html).toContain('fixed bottom-5 right-5');
  });
});
