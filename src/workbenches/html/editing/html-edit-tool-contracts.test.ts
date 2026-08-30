import { describe, expect, it } from 'vitest';

import { createHtmlDomTarget, createHtmlQuoteTarget } from '../shared';
import { HTML_EDIT_LIMITS } from './html-document-parser';
import {
  parseHtmlBeginEditInput,
  parseHtmlReplaceEditInput,
} from './html-edit-tool-contracts';

describe('HTML edit tool contracts', () => {
  it('parses strict selector and DOM Anchor begin inputs', () => {
    expect(
      parseHtmlBeginEditInput({
        locator: { kind: 'selector', selector: '#lesson' },
        scope: 'contents',
      }),
    ).toEqual({
      locator: { kind: 'selector', selector: '#lesson' },
      scope: 'contents',
    });
    expect(
      parseHtmlBeginEditInput({
        locator: {
          kind: 'dom-anchor',
          target: createHtmlDomTarget({
            frameUrl: 'learning-content://resource/html',
            element: { path: [1], tagName: 'main' },
          }),
        },
        scope: 'element',
      }),
    ).toBeDefined();
  });

  it('rejects empty, oversized, extra, and non-DOM begin input', () => {
    expect(
      parseHtmlBeginEditInput({
        locator: { kind: 'selector', selector: ' ' },
        scope: 'contents',
      }),
    ).toBeUndefined();
    expect(
      parseHtmlBeginEditInput({
        locator: {
          kind: 'selector',
          selector: 'x'.repeat(HTML_EDIT_LIMITS.selectorLength + 1),
        },
        scope: 'contents',
      }),
    ).toBeUndefined();
    expect(
      parseHtmlBeginEditInput({
        locator: { kind: 'selector', selector: 'main' },
        scope: 'contents',
        assetId: 'untrusted',
      }),
    ).toBeUndefined();
    expect(
      parseHtmlBeginEditInput({
        locator: {
          kind: 'dom-anchor',
          target: createHtmlQuoteTarget('legacy quote'),
        },
        scope: 'element',
      }),
    ).toBeUndefined();
  });

  it('parses bounded replace input and rejects extra or oversized data', () => {
    expect(
      parseHtmlReplaceEditInput({ editId: 'edit-1', html: '' }),
    ).toEqual({ editId: 'edit-1', html: '' });
    expect(
      parseHtmlReplaceEditInput({
        editId: 'edit-1',
        html: 'x'.repeat(HTML_EDIT_LIMITS.replacementLength + 1),
      }),
    ).toBeUndefined();
    expect(
      parseHtmlReplaceEditInput({
        editId: 'edit-1',
        html: 'ok',
        selector: 'body',
      }),
    ).toBeUndefined();
  });
});
