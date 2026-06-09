# `@platformos/platformos-mcp-supervisor` — architecture (v2 rebuild)

This document describes the **target architecture** for the rebuilt
`@platformos/platformos-mcp-supervisor`: a thin, agent-facing MCP server that
exposes a single tool, `validate_code`, on top of a **typed, structured
contract** with the linting engine.

It is the contract every TASK-7 implementation task is checked against. The
invariants in [§Invariants](#invariants) are not aspirational prose — they are
enforced by `test/guards/architecture-invariants.spec.ts`.

- For *why* we rebuilt rather than refactored, see the ADR:
  [`docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md`](../../docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md).
- For the v1 system being replaced (what NOT to rebuild), see
  [`CURRENT_SYSTEM_ARCHITECTURE.md`](./CURRENT_SYSTEM_ARCHITECTURE.md) and
  [`LEGACY_SYSTEM_ARCHITECTURE.md`](./LEGACY_SYSTEM_ARCHITECTURE.md).

---

## 1. One-paragraph summary

The supervisor is a single-tool MCP server. It speaks stdio JSON-RPC and
registers `validate_code`. Each call lints a buffer **in the context of its
project** by calling `platformos-check-node`'s `check()` directly — no
in-process language server, no subprocess — and receives structured
`Offense[]` from `platformos-check-common` with `fix` / `suggest` and a typed
`data` payload intact. A chain of **pure** stages then runs: `enrich` (hints,
confidence, agent-facing fixes, see-also), `advise` (ergonomic-only
`pos-supervisor:` advisories), and `result` (order-independent transforms into
the typed `ValidateCodeResult`: clustering, scorecard, status,
`must_fix_before_write`, `next_step`). The only I/O on the request path is the
lint adapter; everything downstream is a pure function of structured data.

The package is a **leaf consumer** of the engine. Detection and structured
fixes are owned by `platformos-check-common` (the single source of truth for
correctness). The supervisor owns only agent ergonomics — how an LLM consumes
the result.

---

## 2. Layering

```
┌──────────────────────────────────────────────────────────────────────┐
│ platformos-check-common   detection + STRUCTURED fix/suggest (+ data)  │  SINGLE SOURCE
│                           runtime-agnostic, browser-safe               │  OF TRUTH
└──────────────────────────────────────────────────────────────────────┘
        ▲                  ▲                          ▲
        │                  │                          │
┌───────┴──────┐  ┌────────┴────────┐  ┌──────────────┴───────────────┐
│ check-node   │  │ platformos-graph│  │ check-docs-updater            │
│ FS + check() │  │ the ONLY graph  │  │ docset JSON → Augmented docset │
└───────┬──────┘  └────────┬────────┘  └──────────────┬───────────────┘
        │                  │                          │
        └──────────────────┴───── typed seam ─────────┘
                                  │
        ┌─────────────────────────┴─────────────────────────────┐
        │ platformos-mcp-supervisor (THIN)                        │
        │                                                         │
        │  transport/   MCP stdio server · validate_code · zod    │  ← I/O (wire)
        │  lint/        check() adapter · ProjectContext          │  ← I/O (fs)  ⟵ ONLY I/O boundary
        │  enrich/      structured diag → hints, conf, fix, see   │  ← PURE
        │  advise/      pos-supervisor:* ergonomic advisories     │  ← PURE
        │  result/      order-independent → ValidateCodeResult     │  ← PURE
        │  data/        prose + knowledge ONLY                     │  ← static assets
        │  bin/         CLI entrypoint + lifecycle                 │  ← I/O (process)
        └─────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward. The supervisor never re-implements
what a lower layer owns.

---

## 3. Module boundaries

| Layer | Responsibility | May do I/O? | May import |
|---|---|---|---|
| `transport/` | MCP `McpServer` + `StdioServerTransport`; register `validate_code` with a zod input schema; map errors to typed tool status. | Yes (stdio) | `lint`, `enrich`, `advise`, `result`, `@modelcontextprotocol/sdk`, `zod` |
| `lint/` | Build `ProjectContext` (graph + docset, project root via check-common `findRoot`); lint the buffer via check-node `check()` with an in-memory overlay; map `Offense[]` → internal `StructuredDiagnostic`. **The only I/O boundary on the request path.** | Yes (fs) | `@platformos/platformos-check-node`, `@platformos/platformos-check-common`, `@platformos/platformos-graph`, `@platformos/platformos-check-docs-updater` |
| `enrich/` | `(StructuredDiagnostic[], ProjectContext, Knowledge) → EnrichedDiagnostic[]`. Hints, confidence, `FixDescription → agent Fix`, see-also. Reads **typed fields**, never the message string. | **No — PURE** | `data` (knowledge types), check-common **types/fixes**, `@platformos/platformos-graph` (queries) |
| `advise/` | Ergonomic-only `pos-supervisor:` advisories over the AST + context. Guaranteed non-overlapping with check codes. | **No — PURE** | `@platformos/liquid-html-parser`, `data` |
| `result/` | Order-INDEPENDENT pure transforms → `ValidateCodeResult` (cluster, scorecard, status, `must_fix_before_write`, `next_step`; 0-based → 1-based). | **No — PURE** | `enrich`/`advise` output types |
| `data/` | Prose + knowledge ONLY (hints, gotchas, content-triggers, contamination lists). Base check metadata derived from check-common `meta`, never re-authored here. | static | — |
| `bin/` | `#!/usr/bin/env node` CLI; `--project`/env resolution; SIGINT/SIGTERM lifecycle; stderr-only logger. | Yes (process) | `transport` |

`enrich/` and `result/` are the **pure core** and carry the bulk of the logic,
so they are unit-testable without booting anything. All filesystem and docset
I/O has already happened in `lint/` before they run.

---

## 4. The typed seam

The seam between the engine and the supervisor is a **typed structured API**,
never a serialized string protocol:

- **`Offense`** (from `platformos-check-common`) — `{ type, check, message,
  uri, severity, start, end, fix?, suggest? }`, plus a typed structured `data`
  payload carrying the matched identifier(s) and any suggestion candidates the
  check already computed. Enrichment reads these typed fields; it **never**
  regex-parses `message`.
- **`platformos-graph`** — the single cross-file dependency graph, used for
  cross-file checks and "did you mean?" nearest-match queries.
- **`AugmentedPlatformOSDocset`** — the single docset wrapper (memoization,
  alias expansion, undocumented-entry injection), fed by
  `platformos-check-docs-updater`.

`Offense.fix` / `suggest` carry a `Fixer` *function*; concrete edits are
obtained by running it through a check-common `StringCorrector` +
`applyFixToString` to get `FixDescription[]`, which `enrich/` then maps to the
agent-facing `Fix` shape. The supervisor authors **no** detection and **no**
new correctness fixes.

> The `data` payload on `Offense` and the full per-check rule library that
> consumes it are scoped to the **post-rebuild** epic (TASK-8), not this phase.
> The v2 rebuild (TASK-7) stands up the clean minimal pipeline; TASK-8 restores
> the supervisor's irreducible per-domain + rule-library intelligence on top.

---

## 5. Request flow (`validate_code`)

```
input { file_path, content, mode }
  → lint/      parse + check() with project overlay → StructuredDiagnostic[]   (I/O)
  → enrich/    hints · confidence · agent fixes · see-also                     (pure)
  → advise/    pos-supervisor:* ergonomic advisories                          (pure)
  → result/    cluster · scorecard · status · must_fix_before_write · next_step (pure)
  → ValidateCodeResult
```

`mode` controls depth: `quick` = lint + enrichment; `full` additionally runs
the heavier ergonomic stages (advisories, clustering, scorecard, guidance).
The exact per-mode behaviour is defined and documented in the
`validate_code` handler (TASK-7.10).

---

## 6. Invariants

These are the rebuild's non-goals, enforced by
`test/guards/architecture-invariants.spec.ts`. A violation fails CI.

1. **No in-process LSP for linting.** Lint via a direct `check()` call. (A
   language server is only ever acceptable for hover/completion, if a future
   task needs it — never on the lint path.)
2. **No string round-trip.** Enrichment consumes the STRUCTURED `Offense`
   (typed fields + structured `fix`/`suggest` + `data`). No regex over
   diagnostic `message` strings.
3. **One graph, one docset.** `platformos-graph` and
   `AugmentedPlatformOSDocset` only. No bespoke project graph, fact graph,
   dependency graph, or docset/index wrappers.
4. **Correctness lives in check-common** as `CheckDefinition`s. The supervisor
   keeps ONLY agent ergonomics.
5. **Enrichment + result assembly are PURE functions.** All I/O (fs scan,
   docset load) happens at the `lint/` edge. No load-bearing step ordering in
   `result/`.
6. **One source of check metadata.** Prose lives in `data/`; base metadata
   (code / description / severity) is read from check-common `meta`, never
   re-authored.
7. **The package stays a leaf consumer.** The seam to the engine is a TYPED
   API, never a serialized string protocol.

### Machine enforcement (TASK-7.1)

| Guard | Invariant | What it scans |
|---|---|---|
| dependency guard | #1, #7 | `package.json` deps + `src/{lint,enrich,advise,result,transport}` imports — no `platformos-language-server-*`. |
| purity guard | #5 | `src/{enrich,result}` — no `fs`/`child_process`/`net`/`http`/`os`/… import, no `process.*`, no import of `lint/`. |
| no-regex-message guard | #2 | `src/enrich` — no regex op applied to a diagnostic `.message`; no `extractParams`/`templateOf`/`diagnostic-record` re-parsing layer. |

Each guard scans real `src/**` (passing vacuously until a layer is scaffolded,
biting the moment a violation lands) and is backed by inline good/bad
self-tests that pin its failure behaviour deterministically.

---

## 7. Scope boundaries

**This phase (TASK-7)** delivers the clean minimal `validate_code`: structured
seam, pure pipeline, single source of truth for checks, and the machine guards
above.

The classification of the 16 old `pos-supervisor:*` structural detectors
(correctness → promoted into check-common; already-owned → dropped; ergonomic →
TASK-8) is recorded in the
[ADR appendix](../../docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md#appendix-classification-of-the-16-pos-supervisor-structural-detectors-task-72).

**Post-rebuild (TASK-8)** restores the supervisor's irreducible intelligence on
this foundation — the structured `data` payload on the seam, the per-domain
layer (domain detection, gotchas, content-trigger tips, `domain_guide`), the
ported rule library (variant hints, did-you-mean, confidence, fixes), and the
remaining result fields (`tips`, `domain_guide`, `structural`, `parse_error`) —
all without violating the invariants above.

**Permanently out of scope** (decided at the v1 migration, see
`CURRENT_SYSTEM_ARCHITECTURE.md` §10): the analytics / adaptive engine /
case-base / CAC / dashboard, the HTTP transport, and the nine MCP tools other
than `validate_code`.
