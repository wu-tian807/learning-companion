import { describe, expect, it } from 'vitest';

import { createHtmlQuoteTarget } from './shared';
import {
  createHtmlAnchorClearFrameScript,
  createHtmlAnchorHighlightFrameScript,
} from './html-anchor-frame-script';

describe('HTML anchor frame scripts', () => {
  it('embeds only the validated command data in a self-contained resolver', () => {
    const script = createHtmlAnchorHighlightFrameScript({
      target: createHtmlQuoteTarget('包含 ` 与 ${danger} 的文本'),
      revision: 7,
      reveal: true,
      durationMs: 2_800,
    });

    expect(script).toContain('runHtmlAnchorFrameCommand');
    expect(script).toContain('html.quote');
    expect(script).toContain('"revision":7');
    expect(script).toContain('"reveal":true');
  });

  it('creates a revision-scoped clear command', () => {
    const script = createHtmlAnchorClearFrameScript({
      target: createHtmlQuoteTarget('锚点正文'),
      revision: 9,
    });

    expect(script).toContain('"action":"clear"');
    expect(script).toContain('"revision":9');
  });
});
