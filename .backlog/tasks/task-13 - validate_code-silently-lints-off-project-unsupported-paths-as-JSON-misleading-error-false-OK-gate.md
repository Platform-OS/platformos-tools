---
id: TASK-13
title: >-
  validate_code silently lints off-project / unsupported paths as JSON
  (misleading error + false OK gate)
status: Done
assignee: []
created_date: '2026-07-30 20:02'
updated_date: '2026-07-30 21:18'
labels:
  - bug
  - mcp-supervisor
  - correctness
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/adapter-input.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.spec.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - vitest.config.mjs
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`validate_code` accepts ANY `file_path` and lints it. Two independent defects compose:

1. **No containment check.** `adapter-input.ts` `toAbsoluteFilePath` returns an absolute path as-is and otherwise `join`s onto the project root — so `/etc/passwd` and `../../../etc/passwd` both escape the root, and `""` resolves to the project root itself (a directory).
2. **Unconditional JSON fallback.** `toSourceCode`'s final `else` branch types ANY unrecognized extension as `SourceCodeType.JSON`, and `lintBuffer`'s `overlayBuffer` appends the buffer to the App whether or not it belongs there. So the file is JSON-linted.

Reproduced against the local build on `pos-module-mcp`:

| file_path | content | result |
|---|---|---|
| `/etc/passwd` | `outside project / unsupported` | `status: error`, `must_fix_before_write: true`, `ValidJSON: Expected a JSON object, array or literal.` |
| `../../../etc/passwd` | same | identical |
| `""` (empty) | same | identical |
| `notes.md` | `# hello` | identical |
| `/etc/shadow` | `{}` | **`status: ok`, `must_fix_before_write: false`** |

## Why it matters more than "a misleading error"

The original report notes no write risk — correct, the supervisor never writes. But the tool exists to GATE an agent's write, so both directions are wrong:

- **False block.** A legitimate in-project `README.md` / `.txt` / `.rb` edit returns `must_fix_before_write: true`, telling the agent not to write a file that is perfectly fine.
- **False approval (worse).** `/etc/shadow` with `{}` returns `status: ok`. An agent that trusts the gate reads that as "validated, safe to write" for a path far outside the project.

## Root-cause finding

`SourceCodeType.JSON` can only ever arise from that fallback in production:

- check-node's `getAppFilesPathPattern` globs `**/*.{liquid,graphql,yml,yaml}` — **no `.json`**, so the on-disk App never contains a JSON file.
- the LSP's `DocumentManager.set` early-returns on `!isSupportedSourceFile(uri)`, which is `false` for every `.json`.

So `ValidJSON` / `JSONSyntaxError` only ever fire on buffers the supervisor should not have linted at all. Every JSON offense the supervisor emits today is spurious by construction.

## Fix

Gate applicability in the supervisor (the layer that owns the agent contract) before either adapter runs:

1. **Containment** — resolve `file_path` and require it to be strictly inside `projectDir` (`path.relative` must be non-empty, must not start with `..`, must not be absolute).
2. **Supported type** — reuse check-common's existing `isSupportedSourceFile`. Verified to agree with check-node's App-membership filter on every case (`.liquid`→`isKnownLiquidFile`, `.graphql`→`isKnownGraphQLFile`, `.yml|.yaml`→`isKnownYAMLFile`, everything else including `.json` → false; asset partials `.css/.js/.scss.liquid` excluded by both).
3. **New terminal status** `not_applicable` with `must_fix_before_write: false`, empty diagnostics, and a `next_step` naming which rule declined — so the result neither blocks nor approves. Mirrors the existing, already-documented `ValidateCodeImpact` `not_applicable` precedent and its rationale ("`total: 0` would be a false 'safe to change'").
4. **Empty/whitespace `file_path`** — reject at the protocol boundary via the zod input schema, not in the handler. Malformed input belongs there.

Short-circuit before `Promise.all` so a declined path does no lint and no graph work.

## Scope / non-goals

- Do NOT change `toSourceCode`'s JSON fallback: check-browser and check-common's `test-helper` legitimately build JSON source codes from `.json` MockApp entries.
- Do NOT add the gate to `lintBuffer`. Its only non-spec consumer is the supervisor, and a seam named "lint this buffer" silently refusing files would surprise a future caller. **Latent trap worth recording:** a second `lintBuffer` consumer would hit this same fallback.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `/etc/passwd`, `../../../etc/passwd` → `not_applicable`, no `ValidJSON`, `must_fix_before_write: false`
- [x] #2 `/etc/shadow` + `{}` → `not_applicable`, NOT `ok`
- [x] #3 in-project `notes.md` / `app/config.txt` → `not_applicable`
- [x] #4 empty + whitespace `file_path` → protocol-level validation error
- [x] #5 every supported type still lints unchanged: page/partial/layout `.liquid`, `.graphql`, translation + schema `.yml`, `.json.liquid`
- [x] #6 a symlink or `a/../b` path that normalizes back INSIDE the root is still accepted
- [x] #7 no lint and no graph lookup performed for a declined path (assert via injected adapters)
- [x] #8 existing supervisor suite green; check-node / check-common / LSP untouched
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

