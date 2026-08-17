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

   > **AMENDED 2026-08-16 — see [§Amendment 1](#amendment-1-2026-08-16--invariant-3-is-about-the-protocol-not-the-package).**
   > Enforcement moved from "declares no `platformos-language-server-*`
   > dependency" to "never speaks the LSP protocol". Importing a PURE helper
   > from the language-server library — specifically the docset markdown
   > renderer — is now permitted under an allowlist.

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

The full layering and the invariants live in
[`ARCHITECTURE.md`](../../../packages/platformos-mcp-supervisor/ARCHITECTURE.md).

## Amendment 1 (2026-08-16) — invariant 3 is about the PROTOCOL, not the package

**Status:** accepted (user decision, 2026-08-16). Amends decision 3 above; every
other decision in this ADR stands.

### What changed

Invariant 3 was enforced as a package-level ban: the supervisor's `package.json`
could declare no `platformos-language-server-*` dependency, and no lint-path
module could import one. It is now enforced as a protocol-level ban — no LSP
wire (`vscode-languageserver*`, `vscode-jsonrpc`), no language-server **runtime**
(`-node`, `-browser`), and no language-server import of any kind inside `lint/`,
`graph-cache/`, `impact/`, `result/` or `transport/`. The **library**
(`-common`) is importable from `enrich/`, restricted to an allowlist of pure
bindings.

### Why

The mistake this invariant exists to prevent is a lossy string round-trip
standing where a typed call belongs: v1 flattened structured offenses into LSP
`Diagnostic` strings and regex-parsed the English back into params. That is a
property of the WIRE. A pure function that takes a docset record and returns
markdown does none of it.

The package-level spelling had a cost the original framing did not anticipate.
`language-server-common/src/docset/MarkdownRenderer.ts` renders a `filters.json`
/ `tags.json` / `objects.json` entry into the markdown every editor hover shows —
exactly what an agent should see about a filter it got wrong. Reaching it under
the old rule meant relocating it plus `TypeSystem.ts` (1,869 LOC) and
`PropertyShapeInference.ts` into check-common: ~2k LOC of duplicated machinery to
satisfy a guard, when the published docset is the source of truth either way.
That directly contradicts the invariant added at the same time — the supervisor
ships no documentation and holds no second copy of platform knowledge.

### Alternatives considered

- **Promote the renderer into check-common.** Rejected: it duplicates a
  1,869-line type system to satisfy a rule, and buys no correctness. Explicitly
  rejected by the user — "we do not want 1800+ LOC duplicate knowledge;
  tags.json, filters.json have to be complete and should be the source of truth."
- **Leave the ban and ship no docset-rendered explanation.** Rejected: it leaves
  the supervisor with only its own prose to explain a finding, which invariant 6
  forbids, so the outcome would be no explanation at all.

### Consequences

- `@platformos/platformos-language-server-common` is a declared dependency.
- **Import it deep** (`.../dist/docset/index.js`), never the package root.
  Measured on top of the check-common the supervisor already loads: **+5 ms** for
  the deep path against **+110 ms** for the index, the difference being the
  css / json / graphql language services. The supervisor is launched per agent
  session, so that cost is paid every session.
- The guard is *tighter* than before in three respects it previously missed: it
  scans all of `src/` rather than the lint path, it bans the LSP wire itself
  (which the old rule never mentioned), and it constrains WHICH bindings may be
  taken from the library. All five forbidden forms were injected and shown to
  fail a test, against a control that still passes.
- `LSP_LIBRARY_ALLOWLIST` in
  `test/guards/architecture-invariants.spec.ts` is the review point: widening it
  is where "reuse a pure helper" could quietly become "depend on a language
  server".

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
| 1 | GraphqlMultilineInLiquidBlock | **REVERTED** | Originally promoted (silent runtime data loss — the grammar truncates a multi-line inline `graphql` at the first newline after a trailing comma, dropping later `name:` args). The check + spec were removed (TASK-10); the detection will be re-implemented a different way. |
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

Net for TASK-7.2: originally **2 promotions** (GraphqlMultilineInLiquidBlock,
MissingContentForLayout); GraphqlMultilineInLiquidBlock was later **reverted**
(TASK-10, to be re-implemented differently), leaving **1 promotion in place**
(MissingContentForLayout), **4 drops** (already engine-owned), **10 ergonomic**
(deferred to TASK-8). The Shopify rows (15, 16) deliberately deviate from the
original task's assumption that contamination would become check-common checks:
both already collide with engine checks, so keeping them as supervisor
enrichment preserves the "single source of truth, no dedup by construction"
goal.

## Amendment 2 (2026-08-16) — the "ergonomic" ten, and why none became a check

**Status:** accepted (user decision, 2026-08-16). Amends the appendix's disposition of the
ten detectors classified ERGONOMIC; the classification of the other six stands.

### The premise that was withdrawn

The appendix routed ten detectors to "restored in TASK-8" because the supervisor was
assumed to be where ergonomic advice lives. It is not: there is ONE detector framework in
this monorepo and it is check-common, which already provides `info` severity,
`recommended: false`, `targets`, per-project `.platformos-check.yml` control and a
documentation page per check. A second framework inside the supervisor would duplicate all
of it and give a detector two homes.

So `advise/` and the `pos-supervisor:` namespace are forbidden outright, and a guard fails
the build if either appears. The question became: which of the ten are check-common checks?

### Measured, then decided

Hit rates over four real projects (project-a, project-b, project-c, pos-module-community).
A high rate on WORKING code does not mean the code is wrong — it means the convention is
not one these projects follow, and an advisory that fires on the majority is noise an agent
cannot distinguish from a finding.

| Detector | Measurement | Outcome |
|---|---|---|
| `MissingDocBlock` | **0 of 4,901** partials carry a `{% doc %}` block — it would fire on **100%** | **DROP** |
| `MissingReturn` | **435 of 443** commands have no `{% return %}` (**98%**), in the ONE project of four that uses `lib/commands` at all | **DROP** |
| `GraphqlInPartial` | 82 of 4,254 view partials (1.9%) — but `lib/**` classifies as `Partial` too, and `lib/queries/**` is exactly where graphql belongs | **DROP** (see below) |
| `HtmlInPage` | 56 of 1,366 pages (4%) | **DROP** (see below) |
| `FilterArgMisuse` | superseded by `FilterArity` + `ValidFilterArgumentTypes`, both docset-driven | **SUPERSEDED** |
| `ShopifyObject` / `ShopifyTag` | `UndefinedObject` / `UnknownTag` already fire; a Shopify-name list would be a third vocabulary no repository owns | **DROP** |
| `InvalidSlug`, `NonGetRenderingPage`, `MissingSlug` | frontmatter conventions, same class as the four above | **DROP** |

### Why the two with acceptable rates were dropped anyway

`GraphqlInPartial` and `HtmlInPage` measure well, and they are still not check-common
checks, for the reason ADR 004 already established: **they are convention truth, not
platform truth.**

- platformOS pages may contain HTML. "Pages should be controller-only" is a house style.
- `{% graphql %}` in a partial runs fine. "Partials receive data by explicit passing" is
  the `core` module's architecture, and check-common cannot even see the distinction it
  rests on — `getFileType` maps `app/lib/**` to `Partial`, so a naive check fires on every
  legitimate `lib/queries/**` file. Telling a query from a view partial requires the
  commands/queries convention, which ADR 004 says must stay out of the platform model.

A check-common check states a platform fact. Shipping a house style as one — even
`recommended: false` — puts the opinion in the place every editor, the CLI and the browser
build read as authoritative.

### Where they go instead

**TASK-9.7's convention overlay**, which ADR 004 created for exactly this: a separate,
clearly labeled, configurable layer over the platform model. `HtmlInPage` and
`GraphqlInPartial` are re-filed there with these measurements attached. The rest are
dropped on the evidence above.

### Consequence

TASK-7.8 ships no new detector. It ships the guard that keeps the supervisor from growing
one, and this record of why each of the ten is not coming back.
