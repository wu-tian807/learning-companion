import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.pnpm-store/**',
      '.vite/**',
      'coverage/**',
      'demos/**/.cache/**',
      'demos/**/.downloads/**',
      'demos/**/.fixtures/**',
      'demos/**/.models/**',
      'demos/**/.patch-work/**',
      'demos/**/.runtime/**',
      'demos/**/results/**',
      'dist/**',
      'node_modules/**',
      'out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/renderer/**/*.{ts,tsx}',
      'src/workbenches/document-ai/renderer/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/workbenches/**/shared.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../../main/**',
                '../../renderer/**',
                '../../preload/**',
              ],
              message:
                'Workbench shared contracts must not depend on a process-specific layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/workbenches/**/main.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../renderer/**'],
              message:
                'Workbench Main providers must not import Renderer code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/workbenches/**/renderer.tsx',
      'src/workbenches/**/renderer-actions.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../main/**'],
              message:
                'Workbench Renderer modules must not import Main code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'forge.config.ts',
      'vite.*.config.ts',
      'vitest.config.ts',
      'demos/**/*.mjs',
      'scripts/**/*.mjs',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
