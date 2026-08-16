---
id: TASK-7
title: >-
  Rebuild platformos-mcp-supervisor from scratch as a thin agent-ergonomics
  layer on a structured contract
status: To Do
assignee: []
created_date: '2026-06-08 09:55'
updated_date: '2026-08-16 15:02'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/ARCHITECTURE.md
  - docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-docs-updater/data
  - ~/projects/pos/platformos-documentation
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why rebuild instead of refactor

The original `platformos-mcp-supervisor` (removed at git f60bc39) was joined to the linting engine by the WRONG seam: it booted a language server in-process, received FLAT LSP message strings (structured fix/suggest dropped), regex-parsed those English messages back into params, regenerated fixes from scratch (~1.7k LOC), re-derived the project graph and docset, and corrected its own false positives in a 15-step "load-bearing ordered" pipeline. ~16.3k LOC of duplicated intelligence connected by a brittle string contract.

## Target architecture

```
platformos-check-common      detection + STRUCTURED fixes + check metadata   SINGLE SOURCE
platformos-common            paths/URIs, file identity                        OF TRUTH
      ^
check-node (FS + check())   platformos-graph (the ONLY graph)   check-docs-updater (docset JSON)
      ^
platformos-mcp-supervisor (THIN)
   transport/   MCP stdio server, validate_code, lifecycle
   lint/        check-node lintBuffers -> structured diagnostics   <- the ONLY I/O boundary
   graph-cache/ + impact/   cached project graph, blast radius
   enrich/      PURE: docset/meta-derived explanation + FixDescription passthrough
   result/      PURE order-independent transforms -> ValidateCodeResult
```

There is no `data/` directory and no `advise/` layer. Both were planned and are now
explicitly forbidden (invariants 4 and 6).

## Architectural invariants (machine-enforced, not aspirational)

