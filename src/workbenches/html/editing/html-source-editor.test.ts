import { describe, expect, it } from 'vitest';

import {
  beginHtmlSourceEdit,
  HTML_EDIT_LIMITS,
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
    expect(contents.resolvedTarget.frameUrl).toBeUndefined();
  });

  it('supports standard CSS selectors beyond the common subset', () => {
    const edit = beginHtmlSourceEdit({
      source:
        '<html><body><main id="lesson">' +
        '<p data-kind="intro-primary">First</p><p hidden>Second</p>' +
        '</main></body></html>',
      locator: {
        kind: 'selector',
        selector:
          '#lesson > p:first-child:not([hidden])[data-kind^="intro"]',
      },
      scope: 'element',
    });

    expect(edit.currentHtml).toBe(
      '<p data-kind="intro-primary">First</p>',
    );
  });

  it('locates SVG and MathML elements without losing source ranges', () => {
    const source =
      '<html><body><svg><linearGradient id="gradient">' +
      '<stop offset="0"></stop></linearGradient></svg>' +
      '<math><mrow><mi>x</mi></mrow></math></body></html>';
    const svg = beginHtmlSourceEdit({
      source,
      locator: {
        kind: 'selector',
        selector: 'svg linearGradient#gradient',
      },
      scope: 'element',
    });
    const math = beginHtmlSourceEdit({
      source,
      locator: { kind: 'selector', selector: 'math mi' },
      scope: 'contents',
    });

    expect(svg.currentHtml).toBe(
      '<linearGradient id="gradient"><stop offset="0"></stop></linearGradient>',
    );
    expect(math.currentHtml).toBe('x');
  });

  it('rejects empty and oversized selectors', () => {
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '   ' },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_EMPTY');
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: {
            kind: 'selector',
            selector: 'a'.repeat(HTML_EDIT_LIMITS.selectorLength + 1),
          },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_TOO_LARGE');
  });

  it('rejects documents larger than the parser limit', () => {
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source: ' '.repeat(HTML_EDIT_LIMITS.documentLength + 1),
          locator: { kind: 'selector', selector: 'html' },
          scope: 'element',
        }),
      ),
    ).toBe('DOCUMENT_TOO_LARGE');
  });

  it('rejects target regions larger than the edit limit', () => {
    expect(
      code(() =>
        beginHtmlSourceEdit({
          source:
            '<html><body><main id="target">' +
            'x'.repeat(HTML_EDIT_LIMITS.regionLength + 1) +
            '</main></body></html>',
          locator: { kind: 'selector', selector: '#target' },
          scope: 'contents',
        }),
      ),
    ).toBe('REGION_TOO_LARGE');
  });

  it('rejects replacements larger than the edit limit', () => {
    const edit = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson' },
      scope: 'contents',
    });

    expect(
      code(() =>
        replaceHtmlSourceEdit(
          edit,
          'x'.repeat(HTML_EDIT_LIMITS.replacementLength + 1),
        ),
      ),
    ).toBe('REGION_TOO_LARGE');
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

  it('replaces an explicitly sourced document element', () => {
    const edit = beginHtmlSourceEdit({
      source: '<!doctype html><html><head></head><body>A</body></html>',
      locator: { kind: 'selector', selector: 'html' },
      scope: 'element',
    });
    const replaced = replaceHtmlSourceEdit(
      edit,
      '<html lang="zh"><head></head><body><main>B</main></body></html>',
    );

    expect(replaced.source).toBe(
      '<!doctype html><html lang="zh"><head></head><body><main>B</main></body></html>',
    );
    expect(replaced.resolvedTarget.element).toMatchObject({ tagName: 'html' });
  });

  it('does not execute scripts or fetch resources while locating source', () => {
    delete (globalThis as { __htmlEditExecuted?: boolean }).__htmlEditExecuted;
    const edit = beginHtmlSourceEdit({
      source:
        '<html><body><script>globalThis.__htmlEditExecuted=true</script>' +
        '<img src="https://invalid.example/image.png"></body></html>',
      locator: { kind: 'selector', selector: 'script' },
      scope: 'contents',
    });

    expect(edit.currentHtml).toContain('__htmlEditExecuted');
    expect(
      (globalThis as { __htmlEditExecuted?: boolean }).__htmlEditExecuted,
    ).toBeUndefined();
  });
});
