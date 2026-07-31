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
    // Spec files must run one at a time. That is not a preference here:
    // `config/load-config.spec.ts` installs mock packages into this package's REAL
    // `node_modules` to exercise sibling extension discovery, so a concurrently
    // running spec would see them appear and vanish mid-run ("Error loading
    // …platformos-check-global-extension").
    //
    // `fileParallelism` is what enforces that; `pool`/`isolate` are spelled out
    // because they carry the same intent and are only Vitest 4 defaults. They must
    // stay top-level `test` options — the `poolOptions.forks` / bare `test.forks`
    // spellings this replaced are accepted silently and do nothing.
    pool: 'forks',
    fileParallelism: false,
    isolate: true,
    setupFiles: [
      resolve(__dirname, 'packages/platformos-check-common/src/test/test-setup.ts'),
      resolve(__dirname, 'packages/platformos-language-server-common/src/test/test-setup.ts'),
    ],
  },
});
