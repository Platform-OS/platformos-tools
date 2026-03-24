import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CI = !!process.env.CI;
/** In CI prettier plugin tests are covered by a different run command */
const ciExclude = ['./packages/prettier-plugin-liquid'];

export default defineConfig({
  test: {
    exclude: CI
      ? [...configDefaults.exclude, '**/dist/**', ...ciExclude]
      : [...configDefaults.exclude, '**/dist/**'],
    forks: {
      maxForks: 1,
      minForks: 1,
      isolate: true,
    },
    setupFiles: [
      resolve(__dirname, 'packages/platformos-check-common/src/test/test-setup.ts'),
      resolve(__dirname, 'packages/platformos-language-server-common/src/test/test-setup.ts'),
    ],
  },
});
