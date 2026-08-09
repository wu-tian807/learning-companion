import type {
  ContextMenuParams,
  WebFrameMain,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  HtmlContextMenuFacilityAdapter,
  HtmlTextSelectionFacilityAdapter,
  READ_HTML_CONTEXT_ELEMENT_SCRIPT,
  READ_HTML_FRAME_SELECTION_SCRIPT,
} from './main-facility-adapters';
import {
  HTML_WORKBENCH_ID,
  isHtmlElementTarget,
  isHtmlQuoteTarget,
} from './shared';

function frame(
  executeJavaScript: ReturnType<typeof vi.fn>,
): WebFrameMain {
  return {
    url: 'learning-content://resource/html',
    executeJavaScript,
  } as unknown as WebFrameMain;
}

function context(sourceFrame: WebFrameMain, source?: unknown) {
  return {
    sessionId: 'session-1',
    workbenchId: HTML_WORKBENCH_ID,
    trigger: 'test',
    frame: sourceFrame,
    source,
  };
}

describe('HTML Main Facility adapters', () => {
  it('captures a DOM-owned element Anchor with the context menu', async () => {
    const executeJavaScript = vi.fn(async () => ({
      tagName: 'div',
      domPath: [1, 2, 0],
      id: 'lesson-card',
      role: 'article',
      ariaLabel: '课程内容',
      textQuote: '这里是课程正文',
    }));
    const sourceFrame = frame(executeJavaScript);
    const adapter = new HtmlContextMenuFacilityAdapter();
    const payload = await adapter.capture(
      context(sourceFrame, {
        x: 12,
        y: 24,
        frameURL: sourceFrame.url,
        selectionText: '',
        linkURL: '',
        mediaType: 'none',
        srcURL: '',
      } as ContextMenuParams),
    );

    expect(executeJavaScript).toHaveBeenCalledWith(
      READ_HTML_CONTEXT_ELEMENT_SCRIPT,
    );
    expect(payload).toMatchObject({
      x: 12,
      y: 24,
      frameUrl: sourceFrame.url,
      mediaType: 'none',
    });
    expect(
      payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        isHtmlElementTarget(payload.target),
    ).toBe(true);
  });

  it('keeps the menu usable when DOM probing is unavailable', async () => {
    const sourceFrame = frame(
      vi.fn(async () => {
        throw new Error('detached');
      }),
    );
    const payload = await new HtmlContextMenuFacilityAdapter().capture(
      context(sourceFrame, {
        x: 1,
        y: 2,
        frameURL: sourceFrame.url,
        selectionText: '选区',
        linkURL: 'https://example.com',
        mediaType: 'none',
        srcURL: '',
      } as ContextMenuParams),
    );

    expect(payload).toMatchObject({
      selectionText: '选区',
      linkUrl: 'https://example.com',
    });
    expect(payload).not.toHaveProperty('target');
  });

  it('publishes an HTML quote Anchor for settled selection', async () => {
    const executeJavaScript = vi.fn(async () => '选中的正文');
    const sourceFrame = frame(executeJavaScript);
    const payload = await new HtmlTextSelectionFacilityAdapter().capture(
      context(sourceFrame),
    );

    expect(executeJavaScript).toHaveBeenCalledWith(
      READ_HTML_FRAME_SELECTION_SCRIPT,
    );
    expect(
      payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        isHtmlQuoteTarget(payload.target),
    ).toBe(true);
  });
});
