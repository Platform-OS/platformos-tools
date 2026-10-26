import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['out/**', 'dist/**', '**/*.d.ts'] },
  js.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 6,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/naming-convention': 'warn',
      'no-throw-literal': 'warn',
      curly: 'warn',
      eqeqeq: 'warn',
      semi: 'warn',
    },
  },
];
