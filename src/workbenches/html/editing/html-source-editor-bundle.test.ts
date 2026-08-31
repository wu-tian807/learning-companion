import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';
import { describe, expect, it } from 'vitest';

describe('HTML source editor Main bundle', () => {
  it('loads after bundling without package-relative sidecar assets', async () => {
    const outDir = await mkdtemp(
      join(tmpdir(), 'html-source-editor-bundle-'),
    );
    try {
      await build({
        configFile: false,
        logLevel: 'silent',
        ssr: { noExternal: true },
        build: {
          emptyOutDir: true,
          outDir,
          ssr: resolve(
            'src/workbenches/html/editing/html-source-editor.ts',
          ),
          rollupOptions: {
            external: [/^node:/u],
            output: { entryFileNames: 'editor.mjs' },
          },
        },
      });

      const editor = (await import(
        pathToFileURL(join(outDir, 'editor.mjs')).href
      )) as typeof import('./html-source-editor');
      const edit = editor.beginHtmlSourceEdit({
        source: '<html><body><main id="target">Before</main></body></html>',
        locator: { kind: 'selector', selector: '#target' },
        scope: 'contents',
      });

      expect(edit.currentHtml).toBe('Before');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
