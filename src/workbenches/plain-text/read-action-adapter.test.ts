// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { findTextSelectionInput } from '../../shared/workbench/selection';
import { PlainTextReadActionAdapter } from './read-action-adapter';
import { PLAIN_TEXT_RANGE_ANCHOR_TYPE } from './shared';

describe('PlainTextReadActionAdapter', () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it('maps a repeated selection to the exact DOM range occurrence', () => {
    const source = 'repeat repeat';
    const scrollContainer = document.createElement('div');
    const contentElement = document.createElement('div');
    const textNode = document.createTextNode(source);
    contentElement.append(textNode);
    scrollContainer.append(contentElement);
    document.body.append(scrollContainer);

    const adapter = new PlainTextReadActionAdapter({
      getScrollContainer: () => scrollContainer,
      getContentElement: () => contentElement,
      getSource: () => source,
    });
    const range = document.createRange();
    range.setStart(textNode, 7);
    range.setEnd(textNode, 13);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const captured = findTextSelectionInput(
      adapter.captureInteraction(),
    );

    expect(captured).toEqual({
      text: 'repeat',
      target: {
        scope: 'content',
        targetType: PLAIN_TEXT_RANGE_ANCHOR_TYPE,
        targetVersion: 1,
        targetPayload: {
          ranges: [
            {
              start: 7,
              end: 13,
              exact: 'repeat',
              prefix: 'repeat ',
              suffix: '',
            },
          ],
        },
      },
    });
  });

  it('maps a selection across multiple DOM text nodes', () => {
    const source = 'first second';
    const scrollContainer = document.createElement('div');
    const contentElement = document.createElement('div');
    const first = document.createTextNode('first ');
    const wrapper = document.createElement('span');
    const second = document.createTextNode('second');
    wrapper.append(second);
    contentElement.append(first, wrapper);
    scrollContainer.append(contentElement);
    document.body.append(scrollContainer);
    const adapter = new PlainTextReadActionAdapter({
      getScrollContainer: () => scrollContainer,
      getContentElement: () => contentElement,
      getSource: () => source,
    });
    const range = document.createRange();
    range.setStart(first, 3);
    range.setEnd(second, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const captured = findTextSelectionInput(
      adapter.captureInteraction(),
    );

    expect(captured?.text).toBe('st sec');
    expect(captured?.target.targetPayload).toEqual({
      ranges: [
        {
          start: 3,
          end: 9,
          exact: 'st sec',
          prefix: 'fir',
          suffix: 'ond',
        },
      ],
    });
  });

  it('rejects selections outside the content element or stale DOM text', () => {
    const scrollContainer = document.createElement('div');
    const contentElement = document.createElement('div');
    const contentText = document.createTextNode('visible text');
    const outside = document.createTextNode('outside');
    contentElement.append(contentText);
    scrollContainer.append(contentElement, outside);
    document.body.append(scrollContainer);
    let source = 'visible text';
    const adapter = new PlainTextReadActionAdapter({
      getScrollContainer: () => scrollContainer,
      getContentElement: () => contentElement,
      getSource: () => source,
    });
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(outside);
    selection.addRange(range);

    expect(findTextSelectionInput(adapter.captureInteraction()))
      .toBeUndefined();

    selection.removeAllRanges();
    range.selectNodeContents(contentElement);
    selection.addRange(range);
    source = 'stale text';

    expect(findTextSelectionInput(adapter.captureInteraction()))
      .toBeUndefined();
  });

  it('selects only the rendered source content', () => {
    const scrollContainer = document.createElement('div');
    const contentElement = document.createElement('div');
    contentElement.textContent = 'source';
    scrollContainer.append('before', contentElement, 'after');
    document.body.append(scrollContainer);
    const adapter = new PlainTextReadActionAdapter({
      getScrollContainer: () => scrollContainer,
      getContentElement: () => contentElement,
      getSource: () => 'source',
    });

    adapter.selectAll();

    expect(window.getSelection()?.toString()).toBe('source');
  });
});
