import type {
  ContextMenuParams,
  WebFrameMain,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  HtmlContextMenuFacilityAdapter,
  HtmlTextSelectionFacilityAdapter,
  READ_HTML_CONTEXT_ELEMENT_SCRIPT,
  READ_HTML_CONTEXT_SELECTION_SCRIPT,
  READ_HTML_FRAME_SELECTION_SCRIPT,
} from './main-facility-adapters';
import {
  HTML_WORKBENCH_ID,
  isHtmlDomTarget,
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
    rootUrl: 'learning-content://resource/html',
    frame: sourceFrame,
    source,
  };
}

describe('HTML Main Facility adapters', () => {
  it('captures a DOM-owned element Anchor with the context menu', async () => {
    const executeJavaScript = vi.fn(async () => ({
      element: {
        tagName: 'div',
        path: [1, 2, 0],
        id: 'lesson-card',
        role: 'article',
        ariaLabel: '课程内容',
        textQuote: '这里是课程正文',
      },
      rect: { x: 8, y: 12, width: 200, height: 60 },
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
        isHtmlDomTarget(payload.target),
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

  it('publishes an HTML DOM Anchor and ephemeral rect for settled selection', async () => {
    const executeJavaScript = vi.fn(async () => ({
      text: '选中的正文',
      rect: { x: 10, y: 20, width: 120, height: 18 },
      element: {
        path: [1, 0],
        tagName: 'p',
        textQuote: '选中的正文',
      },
    }));
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
        isHtmlDomTarget(payload.target),
    ).toBe(true);
    expect(payload).toMatchObject({
      target: {
        targetType: 'html.dom',
        targetPayload: {
          element: { path: [1, 0], tagName: 'p' },
        },
      },
      rect: { x: 10, y: 20, width: 120, height: 18 },
    });
    expect(
      (payload as { target?: { targetPayload?: Record<string, unknown> } })
        .target?.targetPayload,
    ).not.toHaveProperty('frameUrl');
  });

  it('keeps frame identity only for anchors inside a child frame', async () => {
    const childFrame = {
      url: 'https://widgets.example.com/chapter',
      executeJavaScript: vi.fn(async () => ({
        text: '子页面正文',
        element: { path: [1], tagName: 'p', textQuote: '子页面正文' },
      })),
    } as unknown as WebFrameMain;

    const payload = await new HtmlTextSelectionFacilityAdapter().capture(
      context(childFrame),
    );

    expect(payload).toMatchObject({
      target: {
        targetPayload: { frameUrl: 'https://widgets.example.com/chapter' },
      },
    });
  });

  it('does not publish a target when the inferred DOM element is malformed', async () => {
    const sourceFrame = frame(
      vi.fn(async () => ({
        text: '仍可引用的正文',
        rect: { x: 10, y: 20, width: 120, height: 18 },
        element: { path: [-1], tagName: 'p' },
      })),
    );
    const payload = await new HtmlTextSelectionFacilityAdapter().capture(
      context(sourceFrame),
    );

    expect(payload).toEqual({
      frameUrl: 'learning-content://resource/html',
    });
  });

  it('uses the same DOM Anchor shape for a context-menu text selection', async () => {
    const executeJavaScript = vi.fn(async () => ({
      text: '公式：$x^2$',
      element: { path: [1, 2], tagName: 'td', textQuote: '公式：$x^2$' },
      rect: { x: 20, y: 30, width: 80, height: 20 },
    }));
    const sourceFrame = frame(executeJavaScript);
    const payload = await new HtmlContextMenuFacilityAdapter().capture(
      context(sourceFrame, {
        x: 20,
        y: 30,
        frameURL: sourceFrame.url,
        selectionText: '公式：x2x^2x2',
        linkURL: '',
        mediaType: 'none',
        srcURL: '',
      } as ContextMenuParams),
    );

    expect(executeJavaScript).toHaveBeenCalledWith(
      READ_HTML_CONTEXT_SELECTION_SCRIPT,
    );
    expect(
      payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        isHtmlDomTarget(payload.target),
    ).toBe(true);
    expect(payload).toMatchObject({ selectionText: '公式：$x^2$' });
  });
});
