/**
 * Per-package vitest config.
 *
 * Mirrors the monorepo root's single-fork-isolate convention (see
 * `../../vitest.config.mjs`): one worker, one fork, file-level isolation.
 * That convention exists because every spec in this workspace touches one
 * or more pieces of process-wide state — the rule registry, the project
 * map cache, the in-process LSP, environment variables — and parallel
 * workers race on those.
 *
 * Pattern: `*.spec.ts` is the only test suffix (matches sibling packages
 * like `platformos-language-server-common`). Specs live colocated with
 * source under `src/`; fixtures and helpers under `test/`.
 *
 * The root `yarn test` command runs vitest from the repo root and
 * discovers specs across every workspace automatically. This config is
 * picked up by `yarn workspace @platformos/platformos-mcp-supervisor test`
 * so individual-package runs use the same execution model.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/dist/**', '**/node_modules/**', 'test/fixtures/**'],
    // Vitest 4 hoisted `poolOptions.forks.*` to top-level `forks.*`. The
    // root monorepo config follows the same shape.
    forks: {
      maxForks: 1,
      minForks: 1,
      isolate: true,
    },
  },
});
