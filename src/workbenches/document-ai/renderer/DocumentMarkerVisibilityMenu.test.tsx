import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DocumentMarkerVisibilityMenu } from './DocumentMarkerVisibilityMenu';

describe('DocumentMarkerVisibilityMenu', () => {
  it('exposes independent controls for question and attachment markers', () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkerVisibilityMenu
        open
        showQuestionAnchors
        showAttachments={false}
        onOpenChange={vi.fn()}
        onShowQuestionAnchorsChange={vi.fn()}
        onShowAttachmentsChange={vi.fn()}
      />,
    );

    expect(markup).toContain('显示提问框选');
    expect(markup).toContain('显示附着标注');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
  });
});
