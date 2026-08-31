import { describe, expect, it } from 'vitest';

import {
  HtmlEditValidationError,
  validateHtmlFragment,
} from './html-fragment-validator';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

function code(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof HtmlEditValidationError ? error.code : undefined;
  }
}

describe('HTML fragment validator', () => {
  it('allows multiple roots for contents and exactly one element for element', () => {
    expect(() =>
      validateHtmlFragment(
        '<p>A</p><p>B</p>',
        { tagName: 'div', namespaceURI: HTML },
        'contents',
      ),
    ).not.toThrow();
    expect(() =>
      validateHtmlFragment(
        ' \n<section>Done</section>\t',
        { tagName: 'body', namespaceURI: HTML },
        'element',
      ),
    ).not.toThrow();
    expect(
      code(() =>
        validateHtmlFragment(
          '<p>A</p><p>B</p>',
          { tagName: 'body', namespaceURI: HTML },
          'element',
        ),
      ),
    ).toBe('REPLACEMENT_SCOPE_INVALID');
    expect(
      code(() =>
        validateHtmlFragment(
          '',
          { tagName: 'body', namespaceURI: HTML },
          'element',
        ),
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
      code(() =>
        validateHtmlFragment(
          replacement,
          { tagName: 'body', namespaceURI: HTML },
          'contents',
        ),
      ),
    ).toMatch(/^REPLACEMENT_/u);
  });

  it('accepts void, raw-text, template, SVG, and MathML elements', () => {
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
      validateHtmlFragment(
        '<circle cx="1" />',
        { tagName: 'svg', namespaceURI: SVG },
        'contents',
      ),
    ).not.toThrow();
    expect(() =>
      validateHtmlFragment(
        '<mrow><mi>x</mi></mrow>',
        { tagName: 'math', namespaceURI: MATHML },
        'contents',
      ),
    ).not.toThrow();
  });

  it('rejects stray closing tags and HTML self-closing repair', () => {
    expect(
      code(() =>
        validateHtmlFragment(
          '</span>',
          { tagName: 'div', namespaceURI: HTML },
          'contents',
        ),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      code(() =>
        validateHtmlFragment(
          '<div />',
          { tagName: 'body', namespaceURI: HTML },
          'element',
        ),
      ),
    ).toBe('REPLACEMENT_PARSE_ERROR');
  });

  it('rejects implicit table insertion, foster parenting, and invalid select children', () => {
    expect(
      code(() =>
        validateHtmlFragment(
          '<tr><td>x</td></tr>',
          { tagName: 'table', namespaceURI: HTML },
          'contents',
        ),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      code(() =>
        validateHtmlFragment(
          '<table>text<div>x</div></table>',
          { tagName: 'div', namespaceURI: HTML },
          'contents',
        ),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
    expect(
      code(() =>
        validateHtmlFragment(
          '<div>x</div>',
          { tagName: 'select', namespaceURI: HTML },
          'contents',
        ),
      ),
    ).toBe('REPLACEMENT_REPAIRED');
  });
});
