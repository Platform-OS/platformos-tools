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
    // Spec files must NOT run in parallel: `config/load-config.spec.ts` installs
    // mock packages into this package's REAL `node_modules` to exercise sibling
    // extension discovery, so a concurrently running spec sees them appear and
    // vanish mid-run ("Error loading …platformos-check-global-extension").
    //
    // These options are TOP-LEVEL under vitest 4 — `poolOptions.forks.{maxForks,
    // minForks}` was removed, and bare `test.forks` before that was silently
    // ignored, so this intent has now been expressed wrongly twice. If the
    // deprecation banner returns, the serialization is off again.
    // `fileParallelism: false` is the direct statement of the requirement (it
    // pins workers to 1 by itself); TASK-12.11 removes the need for it by making
    // extension discovery hermetic, which restores the ~20% CI parallelism win.
    pool: 'forks',
    fileParallelism: false,
    isolate: true,
    setupFiles: [
      resolve(__dirname, 'packages/platformos-check-common/src/test/test-setup.ts'),
      resolve(__dirname, 'packages/platformos-language-server-common/src/test/test-setup.ts'),
    ],
  },
});
