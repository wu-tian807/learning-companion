import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  server: {
    watch: {
      ignored: ['**/out/**'],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/vditor/dist/**/*',
          dest: 'vendor/vditor',
          rename: { stripBase: 2 },
        },
        {
          src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          dest: 'vendor/pdfjs',
          rename: { stripBase: true },
        },
        ...['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((directory) => ({
          src: `node_modules/pdfjs-dist/${directory}/**/*`,
          dest: 'vendor/pdfjs',
          rename: { stripBase: 2 },
        })),
        {
          src: 'node_modules/pdfjs-dist/web/images/**/*',
          dest: 'vendor/pdfjs',
          rename: { stripBase: 3 },
        },
      ],
    }),
  ],
  optimizeDeps: {
    include: ['@uiw/react-codemirror'],
  },
});
