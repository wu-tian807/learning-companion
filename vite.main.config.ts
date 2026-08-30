import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        'jsdom',
        /^@napi-rs\/canvas(?:-|\/|$)/u,
        /^pdfjs-dist(?:\/|$)/u,
      ],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
