# Rebuilding `platformos-mcp-supervisor` on a thin, structured seam

## Status

Accepted (2026-06). Supersedes the internal architecture of the v1 package
described in
[`001-package/README.md`](../001-package/README.md); the package scope
(single `validate_code` tool, stdio only, no analytics) is unchanged — only the
*internal* seam to the linting engine is being rebuilt.

## tl;dr

We are rebuilding `@platformos/platformos-mcp-supervisor` from scratch rather
than refactoring it. The v1 package was joined to the linting engine by the
**wrong seam**: it booted a full language server in-process, received flat LSP
message *strings* (dropping the structured `fix`/`suggest`), regex-parsed those
English messages back into params (16 byte-for-byte-pinned extractors),
regenerated fixes from scratch (~1.7k LOC), re-derived the project graph and
docset, and corrected its own false positives in a 15-step "load-bearing
ordered" pipeline. The rebuild keeps the two packages separate but moves the
seam to a **typed, structured contract**: lint via a direct
`platformos-check-node` `check()` call, consume `Offense[]` with `fix`/`suggest`
and a typed `data` payload intact, and run pure enrichment/result stages over
structured data. The architectural non-goals are encoded as machine-enforced
guard tests so the sound design cannot silently rot.

## Context

`pos-supervisor`'s `validate_code` is the platformOS-aware code validator an
LLM agent calls before writing a file. v1 (see
[`CURRENT_SYSTEM_ARCHITECTURE.md`](../../../packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md))
already shipped the right *scope* — a single tool, stdio, static (no
analytics). The problem is the *internal seam*.

The architectural analysis (`platformos-tools/ANALYSIS.md`) identified the core
mistake as a **lossy structured → string → structured round-trip**:

```
check-common Offense        LSP Diagnostic            supervisor re-derivation
{ check, message,     ──▶   { code, message,    ──▶   extractParams() regex on the
  start, end,               range }                    message STRING → params{},
  fix:Corrector,            (fix/suggest dropped)      templateOf() masking,
  suggest:[...] }                                      fix-generator rebuilds fixes
```

`check-common` already knows *structurally* which filter was unknown, what the
nearest suggestion is, and how to fix it. The LSP boundary flattened that to a
string and dropped the structured `fix`/`suggest`; the supervisor then
regex-parsed the English message back into params and regenerated fixes. This
is duplicated intelligence connected by a brittle string contract — pinned only
by a 23-case contract test whose own comment admits "drift here silently breaks
every rule that reads `diag.params.X`".

### Alternatives considered

- **Refactor v1 in place.** Rejected. The string seam is load-bearing across
  ~16.3k LOC (the LSP client, `diagnostic-record.ts`'s 16 extractors,
  `fix-generator.ts`, the 15-step false-positive-correction pipeline, the
  duplicate graph and docset wrappers). Incrementally unpicking it risks
  carrying the coupling forward in subtler form. A clean rebuild on the typed
  seam is cheaper and verifiable.
- **Merge the supervisor into check-common.** Rejected. The runtime boundary is
  real: check-common is deliberately runtime-agnostic (it powers the browser
  build); the supervisor is hard Node (MCP SDK, stdio, fs). Their stability
  contracts also diverge — `Offense` must stay minimal and stable for editors,
  while `ValidateCodeResult` is an LLM-ergonomics surface that churns fast.
- **Keep going through the LSP, but capture structured data alongside the
  message.** Rejected. The LSP protocol is built for interactive editing
  (open/change/publishDiagnostics push). For a request/response "lint this
  buffer" need, calling `check()` directly is simpler, synchronous, fully
  typed, and preserves the structured `fix`/`suggest` without an embedded
  server, PassThrough streams, and settle-timeout machinery.

## Decision

1. **Keep the two packages separate.** Different runtimes (browser-safe core vs
   Node server), divergent stability contracts (`Offense` stable vs
   `ValidateCodeResult` churns), a real detection-vs-advice separation,
   dependency weight, and distinct test surfaces all still hold.

