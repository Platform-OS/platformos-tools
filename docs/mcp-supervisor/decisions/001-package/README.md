# Adding `@platformos/platformos-mcp-supervisor` to platformos-tools

## Status

Accepted (v1 ships `validate_code` only — see *Consequences* for deferred
work).

## tl;dr

We forked `pos-supervisor` — an MCP server that lets LLM agents validate
platformOS code before writing it — into a new monorepo workspace package
named `@platformos/platformos-mcp-supervisor`. The v1 release exposes a
single MCP tool (`validate_code`) over stdio. The in-process LSP
(`@platformos/platformos-language-server-node`) replaces the subprocess
`pos-cli lsp` dependency. Roughly half of the source codebase
(analytics, adaptive engine, dashboard, HTTP transport, sessions, the
nine other MCP tools, pos-cli fallback) is deferred or dropped.

## Context

`pos-supervisor` (https://github.com/Platform-OS/pos-supervisor) is a
production MCP server. Its `validate_code` tool composes a parse →
LSP → enrich → pipeline → validators → structural-warnings → fix-gen
pipeline that catches platformOS-specific code issues an LLM cannot
infer from a generic Liquid linter. The supervisor was first built as a
stand-alone Bun/Node project that shelled out to `pos-cli lsp` for
language-server diagnostics, layered HTTP/dashboard/analytics on top, and
shipped a portfolio of ten MCP tools.

Three pressures motivated the migration:

1. **Distribution.** Most platformos-tools consumers already depend on
   `@platformos/platformos-language-server-node`. Shipping the supervisor
   alongside it removes the `pos-cli` system dependency, removes the Bun
   runtime requirement, and lets npm/yarn handle version coupling.
2. **API stability.** The in-monorepo language-server-common package
   evolves frequently; pos-supervisor pinned an older `pos-cli` and
   silently lagged. Living in the same workspace ties the supervisor to
   the language-server's actual API rather than the `pos-cli` CLI's
   wrapper, with `tsc --noEmit` catching drift at build time.
3. **Surface area.** Eight of the ten MCP tools, the analytics / CAC
   predictor / case-base / promoted-rules / dashboard subsystems, and
   the session-event-bus are out of scope for what an embedded
   line-level validator needs to deliver. Re-shipping them would
   multiply the maintenance surface and contradict the package's
   single responsibility.

### Alternatives considered

- **Continue shipping pos-supervisor as an external repo.** Lowest
  short-term cost, but leaves the `pos-cli` system dependency, the Bun
  runtime requirement, and the API drift problem in place. Rejected.
- **Add an `mcp` mode to an existing language-server package.** Keeps
  the dependency surface flat but conflates "language server speaking
  LSP" with "MCP server speaking validate_code". Rejected on cohesion
  grounds.
- **Port everything (all ten tools) in v1.** Largest surface; would
  re-import analytics/CAC/dashboard infra into a TS monorepo that
  doesn't have a place for them yet. Rejected; deferred per
  *Consequences*.

## Decision

A new workspace package, `packages/platformos-mcp-supervisor`, with:

- **In-process LSP** via `@platformos/platformos-language-server-node`
  (PassThrough + `createProtocolConnection`). No subprocess, no PATH
  dependency on `pos-cli`.
- **Full TypeScript rewrite** of every JS file. The only verbatim copy
  is `src/data/` (hints, knowledge base, references) — the JSON / YAML
  content is data, not code.
- **One MCP tool — `validate_code` — over stdio.** No HTTP transport.
- **Single-fork-isolate vitest config** matching the monorepo root.
- **Strict TS settings.** No `any` on the public surface; the result
  type is exported and consumers can drive the server programmatically
  via `startServer`.

The migration was sequenced across 25 backlog tasks (`m-0`) — see the
[migration milestone](../../../../../.backlog/milestones/m-0%20-%20pos-supervisor-%E2%86%92-platformos-tools-migration-%28v1-va.md).
Each task ships a slice with type-check + spec coverage; the final
acceptance gate (P24) is a parity suite that deep-equal's normalised v1
output against captured pos-supervisor baselines on a 13-entry corpus.

## Consequences

### Positive

1. **No `pos-cli` dependency.** Consumers install one npm package and
   are done; CI doesn't need an external binary on PATH.
2. **API drift caught at build time.** `@platformos/platformos-language-server-node`
   is consumed as a typed workspace dep; `tsc --noEmit` over `src/`
   surfaces upstream API changes the moment they land.
3. **Tighter test surface.** 276 specs (unit + integration + LSP
   contract + parity) run pos-cli-free on any node the monorepo already
   targets. CI matrix simplifies from "Linux/Mac/Win + pos-cli +
   npm-global" to "node only."
4. **Single-tool focus.** Every public surface in v1 reduces to
   `validate_code`. Operator and agent docs collapse to one tool
   description.
5. **Strictly-typed result.** `ValidateCodeResult` is exported; agents
   embedding the server programmatically don't need a JSON-schema
   shim.

### Negative

1. **Deferred functionality.** Nine MCP tools from the source — most
   notably `validate_intent`, `scaffold`, `project_map`, and
   `analyze_project` — are not available in v1. Agents that depended on
   the pre-validation workflow (`validate_intent` → scaffold → `validate_code`)
   need a different flow until those tools land.
2. **No analytics layer.** Source's analytics-store, CAC predictor,
   case-base scoring, promoted rules, and dashboard are dropped. The
   adaptive-rule layer that down-weighted noisy rules from telemetry is
   gone; v1 ships the static rule set. Pinned by tests, not by
   analytics-driven calibration.
3. **No `pending_files` / `pending_pages` / `pending_translations`
   suppression.** Source merged in-flight plan state from
   `validate_intent` to silence `MissingPartial` / `MissingPage` /
   `TranslationKeyExists` for not-yet-written files. v1 treats every
   diagnostic at face value — agents creating multiple files at once
   will see transient errors until the partner files land on disk.
4. **No session-event bus / NDJSON log / blob store.** Operator
   debugging via session inspection is unavailable in v1; the only log
   surface is stderr.
5. **Workspace coupling to `@platformos/platformos-language-server-node`.**
   The supervisor pins the in-monorepo LSP API. Breaking changes to
   that API surface are now changes the supervisor must handle in the
   same PR.

### Drawbacks → mitigation strategies

> Deferred MCP tools.

We will ship the remaining tools as additive PRs to the same package
when (a) the agent flows that depend on them are well-understood and
(b) the supporting subsystems they need (project_map graph caches,
scaffold templates, intent-validator path/role checks) are themselves
ported. None of those tools have a hard dependency on the dropped
analytics / dashboard / session-event-bus surfaces.

> No analytics layer.

The rule engine is wired the same way as source's. When/if a v1
analytics layer is added back, the rule-engine's `forceDisable` /
`releaseDisable` / `isCheckForceDisabled` surface gives operators the
same manual override that source's force-enable/force-disable mechanism
exposed.

> No pending-state suppression.

Pre-write multi-file flows still work; agents see transient errors that
clear when companion files land. The integration spec exercises the
"create the missing file then re-validate" loop. If the friction
becomes load-bearing, pending-state suppression can be re-added as an
opt-in input parameter without touching the rest of the pipeline.

> Workspace coupling.

`@platformos/platformos-language-server-node` is the *intended* API
contract here, not an accidental coupling. The contract is pinned by
`test/upstream/lsp-diagnostic-contract.spec.ts` (P23) — 23 tests that
fail loudly the moment any pinned `(check, message_template)` pair
drifts.
