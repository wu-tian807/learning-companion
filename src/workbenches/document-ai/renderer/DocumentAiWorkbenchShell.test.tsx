import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  hostRenderCount: 0,
}));

vi.mock('./ai-chat/AiChatPanelHost', () => ({
  AiChatPanelHost: (props: { readonly onAttachAnswer?: unknown }) => {
    void props;
    capture.hostRenderCount += 1;
    return null;
  },
}));

vi.mock('./AttachmentHost', () => ({
  AttachmentHost: () => null,
}));

import { DocumentAiWorkbenchShell } from './DocumentAiWorkbenchShell';

function renderShell(allowAnswerAttachments: boolean): void {
  renderToStaticMarkup(
    <DocumentAiWorkbenchShell
      projectId="project"
      assetId="asset"
      attachments={[]}
      refreshAttachments={vi.fn(async () => undefined)}
      onError={vi.fn()}
      allowAnswerAttachments={allowAnswerAttachments}
    >
      <div>document</div>
    </DocumentAiWorkbenchShell>,
  );
}

describe('DocumentAiWorkbenchShell', () => {
  it('does not mount a second AI panel below the Project-level question host', () => {
    capture.hostRenderCount = 0;
    renderShell(false);
    renderShell(true);
    expect(capture.hostRenderCount).toBe(0);
  });
});