`fileApplicability(projectDir, filePath)` in `adapter-input.ts` — the module that already owned request-path path resolution, so both adapters share one answer. Two rules, in order:

1. **Containment** — tested on `relative(projectDir, absolute)`, NOT by string prefix. A prefix test accepts a sibling root whose name merely extends the project's (`/srv/app-backup` vs `/srv/app`); a segment test does not. Rejects a leading `..` segment, an empty result (the path IS the root — what an empty `file_path` used to resolve to), and an absolute result (different Windows drive). Deliberately no symlink resolution: this is a correctness gate, not a security boundary — the server only reads, and the caller supplies the buffer contents anyway — so it stays off the request path's I/O budget.
2. **Supported type** — `isSupportedSourceFile` from check-common, reused rather than reinvented.

`runValidateCode` short-circuits on a refusal **before** `Promise.all`, so a declined path does no lint and no graph lookup. A blank `file_path` is refused by the zod input schema instead, at the protocol boundary where malformed input belongs.

## Verified against the real server

Rebuilt and driven over stdio against `pos-module-mcp`:

| file_path | content | before | after |
|---|---|---|---|
| `/etc/passwd` | text | `error` + `ValidJSON`, must_fix **true** | `not_applicable`, must_fix false |
| `../../../etc/passwd` | text | same | `not_applicable` |
| `/etc/shadow` | `{}` | **`ok`, must_fix false** | `not_applicable` |
| `notes.md` | `# hello` | `error` + `ValidJSON` | `not_applicable` |
| `app/config.txt` | text | `error` + `ValidJSON` | `not_applicable` |
| `app/pos-modules.json` | `{ bad json` | `error` + `ValidJSON` | `not_applicable` |
| `modules/mcp/.../index.liquid` | bad render | `MissingPartial` | `MissingPartial` (unchanged) |
| `""` / `"   "` | — | JSON-linted the root dir | MCP `-32602` validation error |

## Test discipline

43 new specs (33 pure applicability, 10 handler-level). Sabotaged both halves to prove they bite:

- gate disabled (`if (false && ...)`) → **5 of 5** gate specs fail; the 8 orchestration/zod/supported-path specs correctly still pass
- zod `refine` removed → **2 of 2** blank-path specs fail

Handler specs **count adapter invocations** rather than only asserting output: "no lint, no graph lookup" is half the fix, and a gate placed after `Promise.all` would still satisfy an output-only assertion.

Suites: supervisor 135 (was 92), full monorepo 2741/2741 across 297 files. Type-check and format clean.

## Verified claim behind the design

`isSupportedSourceFile` agrees with check-node's App-membership filter on every case, checked directly: `.liquid`→`isKnownLiquidFile`, `.graphql`, translation/model `.yml`, with asset partials and standalone `.json` excluded both places. This is why the gate can share the predicate instead of duplicating the rule — the refusal is exactly "lint would not have visited this file".

Also confirmed why the JSON fallback was reachable at all: check-node globs `**/*.{liquid,graphql,yml,yaml}` (no `.json`) and the LSP's `DocumentManager.set` early-returns on `!isSupportedSourceFile`, so in production `SourceCodeType.JSON` could ONLY arise from the fallback. Every JSON offense the supervisor ever emitted was spurious by construction.

## Incidental fix: vitest config regression (found here, corrected here)

The root `vitest.config.mjs` carried `poolOptions.forks.{maxForks,minForks,isolate}`. **`poolOptions` was removed in vitest 4** (the repo is on 4.1.10), so those were being ignored — the same silent-ignore this config had already been "fixed" for once before, when they were bare `test.forks`. The intent had therefore been expressed wrongly twice, and the `load-config.spec.ts` serialization requirement (it mutates the real `node_modules`) was unguarded again.

Corrected to the vitest-4 top-level form: `fileParallelism: false` + `isolate: true`. The deprecation banner is the tell — a comment now says so, so a third silent regression surfaces immediately. TASK-12.11 removes the need for the serialization entirely.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Off-project and unsupported-extension paths are no longer linted. `validate_code` now decides applicability before either adapter runs and returns a new terminal status `not_applicable` for files it declines to judge.

The reported symptom was a misleading `ValidJSON` error. The more serious half was the inverse: `/etc/shadow` containing `{}` is valid JSON, so the old code answered `status: 'ok'`, `must_fix_before_write: false` — the write gate green-lighting a path outside the project. `not_applicable` exists precisely so a declined call is neither an approval nor a block; `must_fix_before_write` is always `false` and `next_step` carries the reason.

Root cause was two defects composing: no containment check in `toAbsoluteFilePath`, and check-common's `toSourceCode` typing any unrecognized extension as JSON. Fixed at the supervisor — the layer that owns the agent contract — leaving `toSourceCode` alone (check-browser and check-common's test-helper legitimately build JSON sources from `.json` MockApp entries) and `lintBuffer` alone (its only non-spec consumer is the supervisor). The latent trap is recorded: a second `lintBuffer` consumer would hit the same fallback.

Verified end-to-end against the real server on `pos-module-mcp` for all eight cases, with both halves of the fix sabotage-tested. Supervisor suite 92 → 135; full monorepo 2741/2741.
<!-- SECTION:FINAL_SUMMARY:END -->
