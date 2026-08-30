import { describe, expect, it } from 'vitest';

import {
  beginHtmlSourceEdit,
  HtmlSourceEditError,
  replaceHtmlSourceEdit,
} from './html-source-editor';

const SOURCE =
  '<!doctype html><html><head><title>Lesson</title></head><body>' +
  '<main id="lesson"><p class="intro" aria-label="intro">Hello</p></main>' +
  '</body></html>';

function code(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof HtmlSourceEditError ? error.code : undefined;
  }
}

describe('HTML parse5 source editor', () => {
  it('resolves common unique selectors to exact source ranges', () => {
    const contents = beginHtmlSourceEdit({
      source: SOURCE,
      locator: {
        kind: 'selector',
        selector: '#lesson > p.intro[aria-label="intro"]',
      },
      scope: 'contents',
    });
    const element = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: 'main p' },
      scope: 'element',
    });

    expect(contents.currentHtml).toBe('Hello');
    expect(element.currentHtml).toBe(
      '<p class="intro" aria-label="intro">Hello</p>',
    );
    expect(contents.resolvedTarget.element).toMatchObject({
      tagName: 'p',
      ariaLabel: 'intro',
      textQuote: 'Hello',
    });
  });

  it('rejects invalid, missing, non-unique, and implicit-source targets', () => {
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '[' },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_INVALID');
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '.missing' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_NOT_FOUND');
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: '<p>A</p><p>B</p>',
          locator: { kind: 'selector', selector: 'p' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_NOT_UNIQUE');
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: '<main>Body</main>',
          locator: { kind: 'selector', selector: 'body' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_HAS_NO_SOURCE');
  });

  it('uses a strict DOM path and fingerprint locator', () => {
    const begun = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });

    expect(
      beginHtmlSourceEdit({
        source: SOURCE,
        locator: { kind: 'dom-anchor', anchor: begun.resolvedTarget },
        scope: 'element',
      }).currentHtml,
    ).toBe(begun.currentHtml);
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: {
            kind: 'dom-anchor',
            anchor: {
              ...begun.resolvedTarget,
              element: {
                ...begun.resolvedTarget.element,
                textQuote: 'Changed',
              },
            },
          },
          scope: 'element',
        }),
      ),
    ).toBe('ANCHOR_MISMATCH');
  });

  it('replaces contents or an element and returns the updated anchor', () => {
    const contents = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'contents',
    });
    const contentsResult = replaceHtmlSourceEdit(
      contents,
      '<strong>Updated</strong>',
    );
    expect(contentsResult.source).toContain(
      '<p class="intro" aria-label="intro"><strong>Updated</strong></p>',
    );
    expect(contentsResult.resolvedTarget.element).toMatchObject({
      path: contents.resolvedTarget.element.path,
      textQuote: 'Updated',
    });

    const element = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });
    const elementResult = replaceHtmlSourceEdit(
      element,
      '<section id="result">Done</section>',
    );
    expect(elementResult.resolvedTarget.element).toMatchObject({
      tagName: 'section',
      id: 'result',
      textQuote: 'Done',
    });
  });
});
