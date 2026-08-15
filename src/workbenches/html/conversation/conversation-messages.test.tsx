import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createHtmlQuoteTarget } from '../shared';
import { MessageBubble } from './conversation-messages';

const message = {
  id: 'message-1',
  role: 'user' as const,
  text: '这里是什么意思？',
  anchor: createHtmlQuoteTarget('锚点正文'),
};

describe('conversation message anchors', () => {
  it('renders a historical anchor as an accessible source-location button', () => {
    const markup = renderToStaticMarkup(
      <MessageBubble
        message={message}
        onAnchorActivate={vi.fn()}
      />,
    );

    expect(markup).toContain('<button');
    expect(markup).toContain('在原文中定位');
    expect(markup).toContain('锚点正文');
  });

  it('keeps the anchor non-interactive when no activation capability is supplied', () => {
    const markup = renderToStaticMarkup(
      <MessageBubble message={message} />,
    );

    expect(markup).not.toContain('在原文中定位');
    expect(markup).toContain('锚点正文');
  });
});