2. **Move the seam to a typed structured contract.** The supervisor consumes
   `platformos-check-common`'s `Offense[]` directly — via a `platformos-check-node`
   `check()` entrypoint — with structured `fix`/`suggest` and a typed `data`
   payload intact. No LSP/JSON-RPC string protocol on the lint path.

3. **No in-process language server for linting.** `check()` is a direct library
   call. A language server remains acceptable only for hover/completion, if a
   future task needs it — never on the lint path.

4. **check-common is the single source of truth for correctness.** Correctness
   detectors and structured fixes live there as `CheckDefinition`s; the
   supervisor keeps only agent ergonomics (hints, confidence, clustering,
   scorecard, `next_step`, advisories).

5. **One graph, one docset.** Reuse `platformos-graph` and
   `AugmentedPlatformOSDocset`; do not re-implement a project scanner, fact
   graph, dependency graph, or docset/index wrappers.

6. **Pure enrichment + result assembly.** All I/O happens at the `lint/` edge;
   `enrich/` and `result/` are pure functions of structured data, with no
   load-bearing step ordering.

7. **Encode the non-goals as machine-enforced guards.** Guard tests fail CI if
   the package imports a language server on the lint path, if `enrich/` or
   `result/` perform I/O, or if `enrich/` regex-parses diagnostic messages.

The full layering and the seven invariants live in
[`ARCHITECTURE.md`](../../../packages/platformos-mcp-supervisor/ARCHITECTURE.md).

## Consequences

- **Positive.** Collapses several thousand lines of regex re-parsing, duplicate
  graphs, duplicate docset wrappers, and false-positive-correction steps into
  direct reuse of structured output. The pure core is unit-testable without
  booting a server. The brittle byte-for-byte message contract disappears
  entirely.

- **Cost: check-common must carry structured `data`.** The matched identifier
  today lives only in the interpolated `message`. To enrich without
  regex-parsing, `Offense` must gain a typed `data` payload that the relevant
  checks populate. This is a cross-package change with editor/CLI/browser blast
  radius; it is scoped to TASK-8.1 and must be additive.

- **Cost: the supervisor's own intelligence is re-homed, not free.** Per-domain
  rules (domain detection, gotchas, content-trigger tips, `domain_guide`) and
  the rule library (variant hints, did-you-mean, confidence, fixes) are
  genuinely supervisor-owned and absent from check-common. The v2 rebuild
  (TASK-7) ships the clean minimal pipeline; TASK-8 restores this intelligence
  on top of it. Until TASK-8 lands, `validate_code`'s LLM-facing output is
  narrower than v1 — a deliberate, tracked interim state.

- **Mitigation against regression.** A parity safety net (TASK-8.5) compares the
  rebuilt `validate_code` against the 13 captured v1 baselines for
  unchanged-contract fields, with intentional divergences documented rather
  than silently accepted.

- **Reversibility.** The v1 source is recoverable at git `f60bc39`; its reusable
  prose/data and fixtures are salvaged under `docs/mcp-supervisor/salvage/`.

## Appendix: classification of the 16 pos-supervisor structural detectors (TASK-7.2)

Decision #4 ("correctness lives in check-common") required classifying each of
the 16 `pos-supervisor:*` detectors from the old `structural-warnings.ts`
(recoverable at git `f60bc39`) as **correctness** (the code is actually broken —
promote into check-common where editors and the CLI surface it) or **ergonomic**
(agent guidance / convention — keep in the supervisor, restored in TASK-8). The
evidence below is from the current check-common source.

Three dispositions:

- **PROMOTE** — genuine correctness, additive (nothing else detects it). Built
  in TASK-7.2 as check-common `CheckDefinition`s.
- **DROP** — already owned by an existing check-common check. Re-implementing it
  would recreate the very dedup/collision problem the rebuild eliminates by
  construction, so it is intentionally NOT ported.
