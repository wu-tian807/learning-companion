import { describe, expect, it } from 'vitest';

import type { HtmlDomAnchorV1 } from '../shared';
import {
  HTML_EDIT_LIMITS,
  HtmlEditError,
} from './html-document-parser';
import {
  beginHtmlSourceEdit,
  replaceHtmlSourceEdit,
} from './html-source-editor';

const SOURCE =
  '<!doctype html><html><head><title>Lesson</title></head><body>' +
  '<main id="lesson"><p aria-label="intro">Hello 😀</p></main>' +
  '</body></html>';

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof HtmlEditError ? error.code : undefined;
  }
}

describe('HTML source editor', () => {
  it('resolves one selector to UTF-16 contents and element ranges', () => {
    const contents = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'contents',
    });
    const element = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });

    expect(contents.currentHtml).toBe('Hello 😀');
    expect(contents.range.end - contents.range.start).toBe('Hello 😀'.length);
    expect(element.currentHtml).toBe(
      '<p aria-label="intro">Hello 😀</p>',
    );
    expect(contents.resolvedTarget.element).toMatchObject({
      tagName: 'p',
      ariaLabel: 'intro',
      textQuote: 'Hello 😀',
    });
  });

  it('rejects invalid, absent, and non-unique selectors', () => {
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '[' },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_INVALID');
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '.missing' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_NOT_FOUND');
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: '<p>a</p><p>b</p>',
          locator: { kind: 'selector', selector: 'p' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_NOT_UNIQUE');
  });

  it('strictly validates DOM anchor path and fingerprints', () => {
    const begun = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });
    const anchor = begun.resolvedTarget;

    expect(
      beginHtmlSourceEdit({
        source: SOURCE,
        locator: { kind: 'dom-anchor', anchor },
        scope: 'element',
      }).currentHtml,
    ).toBe(begun.currentHtml);

    const drifted: HtmlDomAnchorV1 = {
      ...anchor,
      element: { ...anchor.element, textQuote: 'Changed' },
    };
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'dom-anchor', anchor: drifted },
          scope: 'element',
        }),
      ),
    ).toBe('ANCHOR_MISMATCH');

    const missing: HtmlDomAnchorV1 = {
      ...anchor,
      element: { ...anchor.element, path: [...anchor.element.path, 99] },
    };
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'dom-anchor', anchor: missing },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_NOT_FOUND');
  });

  it('rejects implicit nodes and accepts explicitly sourced document nodes', () => {
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: '<main>Body</main>',
          locator: { kind: 'selector', selector: 'body' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_HAS_NO_SOURCE');
    expect(
      beginHtmlSourceEdit({
        source: '<html><head></head><body>Body</body></html>',
        locator: { kind: 'selector', selector: 'body' },
        scope: 'contents',
      }).currentHtml,
    ).toBe('Body');
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: '<table><tr><td>x</td></tr></table>',
          locator: { kind: 'selector', selector: 'tbody' },
          scope: 'element',
        }),
      ),
    ).toBe('TARGET_HAS_NO_SOURCE');
  });

  it('replaces contents and emits an updated target anchor', () => {
    const edit = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'contents',
    });
    const replaced = replaceHtmlSourceEdit({
      edit,
      replacement: '<strong>Updated</strong> and complete',
    });

    expect(replaced.source).toContain(
      '<p aria-label="intro"><strong>Updated</strong> and complete</p>',
    );
    expect(replaced.resolvedTarget.element).toMatchObject({
      path: edit.resolvedTarget.element.path,
      tagName: 'p',
      ariaLabel: 'intro',
      textQuote: 'Updated and complete',
    });
  });

  it('replaces one element and locates a changed tag and id', () => {
    const edit = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });
    const replaced = replaceHtmlSourceEdit({
      edit,
      replacement: '<section id="result">Done</section>',
    });

    expect(replaced.resolvedTarget.element).toMatchObject({
      tagName: 'section',
      id: 'result',
      textQuote: 'Done',
    });
  });

  it('locates an element replacement surrounded by whitespace', () => {
    const edit = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: '#lesson p' },
      scope: 'element',
    });
    const replaced = replaceHtmlSourceEdit({
      edit,
      replacement: '\n  <section id="result">Done</section>\n',
    });

    expect(replaced.source).toContain(
      '<main id="lesson">\n  <section id="result">Done</section>\n</main>',
    );
    expect(replaced.resolvedTarget.element).toMatchObject({
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
    const replaced = replaceHtmlSourceEdit({
      edit,
      replacement:
        '<html lang="zh"><head></head><body><main>B</main></body></html>',
    });

    expect(replaced.source).toBe(
      '<!doctype html><html lang="zh"><head></head><body><main>B</main></body></html>',
    );
    expect(replaced.resolvedTarget.element).toMatchObject({ tagName: 'html' });
  });

  it('does not execute scripts or fetch external resources while parsing', () => {
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

  it('enforces selector, replacement, region, and document bounds', () => {
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: { kind: 'selector', selector: '' },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_EMPTY');
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: SOURCE,
          locator: {
            kind: 'selector',
            selector: 'p'.repeat(HTML_EDIT_LIMITS.selectorLength + 1),
          },
          scope: 'element',
        }),
      ),
    ).toBe('SELECTOR_TOO_LARGE');

    const edit = beginHtmlSourceEdit({
      source: SOURCE,
      locator: { kind: 'selector', selector: 'p' },
      scope: 'contents',
    });
    expect(
      errorCode(() =>
        replaceHtmlSourceEdit({
          edit,
          replacement: 'x'.repeat(HTML_EDIT_LIMITS.replacementLength + 1),
        }),
      ),
    ).toBe('REPLACEMENT_TOO_LARGE');
    expect(
      errorCode(() =>
        beginHtmlSourceEdit({
          source: 'x'.repeat(HTML_EDIT_LIMITS.documentLength + 1),
          locator: { kind: 'selector', selector: 'body' },
          scope: 'contents',
        }),
      ),
    ).toBe('DOCUMENT_TOO_LARGE');
  });
});
