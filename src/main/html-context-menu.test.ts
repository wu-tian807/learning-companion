import { describe, expect, it } from 'vitest';

import { createHtmlContextMenuEvent } from './html-context-menu';

interface TestFrame {
  readonly url: string;
  readonly parent: TestFrame | null;
}

function frame(url: string, parent: TestFrame | null = null): TestFrame {
  return { url, parent };
}

describe('HTML frame context menu bridge', () => {
  it('relays a bounded context snapshot from the isolated HTML frame', () => {
    const event = createHtmlContextMenuEvent({
      x: 120,
      y: 240,
      frame: frame('learning-content://resource/session'),
      frameURL: 'learning-content://resource/session',
      selectionText: '线性规划',
      linkURL: 'https://example.com/chapter',
      mediaType: 'image',
      srcURL: 'https://example.com/figure.png',
    });

    expect(event).toEqual({
      x: 120,
      y: 240,
      frameUrl: 'learning-content://resource/session',
      selectionText: '线性规划',
      linkUrl: 'https://example.com/chapter',
      mediaType: 'image',
      sourceUrl: 'https://example.com/figure.png',
    });
  });

  it('recognizes nested external frames owned by an HTML document', () => {
    const owner = frame('learning-content://resource/session');
    const event = createHtmlContextMenuEvent({
      x: 10,
      y: 20,
      frame: frame('https://widgets.example.com/embed', owner),
      frameURL: 'https://widgets.example.com/embed',
      selectionText: '',
      linkURL: '',
      mediaType: 'none',
      srcURL: '',
    });

    expect(event?.frameUrl).toBe(
      'https://widgets.example.com/embed',
    );
  });

  it('ignores the app renderer and strips unsafe target URLs', () => {
    expect(
      createHtmlContextMenuEvent({
        x: 10,
        y: 20,
        frame: frame('http://localhost:5173'),
        frameURL: 'http://localhost:5173',
        selectionText: '',
        linkURL: '',
        mediaType: 'none',
        srcURL: '',
      }),
    ).toBeUndefined();

    expect(
      createHtmlContextMenuEvent({
        x: 10,
        y: 20,
        frame: frame('learning-content://resource/session'),
        frameURL: 'learning-content://resource/session',
        selectionText: '',
        linkURL: 'javascript:alert(1)',
        mediaType: 'plugin',
        srcURL: 'file:///private/image.png',
      }),
    ).toEqual({
      x: 10,
      y: 20,
      frameUrl: 'learning-content://resource/session',
      mediaType: 'none',
    });
  });
});
