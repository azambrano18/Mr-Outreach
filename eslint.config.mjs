// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/web/**',
      'prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Root-level Jest configs are plain Node CommonJS, not part of any
  // tsconfig project — they need Node's globals (module, require, ...)
  // rather than the browser/DOM-less default the rest of this config uses.
  {
    files: ['jest.config.*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
);
