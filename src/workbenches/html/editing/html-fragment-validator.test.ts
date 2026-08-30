import { describe, expect, it } from 'vitest';

import { HtmlEditError } from './html-document-parser';
import { validateHtmlFragment } from './html-fragment-validator';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof HtmlEditError ? error.code : undefined;
  }
}

describe('HTML fragment validator', () => {
  it('allows multiple roots for contents and exactly one element for element', () => {
    expect(
      validateHtmlFragment('<p>A</p><p>B</p>', {
        tagName: 'div',
        namespaceURI: HTML,
      }, 'contents'),
    ).toEqual({ topLevelElementCount: 2 });
    expect(
      validateHtmlFragment(' \n<section>Done</section>\t', {
        tagName: 'body',
        namespaceURI: HTML,
      }, 'element'),
    ).toEqual({ topLevelElementCount: 1 });
    expect(
      errorCode(() =>
        validateHtmlFragment('<p>A</p><p>B</p>', {
          tagName: 'body',
          namespaceURI: HTML,
        }, 'element'),
      ),
    ).toBe('REPLACEMENT_SCOPE_INVALID');
    expect(
      errorCode(() =>
        validateHtmlFragment('', {
          tagName: 'body',
          namespaceURI: HTML,
        }, 'element'),
      ),
    ).toBe('REPLACEMENT_SCOPE_INVALID');
  });

  it.each([
    '<div><span>x</div>',
    '<ul><li>one<li>two</ul>',
    '<p>one<p>two',
    '<div>x',
  ])('rejects non-explicit closure: %s', (replacement) => {
    expect(
      errorCode(() =>
        validateHtmlFragment(replacement, {
          tagName: 'body',
          namespaceURI: HTML,
        }, 'contents'),
      ),
    ).toMatch(/^REPLACEMENT_/);
  });

  it('rejects stray closing tags and HTML self-closing repair', () => {
    expect(
      errorCode(() =>
        validateHtmlFragment('</span>', {
          tagName: 'div',
          namespaceURI: HTML,
        }, 'contents'),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      errorCode(() =>
        validateHtmlFragment('<div />', {
          tagName: 'body',
          namespaceURI: HTML,
        }, 'element'),
      ),
    ).toBe('REPLACEMENT_PARSE_ERROR');
  });

  it('accepts HTML void elements and explicitly closed script/style/template', () => {
    expect(() =>
      validateHtmlFragment(
        '<img src="x"><br><script>if (a < b) c()</script>' +
          '<style>.a > .b { color: red }</style>' +
          '<template><section>inside</section></template>',
        { tagName: 'div', namespaceURI: HTML },
        'contents',
      ),
    ).not.toThrow();
    expect(() =>
      validateHtmlFragment('if (a < b) { c(); }', {
        tagName: 'script',
        namespaceURI: HTML,
      }, 'contents'),
    ).not.toThrow();
  });

  it('accepts foreign self-closing elements and explicit SVG/MathML tags', () => {
    expect(() =>
      validateHtmlFragment('<circle cx="1" />', {
        tagName: 'svg',
        namespaceURI: SVG,
      }, 'contents'),
    ).not.toThrow();
    expect(() =>
      validateHtmlFragment('<mrow><mi>x</mi></mrow>', {
        tagName: 'math',
        namespaceURI: MATHML,
      }, 'contents'),
    ).not.toThrow();
  });

  it('rejects implicit table insertion, foster parenting, and invalid select children', () => {
    expect(
      errorCode(() =>
        validateHtmlFragment('<tr><td>x</td></tr>', {
          tagName: 'table',
          namespaceURI: HTML,
        }, 'contents'),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      errorCode(() =>
        validateHtmlFragment('<table>text<div>x</div></table>', {
          tagName: 'div',
          namespaceURI: HTML,
        }, 'contents'),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      errorCode(() =>
        validateHtmlFragment('<div>x</div>', {
          tagName: 'select',
          namespaceURI: HTML,
        }, 'contents'),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
  });
});
