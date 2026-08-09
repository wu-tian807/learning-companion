import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', '@napi-rs/canvas'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