- **ERGONOMIC** — agent guidance, heuristic, or domain-scoped advice. Restored in
  the supervisor (TASK-8), not check-common.

| # | Detector | Disposition | Rationale (evidence) |
|---|---|---|---|
| 1 | GraphqlMultilineInLiquidBlock | **PROMOTE** | Silent runtime data loss — the grammar truncates a multi-line inline `graphql` at the first newline after a trailing comma, dropping later `name:` args with no error. AST/source-detectable, file-role-independent, ~0 FP. Implemented: `checks/graphql-multiline-in-liquid-block`. |
| 2 | MissingContentForLayout | **PROMOTE** | A layout that never references `content_for_layout` never renders the page body = broken. File-role detectable via `getFileType → Layout`. Additive. Implemented: `checks/missing-content-for-layout`. |
| 3 | DeprecatedTag | **DROP** | Owned by `deprecated-tag` (`code: DeprecatedTag`), driven by docset `tags()` deprecation metadata. |
| 4 | InvalidLayout | **DROP** | Owned by `valid-frontmatter` `checkLayoutExists` — reports `Layout '…' does not exist` for Page/Email. |
| 5 | InvalidMethod | **DROP** | Owned by `valid-frontmatter` — Page schema `method` has `enumValues: [delete,get,patch,post,put,options]` (case-insensitive). The "must be lowercase" nuance is low-value styling → ergonomic. |
| 6 | InvalidFrontMatter (unknown keys) | **DROP** | Owned by `valid-frontmatter` — flags unknown keys per file-type schema. The didactic "use `metadata.title`" rewrites are ergonomic enrichment (TASK-8). |
| 7 | HtmlInPage | **ERGONOMIC** | Pages-domain architectural convention; heuristically suppressed when the page renders partials; not a runtime break. |
| 8 | GraphqlInPartial | **ERGONOMIC** | Runs fine at runtime; an architecture/maintainability convention (partials receive data via explicit passing), partials-domain. |
| 9 | MissingReturn | **ERGONOMIC** | Side-effect-only commands legitimately omit `{% return %}`; high FP. check-common cannot even distinguish a command from a partial (`lib/` → `Partial`). |
| 10 | MissingDocBlock | **ERGONOMIC** | Documentation convention, not a runtime concern; partials-domain. |
| 11 | InvalidSlug | **ERGONOMIC** | Framework-confusion guidance (`[id]`/`{id}`/`<id>` → `:id`); didactic, pages-domain. |
| 12 | NonGetRenderingPage | **ERGONOMIC** | Heuristic (HTML-signal detection + `<form>` action regex scanning + API-slug inference); high-judgment, pages-domain. |
| 13 | MissingSlug | **ERGONOMIC** | `slug` is optional in platformOS (path-derived) and not `required` in the Page schema — this is advice, not correctness. |
| 14 | FilterArgMisuse | **ERGONOMIC** | A hardcoded heuristic arity table (map/sort/where/slice/replace/default/t). Real arity validation belongs in check-common driven by docset filter signatures — a separate, larger effort, not this port. |
| 15 | ShopifyObject | **ERGONOMIC** | `UndefinedObject` (WARNING) already fires on bare Shopify objects (`product`, …). A separate check double-reports → recreates the dedup collision. Restored as data-driven **elevation/enrichment** of `UndefinedObject` in TASK-8. |
| 16 | ShopifyTag | **ERGONOMIC** | `UnknownTag` (in `liquid-html-syntax-error`) already fires on Shopify-only tags. Same collision → restored as data-driven elevation of `UnknownTag` in TASK-8. |

Net for TASK-7.2: **2 promotions** (GraphqlMultilineInLiquidBlock,
MissingContentForLayout), **4 drops** (already engine-owned), **10 ergonomic**
(deferred to TASK-8). The Shopify rows (15, 16) deliberately deviate from the
original task's assumption that contamination would become check-common checks:
both already collide with engine checks, so keeping them as supervisor
enrichment preserves the "single source of truth, no dedup by construction"
goal.
