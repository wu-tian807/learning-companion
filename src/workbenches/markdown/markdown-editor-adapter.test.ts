import { describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({
  default: vi.fn(),
}));

import {
  isMarkdownEmbeddedImageSourceAllowed,
  isMarkdownNetworkRendererAllowed,
  isSafeMarkdownExternalLink,
  MARKDOWN_PREVIEW_RENDER_POLICY,
  MarkdownEditorInputGate,
} from './markdown-editor-adapter';

describe('MarkdownEditorInputGate', () => {
  it('blocks delayed initialization input until round-trip review finishes', () => {
    const gate = new MarkdownEditorInputGate();

    expect(gate.canForward()).toBe(false);
    gate.completeRoundTrip();
    expect(gate.canForward()).toBe(true);
  });

  it('keeps programmatic setValue input suppressed independently', () => {
    const gate = new MarkdownEditorInputGate();
    gate.completeRoundTrip();
    const release = gate.suppress();

    expect(gate.canForward()).toBe(false);
    release();
    expect(gate.canForward()).toBe(true);
    expect(gate.canForward(true)).toBe(false);
  });

  it('allows only credential-free HTTP(S) external links', () => {
    expect(
      isSafeMarkdownExternalLink('https://example.com/guide'),
    ).toBe(true);
    expect(
      isSafeMarkdownExternalLink('https://user:secret@example.com'),
    ).toBe(false);
    expect(isSafeMarkdownExternalLink('javascript:alert(1)')).toBe(
      false,
    );
    expect(isSafeMarkdownExternalLink('../private.md')).toBe(false);
  });

  it('only embeds renderer-owned or inline image sources', () => {
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'learning-content://session/image.png',
      ),
    ).toBe(true);
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'data:image/png;base64,c2FmZQ==',
      ),
    ).toBe(true);
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'https://example.com/image.png',
      ),
    ).toBe(false);
    expect(
      isMarkdownEmbeddedImageSourceAllowed('../image.png'),
    ).toBe(false);
  });

  it('disables remote media embedding and PlantUML network rendering', () => {
    expect(MARKDOWN_PREVIEW_RENDER_POLICY).toEqual({
      media: { enable: false },
    });
    expect(isMarkdownNetworkRendererAllowed('plantuml')).toBe(false);
    expect(isMarkdownNetworkRendererAllowed('mermaid')).toBe(true);
  });
});
