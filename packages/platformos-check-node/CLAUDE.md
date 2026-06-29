# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@platformos/platformos-check-node` is the Node.js runtime for the platformOS
linting engine. It wires the runtime-agnostic core
([`@platformos/platformos-check-common`](../platformos-check-common)) to the
filesystem (`NodeFileSystem`, glob-based project discovery), config resolution,
the docset (`@platformos/platformos-check-docs-updater`), the CLI, and autofix.
All check/detection logic lives in `-common`; this package is the I/O shell.

## Commands

```bash
yarn build        # tsc -b tsconfig.build.json, then postbuild: generate-factory-configs
yarn type-check   # tsc --noEmit
yarn test         # vitest

# Single spec
yarn test src/lint-buffer.spec.ts
```

## Entrypoints (`src/index.ts`)

| Function | Use |
|---|---|
| `check(root, configPath?)` | Lint a whole project on disk → `Offense[]`. |
| `appCheckRun(root, configPath?, log?)` | As `check`, plus the resolved `App` + `Config`. |
| `checkAndAutofix(root, configPath?)` | Lint then write safe autofixes to disk. |
| `lintBuffer({ root, filePath, content, configPath?, log? })` | Lint ONE in-memory buffer in the context of its on-disk project (cross-file checks resolve against real files; the buffer is overlaid in memory). Returns the buffer file's `Offense[]` with `fix`/`suggest` intact. The typed seam for embedders (e.g. the MCP supervisor) — a direct library call, **no LSP, no subprocess, no message-string round-trip**. See README. |
| `getApp(config)` / `getAppAndConfig(root, configPath?)` | Build the `App` (globbed `SourceCode[]`) and resolve config. |

`appCheckRun` and `lintBuffer` both delegate to the private `lintApp(root, app,
config, log)` helper, which builds the `getDocDefinition` map from the passed
`app` — this is what lets `lintBuffer`'s overlaid buffer be cross-referenced
with its UNSAVED `{% doc %}` params rather than the stale on-disk version.

## Factory configs (`configs/*.yml`)

`configs/all.yml`, `recommended.yml`, and `nothing.yml` are **generated** by
`scripts/generate-factory-configs` (run automatically as the build's
`postbuild:ts`) from check-common's `allChecks` / `recommended`. They are
committed. **After adding or removing a check in check-common, rebuild this
package (`yarn build`) and commit the regenerated configs** — `all.yml` and
`recommended.yml` enumerate every check; `nothing.yml` only carries
`extends`/`ignore` and does not change per-check.

## Cross-platform paths

Filesystem paths from `glob()` / `path.join()` must be normalized to forward
slashes (`normalize-path`) before regex/minimatch/glob/URI use. URIs use the
`path` helpers from check-common (vscode-uri based), never `normalize-path`
(which would collapse `file:///`). See the monorepo root `CLAUDE.md`.

## Tests

Vitest. `src/test/test-helpers.ts` provides `makeTempWorkspace(tree)` (writes a
real temp project, returns `{ rootUri, uri(), clean() }`) and config/mock-module
helpers. Hermetic check tests use a `.platformos-check.yml` with
`extends: platformos-check:nothing` plus the specific check enabled, avoiding
docset/network dependencies.
