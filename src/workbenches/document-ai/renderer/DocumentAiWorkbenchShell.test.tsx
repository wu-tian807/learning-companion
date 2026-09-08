import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useWorkbenchContributions } from '../../../renderer/workbench/runtime/use-workbench-contributions';

vi.mock('./AttachmentHost', () => ({
  AttachmentHost: () => null,
}));
vi.mock(
  '../../../renderer/workbench/runtime/use-workbench-contributions',
  () => ({ useWorkbenchContributions: vi.fn() }),
);

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
    vi.mocked(useWorkbenchContributions).mockClear();
    const html = renderShell();
    expect(html).toContain('document');
    expect(html).not.toContain('AI 问答');
    expect(useWorkbenchContributions).not.toHaveBeenCalled();
  });

  it('registers the legacy attachment toggle only when a paged document opts in', () => {
    vi.mocked(useWorkbenchContributions).mockClear();
    renderToStaticMarkup(
      <DocumentAiWorkbenchShell
        projectId="project"
        assetId="asset"
        attachments={[]}
        refreshAttachments={vi.fn(async () => undefined)}
        onError={vi.fn()}
        attachmentVisibilityControl
      >
        <div>document</div>
      </DocumentAiWorkbenchShell>,
    );

    expect(useWorkbenchContributions).toHaveBeenCalledWith(
      'document-ai:asset.attachments',
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({ id: 'document-ai.toggle-attachments' }),
        ]),
      }),
    );
  });
});
