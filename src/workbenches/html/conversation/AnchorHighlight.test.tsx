import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createHtmlQuoteTarget } from '../shared';
import {
  AnchorHighlight,
  createAnchorClearCommand,
  createAnchorHighlightCommand,
} from './AnchorHighlight';

describe('AnchorHighlight', () => {
  const target = createHtmlQuoteTarget('锚点正文');

  it('renders no renderer-side overlay', () => {
    const markup = renderToStaticMarkup(
      <AnchorHighlight
        target={target}
        revision={1}
        reveal={true}
        durationMs={2_800}
        executeCommand={vi.fn()}
      />,
    );

    expect(markup).toBe('');
  });

  it('builds a reveal command with the full validated target', () => {
    expect(
      createAnchorHighlightCommand(target, 7, true, 2_800),
    ).toEqual({
      type: 'html.anchor.highlight',
      payload: {
        target,
        revision: 7,
        reveal: true,
        durationMs: 2_800,
      },
    });
  });

  it('builds a revision-scoped clear command', () => {
    expect(createAnchorClearCommand(target, 7)).toEqual({
      type: 'html.anchor.clear',
      payload: { target, revision: 7 },
    });
  });
});
