import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./AttachmentHost', () => ({
  AttachmentHost: () => null,
}));

import { DocumentAiWorkbenchShell } from './DocumentAiWorkbenchShell';

function renderShell(): string {
  return renderToStaticMarkup(
    <DocumentAiWorkbenchShell
      projectId="project"
      assetId="asset"
      attachments={[]}
      refreshAttachments={vi.fn(async () => undefined)}
      onError={vi.fn()}
    >
      <div>document</div>
    </DocumentAiWorkbenchShell>,
  );
}

describe('DocumentAiWorkbenchShell', () => {
  it('owns marker and attachment chrome without mounting a Workbench-local chat panel', () => {
    const html = renderShell();
    expect(html).toContain('document');
    expect(html).not.toContain('AI 问答');
  });
});
