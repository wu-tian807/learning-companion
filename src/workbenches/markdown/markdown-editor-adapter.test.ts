import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({
  default: vi.fn(),
}));

import {
  configureMarkdownParserForDocument,
  isMarkdownEmbeddedImageSourceAllowed,
  isMarkdownNetworkRendererAllowed,
  isSafeMarkdownExternalLink,
  MARKDOWN_PREVIEW_RENDER_POLICY,
  MarkdownEditorInputGate,
} from './markdown-editor-adapter';

interface TestLuteParser {
  Md2VditorDOM(markdown: string): string;
  SetYamlFrontMatter(enabled: boolean): void;
}

function createTestLuteParser(): TestLuteParser {
  const nodeRequire = createRequire(import.meta.url);
  nodeRequire(
    '../../../node_modules/vditor/dist/js/lute/lute.min.js',
  );
  const runtime = (
    globalThis as typeof globalThis & {
      Lute?: { New(): TestLuteParser };
    }
  ).Lute;

  if (!runtime) {
    throw new Error('Vditor Lute test runtime is unavailable');
  }

  return runtime.New();
}

describe('Markdown YAML front matter tolerance', () => {
  it('falls back to ordinary Markdown for a malformed leading delimiter', () => {
    const controller = {
      SetYamlFrontMatter: vi.fn(),
    };
    const markdown = '---aaa---\n**123**';

    expect(
      configureMarkdownParserForDocument(controller, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'malformed-opener',
      },
    ]);
    expect(controller.SetYamlFrontMatter).toHaveBeenCalledWith(false);
  });

  it('keeps later formatting parseable in the real Lute runtime', () => {
    const markdown = '---aaa---\n**123**';
    const lute = createTestLuteParser();

    configureMarkdownParserForDocument(lute, markdown);
    const rendered = lute.Md2VditorDOM(markdown);

    expect(rendered).toContain('---aaa---');
    expect(rendered).toContain('<strong data-marker="**">123</strong>');
    expect(rendered).not.toContain('yaml-front-matter');
  });

  it('does not let an unclosed front matter block consume the document', () => {
    const markdown = '---\ntitle: unfinished\n**still parsed**';
    const lute = createTestLuteParser();

    expect(
      configureMarkdownParserForDocument(lute, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'unterminated',
      },
    ]);
    const rendered = lute.Md2VditorDOM(markdown);
    expect(rendered).toContain('title: unfinished');
    expect(rendered).toContain(
      '<strong data-marker="**">still parsed</strong>',
    );
  });

  it('keeps complete front matter enabled', () => {
    const markdown =
      '---  \r\ntitle: valid\r\n---\t\r\n**123**';
    const lute = createTestLuteParser();

    expect(
      configureMarkdownParserForDocument(lute, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'render',
      },
    ]);
    const rendered = lute.Md2VditorDOM(markdown);
    expect(rendered).toContain('yaml-front-matter');
    expect(rendered).toContain('<strong data-marker="**">123</strong>');
  });

  it('falls back literally when the active renderer lacks the feature', () => {
    expect(
      configureMarkdownParserForDocument(
        {},
        '---\ntitle: valid\n---\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'renderer-unavailable',
      },
    ]);
  });

  it('keeps unrelated documents outside optional feature parsing', () => {
    const controller = {
      SetYamlFrontMatter: vi.fn(),
    };

    expect(
      configureMarkdownParserForDocument(
        controller,
        '# title\n\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'inactive',
      },
    ]);
    expect(controller.SetYamlFrontMatter).toHaveBeenCalledWith(false);
  });

  it('does not mistake a longer thematic break for front matter', () => {
    expect(
      configureMarkdownParserForDocument(
        { SetYamlFrontMatter: vi.fn() },
        '----\n\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'inactive',
      },
    ]);
  });
});

describe('MarkdownEditorInputGate', () => {
  it('blocks delayed input until editor initialization finishes', () => {
    const gate = new MarkdownEditorInputGate();

    expect(gate.canForward()).toBe(false);
    gate.completeInitialization();
    expect(gate.canForward()).toBe(true);
  });

  it('keeps programmatic setValue input suppressed independently', () => {
    const gate = new MarkdownEditorInputGate();
    gate.completeInitialization();
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
