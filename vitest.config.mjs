import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

const CI = !!process.env.CI;
/** In CI prettier plugin tests are covered by a different run command */
const ciExclude = ['./packages/prettier-plugin-liquid'];

export default defineConfig({
  test: {
    exclude: CI
      ? [...configDefaults.exclude, '**/dist/**', ...ciExclude]
      : [...configDefaults.exclude, '**/dist/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
        isolate: true,
      },
    },
    setupFiles: [
      './packages/platformos-check-common/src/test/test-setup.ts',
      './packages/platformos-language-server-common/src/test/test-setup.ts'
    ],
  },
});
