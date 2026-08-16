import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  hostProps: undefined as
    | { readonly onAttachAnswer?: unknown }
    | undefined,
}));

vi.mock('./ai-chat/AiChatPanelHost', () => ({
  AiChatPanelHost: (props: { readonly onAttachAnswer?: unknown }) => {
    capture.hostProps = props;
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
  it('only provides answer attachment behavior when the Workbench enables it', () => {
    renderShell(false);
    expect(capture.hostProps?.onAttachAnswer).toBeUndefined();

    renderShell(true);
    expect(capture.hostProps?.onAttachAnswer).toEqual(expect.any(Function));
  });
});