1. **No LSP protocol on the lint path.** Linting is a direct `check()`/`lintBuffers` call — never a server boot, transport, document manager or `Diagnostic` round-trip. Importing PURE library functions from `platformos-language-server-common` (e.g. the docset markdown renderer, the type system) is ALLOWED off the lint path; re-authoring them here is not.
2. **No string round-trip.** Enrichment consumes structured `Offense` fields. No regex over `message`.
3. **One graph, one docset.** `platformos-graph` and `AugmentedPlatformOSDocset` only.
4. **One detector framework.** Every detector — correctness or ergonomic — is a check-common `CheckDefinition`. The supervisor authors no detectors and owns no `pos-supervisor:` namespace.
5. **Enrichment + result assembly are PURE.** All I/O happens at the `lint/` edge.
6. **The supervisor ships NO documentation.** It must not contain a filter, tag, object or property table, nor prose describing platform semantics. Platform vocabulary comes from `filters.json` / `tags.json` / `objects.json` / `liquid_doc.json` — published by `~/projects/pos/platformos-documentation` (`/api/liquid/*`), fetched by `platformos-check-docs-updater`, read through `AugmentedPlatformOSDocset`. Per-check explanation comes from check-common `meta.docs` (`description` + `url`, which points at that check's page in the documentation repo). **A gap in the docset is fixed UPSTREAM, never patched locally** — a local table is a second source of truth that goes stale silently. The supervisor may describe ITSELF (its result contract, how to read an answer); it may not describe the PLATFORM.
7. **Leaf consumer, typed seam.** Never a serialized string protocol.
8. **Per-project work is paid once.** The request path batches buffers into one lint pass and reads a cached graph; nothing re-walks the project per file.

## Revision 2026-08-16 — what this epic no longer does

This epic was written in June against a package that has since been largely built, and
against assumptions the current directive reverses. Three planned pieces are CANCELLED:

- **The `data/` knowledge layer** (salvaged prose, hints/*.md, gotchas, content-triggers,
  Shopify-contamination lists). It would have made the supervisor a second place platform
  facts live. Invariant 6 forbids it. TASK-7.5 is repurposed into its opposite.
- **The `advise/` layer and the `pos-supervisor:` namespace.** The 10 detectors ADR 002
  classified as "ergonomic" become check-common checks. TASK-7.8 is repurposed.
- **`mode: full | quick`.** Removed by TASK-12.5 (archived); there is no heavy stage to
  skip. Struck from TASK-7.10.

Two invariants were AMENDED rather than dropped: #1 now bans the LSP *protocol* rather
than the *package* (decided 2026-08-16 — duplicating a 1,869-LOC type system into
check-common to satisfy a guard buys nothing), and #6 replaces the old "one source of
check metadata" with the stronger "no documentation at all".

## Salvage

`docs/mcp-supervisor/salvage/` is NO LONGER ON DISK (untracked, then deleted). Recover
with `git checkout 69aa9e4 -- docs/mcp-supervisor/salvage`. Only the **fixtures** are
still wanted (TASK-7.11); the `data/` prose is dead by invariant 6, and
`OLD-ARCHITECTURE.md` describes what NOT to rebuild.

## Current state (verified 2026-08-16)

Built and passing: transport + stdio bin, batch lint adapter over `lintBuffers`, graph
cache with worker build, impact/blast-radius, result assembly, blocking gate, response
budget, 22 spec files under root `yarn test`. Missing: `enrich/` (does not exist), the
`Offense.fix`/`suggest` passthrough, and the documentation cleanup this revision adds.

This is the tracking epic. See child tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All child tasks completed
- [x] #2 The package ships validate_code over stdio, builds and type-checks, and its tests run under root yarn test
- [x] #3 No code path boots a language server or an LSP transport to lint; no module regex-parses diagnostic message strings; no duplicate project graph or docset wrapper exists
- [x] #4 The package contains no filter/tag/object/property table and no prose describing platform semantics; platform vocabulary is read from the docset and per-check explanation from check-common meta.docs
- [x] #5 Every detector is a check-common CheckDefinition; the package defines no detectors and no pos-supervisor: namespace
- [x] #6 A guard fails the build if any of the above is reintroduced, and ARCHITECTURE.md states the invariants in the amended form
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress checkpoint — 2026-06-09: subtasks 7.1–7.4 complete (4 of 11)

The rebuilt package now exists and runs end-to-end over MCP stdio with a typed stub `validate_code`. No global regressions across the monorepo.

| Task | Result | Verification |
|------|--------|-------------|
| **7.1** Architecture + guards | ADR `docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/`, package `ARCHITECTURE.md`, 3 machine-enforced invariant guards (no-LSP-on-lint-path, enrich/result purity, no-regex-over-message) under `test/guards/` | 12/12 guard tests; proven to bite on injected violations |
| **7.2** Promote correctness checks | Classified all 16 old structural detectors (table committed to ADR 002 appendix). PROMOTED 2 → check-common: `GraphqlMultilineInLiquidBlock`, `MissingContentForLayout`. DROPPED 4 already-engine-owned (DeprecatedTag/InvalidLayout/InvalidMethod/unknown-key InvalidFrontMatter). 10 ERGONOMIC → TASK-8. Shopify obj/tag = ergonomic (enrichment over UndefinedObject/UnknownTag, user-approved) to avoid recreating the dedup collision. Factory configs regenerated. | check-common 1037/1037; check-node 98/98 |
| **7.3** check-node lint seam | `lintBuffer({root,filePath,content,configPath?})` — loads project from disk, overlays the in-memory buffer, returns structured `Offense[]` for the file with fix/suggest intact; NO LSP/subprocess. Shared `lintApp` helper; README + new check-node CLAUDE.md. | check-node 98/98 (3 new hermetic specs) |
| **7.4** Package scaffold | Thin `package.json` (NO language-server dep), tsconfig(.build), `result/types.ts` (ValidateCodeResult contract, v1-aligned for parity; TASK-8 fields optional), stderr logger, `transport/` (McpServer+stdio+stub handler), `bin/` (args split + lifecycle), index. | package 22/22 (args 8 + guards 12 incl. active pkg.json denylist + smoke 2); language-server-common + check-browser 466/466 |

**Architectural invariants holding:** no in-process LSP for lint; structured `Offense` seam (no message round-trip); single source of truth for checks in check-common; reuse find-root/graph/docset (named in 7.6); enrich/result to stay pure.

**Scope reminder (user directive):** TASK-7 ships the clean MINIMAL `validate_code`. Per-domain rules, the rule library, and the full result fields (tips/domain_guide/structural) are deferred to the TASK-8 epic. Keep 7.5/7.7/7.8/7.9 lean.

**Remaining (integration half):** 7.6 lint adapter (ProjectContext: graph+docset+findRoot → lintBuffer → StructuredDiagnostic) [deps 7.2/7.3/7.4 all done] → 7.5 data (trimmed) → 7.7 enrich (minimal) → 7.8 advise (minimal) → 7.9 result assembly → 7.10 wire real handler → 7.11 tests + fresh baselines.

Verification commands used: `yarn vitest run <pkg>`, `yarn workspace <pkg> type-check`, `yarn workspace @platformos/platformos-mcp-supervisor build`.

## Update — 2026-06-12: lint-only validate_code slice + salvage untracked

**validate_code now lints for real** (user-directed descope: only the `check()` adapter for now). Flow: resolve path → check-node `lintBuffer` (check() with buffer overlaid on the on-disk project; NO LSP) → map `Offense`→diagnostic (1-based line+col) → bucket into errors/warnings/infos + status + must_fix. All ergonomic/TASK-8 fields stay empty/null; fixes not translated; `mode` a no-op. New files: `src/lint/lint.ts`, `src/result/assemble.ts`, handler rewired in `src/transport/validate-code.ts`; tests assemble(5)/lint(3)/smoke(3 end-to-end). Package suite 31/31; guards 12/12. See partial notes on TASK-7.6 / 7.9 / 7.10.

**Salvage untracked:** `docs/mcp-supervisor/salvage/` (139 files) removed from git via `git rm -r --cached` + `.gitignore` to keep PRs small (it was ~68% of the branch diff). Files remain on disk; recoverable at commit `69aa9e4` via `git checkout 69aa9e4 -- docs/mcp-supervisor/salvage`. TASK-7.11 and TASK-8.5 (which consume the fixtures/parity baselines) carry recovery notes.

## Revision — 2026-08-16: re-scoped against the "no documentation in the supervisor" directive

User directive: no information or documentation lives in the supervisor — it comes from
`tags.json` / `filters.json` etc. published by `~/projects/pos/platformos-documentation`;
reuse `platformos-common` and `platformos-check-common` as far as possible; leverage the
LSP where it makes sense; be efficient.

Two decisions taken with the user before rewriting:

1. **LSP reuse — relax the invariant, do not duplicate.** Invariant #1's package-level ban
   is amended to a protocol-level ban (new TASK-7.12). The supervisor may import pure
   library functions from `language-server-common` — principally
   `docset/MarkdownRenderer.ts`, which renders a `filters.json` / `tags.json` entry into
   the markdown every editor hover shows. Rejected alternative: relocating it plus
   `TypeSystem.ts` (1,869 LOC) into check-common. User: "we do not want 1800+ LOC duplicate
   knowledge — tags.json, filters.json have to be complete and should be the source of
   truth, we can improve them if needed."

2. **Ergonomic detectors fold into check-common.** No `advise/` layer, no
   `pos-supervisor:` namespace. check-common's check framework already provides `info`
   severity, `recommended: false`, per-project config gating and a doc page per check;
   a second detector framework would give a detector two homes. TASK-7.8 is inverted and
   ADR 002's classification appendix needs an amendment.

**Task changes:** 7.5 inverted (was: build a `data/` knowledge layer — now: prove the
package ships none). 7.6 narrowed to the `fix`/`suggest` passthrough plus guards for what
was only true by inspection; the `StructuredDiagnostic` intermediate is dropped as
redundant against `ValidateCodeDiagnostic`. 7.7 rewritten around three external sources
(engine correctors, docset render, `meta.docs`) instead of local prose. 7.8 inverted.
7.9 stale ACs (clusters/scorecard) replaced with the `BLOCKING_CHECKS` ↔ registry link and
a real order-independence proof. 7.10 `mode` struck. 7.11 updated for the vanished salvage
directory. NEW: 7.12 (invariant amendment + guard rewrite), 7.13 (`instructions.ts` audit —
~60 of 142 lines are platform documentation, and it is spent context every session).

**Unresolved conflict with the TASK-8 epic.** TASK-8.2 ("per-domain intelligence layer:
domain detection, gotchas, tips, domain_guide") and TASK-8.3 ("port the v1 rule library")
both assume the `data/` knowledge directory that invariant 6 now forbids. They were not
touched by this revision and need re-scoping before they are started.

## 2026-08-16 — seven of eight children complete; the epic's invariants all hold

Done and moved to `.backlog/completed/`: **7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12**.
Outstanding: **7.13 AC #5 only** (cross-repo, awaiting approval — see below).

### What the package looks like now

`src/` is `transport/ validate/ lint/ graph-cache/ impact/ enrich/ result/ bin/` plus
`check-docs.ts`. No `data/`. No `advise/`. `validate_code` runs
**decline → lint → enrich → result → response budget**, and the two pure stages are pure
by shape rather than by discipline: the docset is resolved to plain arrays at the edge, so
`enrich/` has nothing to await.

### Three bugs the work surfaced, none of them predicted

1. **Fixers were being run after the overlay was reverted** (introduced by 7.6, found by
   7.11's realistic sweep). `missing-doc-param`'s fixer reads `file.source`, so it threw
   `AppFile source read before it was loaded` and took the whole request down — and where
   the file happened to still be loaded it would have computed the fix against DISK text.
   Fixed by materialising fixes in check-node, inside the overlay.
2. **`AgentFix` could hold one edit** when block-tag renames need two. Measured: 15 of
   6,238. A single-edit shape would have applied half a rename and left the file
   unparseable.
3. **12 of 43 checks publish no `docs.url`**, four of which BLOCK a write.

All three were found by measuring rather than reasoning. So was the 100% hit rate that
killed `MissingDocBlock`, and the wrong `GraphqlInPartial` number I nearly believed.

### The invariants, all machine-enforced and all sabotage-verified

Every one of the eight was injected with a violation and shown to fail, each against a
control that still passes. The purity and no-regex guards had been vacuous since they were
written — `enrich/` did not exist — and now scan real source.

### Contract changes an agent will notice

- diagnostics now carry `fix` / `suggestions` (the engine's own edits) and `see_also`;
- `suggestion?: string` → `suggestions?: AgentFix[]` (suggest-only offenses outnumber
  fixes 3,555 to 2,631);
- `see_also` is a bare URL, not a tool pointer;
- `confidence` removed — populating it would have meant inventing a number;
- server instructions **7,863 → 5,300 chars**, with every removed claim proven still caught.

### The one thing left, and why it stopped

TASK-7.13 AC #5: the 12 checks with no documentation page need pages created in
`~/projects/pos/platformos-documentation`. That gap matters more now than before — the
rewritten instructions tell an agent to follow `see_also` rather than guess at a rule, and
for those twelve there is nothing to follow. Writing into a different repository is left
for explicit approval rather than done as a side effect.

### Note on the working tree

`packages/platformos-check-docs-updater/data/*` shows as modified: the docs-updater's
`postbuild` re-downloaded the docset during `yarn build` and a genuine docs release had
landed (revision `9349bf71` → `0064715f`). Expected behaviour, not an edit — and the full
suite passed against the newer data.
<!-- SECTION:NOTES:END -->
