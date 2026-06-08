# pos-cli dependency audit (TASK-20)

Frozen snapshot of how the pos-supervisor source suite (146 `*.test.js` files)
depends on `pos-cli` being installed, and how that breaks down into the v1
test migration plan (P21 unit, P22 integration, P23 upstream).

In v1 the LSP runs in-process via `@platformos/platformos-language-server-node`
(see `src/core/lsp-client.ts`). The new package's tests MUST run without
`pos-cli` on PATH. Anything that historically required `pos-cli` either gets
re-pointed at the in-process LSP, falls out of scope with its tool, or stays
auto-skipped via the existing guard.

## Category A — auto-skip via `describePosCli` (15 tests)

These already gate themselves with `tests/integration/pos-cli/guard.js`. In
v1 they migrate to the in-process LSP (no guard needed) or get dropped if
they covered a dropped tool.

| Source file | v1 disposition |
|---|---|
| `tests/integration/pos-cli/added-param-callers.test.js` | **Port (P22)** — validate_code AddedParam path. |
| `tests/integration/pos-cli/adversarial-shopify.test.js` | **Port (P22)** — Shopify-contamination elevation. |
| `tests/integration/pos-cli/adversarial-structural.test.js` | **Port (P22)** — structural warning surface. |
| `tests/integration/pos-cli/auto-enrich.test.js` | **Port (P22)** — LSP completions fallback. |
| `tests/integration/pos-cli/diff-aware.test.js` | **Port (P22)** — RemovedRender/Param paths. |
| `tests/integration/pos-cli/enrichment.test.js` | **Port (P22)** — enrichAll + rule bridge. |
| `tests/integration/pos-cli/position-accuracy.test.js` | **Port (P22)** — 1-based line conversion. |
| `tests/integration/pos-cli/regression.test.js` | **Port (P22)** — pinned regression fixtures. |
| `tests/integration/pos-cli/shopify-elevation.test.js` | **Port (P22)** — pipeline shopify-elevate step. |
| `tests/integration/pos-cli/translation-array-index.test.js` | **Port (P22)** — TranslationKeyExists rule. |
| `tests/integration/pos-cli/validate-code.test.js` | **Port (P22)** — happy-path suite. |
| `tests/integration/pos-cli/warning-inversion.test.js` | **Port (P22)** — severity-inversion suppressions. |
| `tests/upstream/assign-syntax-coverage.test.js` | **Port (P23)** — re-pin against in-process LSP. |
| `tests/upstream/lsp-coverage-map.test.js` | **Port (P23)** — re-pin. |
| `tests/upstream/lsp-diagnostic-contract.test.js` | **Port (P23)** — re-pin (regex contracts in `error-enricher.ts`). |

After porting: the `describePosCli` guard goes away entirely (no manual
skip needed — the in-process LSP is always available).

## Category B — auto-skip via runtime path detection (1 test)

| Source file | v1 disposition |
|---|---|
| `tests/upstream/data-contract.test.js` | **Drop / replace.** Source resolves pos-cli's bundled data dir via `which pos-cli`. In v1 the data shape is pinned by `@platformos/platformos-check-docs-updater` (the workspace dep we consume). If we still want a contract test, point it at `PlatformOSLiquidDocsManager` directly — but the upstream check-common package already does this, so dropping is cleaner. |

## Category C — `tests/integration/*.integration.test.js` (12 tests, NO guard)

These use the HTTP `startServer` helper which spawned the supervisor as a
subprocess. Since the supervisor spawned pos-cli internally for the LSP,
they *implicitly* required pos-cli. v1's helper is stdio-only and the LSP
is in-process — but the tools these suites target are mostly dropped.

| Source file | Target tool / subsystem | v1 disposition |
|---|---|---|
| `analyze-project-integrity.integration.test.js` | `analyze_project` | **Drop** — tool out of scope. |
| `analyze-project-lib-prefix.integration.test.js` | `analyze_project` | **Drop**. |
| `event-replay.test.js` | session event bus | **Drop**. |
| `module-info.integration.test.js` | `module_info` | **Drop**. |
| `performance.test.js` | bench | **Defer** — re-add when v1 has perf baseline. |
| `project-map.integration.test.js` | `project_map` tool | **Drop tool, keep coverage** — `project-scanner.ts` is exercised by the v1 validate-code fixtures (P22). |
| `scaffold-adaptive.integration.test.js` | `scaffold` adaptive layer | **Drop**. |
| `scaffold.integration.test.js` | `scaffold` | **Drop**. |
| `session-supervision.integration.test.js` | session loop detection | **Drop**. |
| `validate-code-features.integration.test.js` | `validate_code` | **Port (P22)**. |
| `validate-intent-enrichment.integration.test.js` | `validate_intent` | **Drop**. |
| `validate-intent.integration.test.js` | `validate_intent` | **Drop**. |

## Category D — upstream tests without `describePosCli` (4 tests)

| Source file | v1 disposition |
|---|---|
| `tests/upstream/diagnostic-fingerprint.test.js` | **Drop** — fingerprint/templateFingerprint module dropped with analytics (P18). |
| `tests/upstream/parser-contract.test.js` | **Drop** — `@platformos/liquid-html-parser` is now an upstream workspace dep with its own contract suite. |
| `tests/upstream/workflow-consistency.test.js` | **Drop** — scaffold + validate_intent both dropped; canonical workflow block has no consumers. |
| `tests/upstream/data-contract.test.js` | See Category B. |

## Category E — unit tests (89 in source)

**Zero unit tests require `pos-cli` to be installed.** Of the 12 unit
files that grep matched for `pos-cli`, the references are all benign:

- `agent-routing.test.js`, `session-pending.test.js`, `validate-code-gate.test.js`
  — mock context with `posCliFound: false` (testing the supervisor's
  *absent-pos-cli* behaviour).
- `analyze-project.test.js`, `diagnostic-pipeline.test.js`, `liquid-parser.test.js`,
  `lsp-stale-diagnostics.test.js`, `module-scanner-manifest.test.js`,
  `session-state.test.js`, `tool-json-schema.test.js`,
  `diagnostic-pipeline-frontmatter-dedup.test.js` — fixture text mentions
  the string `pos-cli` (it's a platformOS tool name); no spawn / require.
- `pos-cli-resolver.test.js` — tests the resolver module that is **dropped
  in v1** (in-process LSP needs no PATH resolution). Drop the test with
  the module.

Migration in P21 covers in-scope-only unit tests: validators
(`schema-validator.spec.ts` already ported), pipeline + structural,
liquid-parser, project-scanner, render-flow, fact-graph, rules engine,
fix-generator, error-enricher. Out-of-scope unit tests (analytics,
session, scaffold, validate-intent, fingerprint, case-base, CAC,
engine-mode, rule-overrides, promoted-rules, blob-store, event-bus)
disappear with their modules.

## Net v1 picture

- **`pos-cli` is NOT required** to run any v1 supervisor spec.
- The 15 Category-A tests that historically gated themselves with
  `describePosCli` either port unconditionally onto the in-process LSP
  (P22 / P23) or drop with their tool (none in Category A drop — all
  port).
- The Category-C suite collapses from 12 → 1 in-scope file
  (`validate-code-features.integration.test.js`).
- Categories B + D drop entirely (analytics / scaffold / validate_intent /
  module_info / project_map tool / pos-cli resolver are all gone).
- All Category-E unit tests run pos-cli-free; we port only the subset
  whose target module survives the v1 cut.

The supervisor's CI requirement reduces from "Linux + Windows + macOS
each with pos-cli on PATH + a working npm global install" to "any node
that the monorepo already targets" — a strict simplification.
