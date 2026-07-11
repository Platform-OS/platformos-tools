---
id: TASK-9.10
title: Cached project graph at the supervisor edge → blast-radius in validate_code
status: Done
assignee:
  - Filip
created_date: '2026-07-01 19:38'
updated_date: '2026-07-01 23:26'
labels:
  - platformos-graph
  - mcp-supervisor
  - validate-code
  - performance
  - architecture
dependencies:
  - TASK-9.2
  - TASK-9.8
  - TASK-9.9
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - SUPERVISOR-GRAPH-INTEGRATION.md
  - packages/platformos-graph/src/graph/query.ts
  - packages/platformos-mcp-supervisor/src/structure/structure.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-check-common/src/checks/partial-call-arguments/index.ts
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The graph's current contribution to `validate_code` is almost entirely REDUNDANT with the lint layer: broken references are caught by `MissingPartial`/`MissingAsset`, and argument correctness by `PartialCallArguments` (a recommended lint check that resolves the target, reads its `{% doc %}` signature, and reports missing-required/unknown args for render+function). The per-file graph outputs (`dependencies`, `structural`) mostly echo the buffer the agent just wrote.

The ONE thing the graph can do that lint structurally CANNOT is the BACKWARD / cross-file direction: lint is per-file and forward-looking — it can say "this file's calls are valid" but never "editing THIS file breaks its N callers." That reverse-index / blast-radius answer is the graph's unique value, and it is not wired into `validate_code` today. This task delivers it.

WHAT. Stand up a cached full `AppGraph` at the supervisor I/O edge (keyed by project root, reused across `validate_code` calls instead of rebuilt per call), and surface blast-radius for the edited file — who depends on it — via the EXISTING query API (`dependentsOf`), never re-derived in the supervisor.

KEY DESIGN CONSTRAINTS / DECISIONS (must be resolved as part of this task):
- FRESHNESS (the hard part). The agent is editing the very file whose callers we report. The cache MUST overlay the unsaved in-flight buffer for that file (the buffer-before-write model already used by `runStructure`/`runLint`) so blast-radius reflects current content — a dependent that the edit is ADDING or REMOVING must be reflected, not read stale from disk.
- INVALIDATION (ADR 003 open question #5). TTL vs explicit fs-change invalidation vs both. Full build on this real project is ~50s / 1,505 nodes — so per-call rebuild is a non-starter; the cache must amortize. Decide + document cold-start / warm-up behavior.
- REVERSE-INDEX COMPLETENESS. `dependentsOf` is only as complete as the graph's entry points (see `query.ts` header: to see all callers you must build with every file as an entry point, not just pages+layouts). Decide the build scope that guarantees complete dependents, and document the guarantee.
- NON-MISLEADING OUTPUT (repo north star). "No dependents" (safe to change) MUST be distinguishable from "not computed / cache cold" (unknown). A stale or unbuildable graph must DEGRADE gracefully — never emit a wrong/blank blast-radius that lulls the agent into an unsafe edit. Mirror the F2 secondary-signal contract (a graph failure never sinks the lint gate).
- OUTPUT SHAPE. Decide what `validate_code` returns: dependent count + sample paths? full list? signature-impact ("N callers, K of them pass an arg you're changing")? Keep it small and agent-actionable, not a raw dump.

RELATED DECISION (coupled, resolve alongside — see blunt review): demote/remove the now-redundant `dependencies`/`structural` from the default `validate_code` output (keep the graph primitives; they still serve the CLI/serialize/TASK-9.7). Track here or split, but don't ship blast-radius while the redundant echo still bloats the response.

REUSE, DO NOT RE-DERIVE: consume `buildAppGraph` + `dependentsOf`/`nearestModules` from platformos-graph; the supervisor owns only caching + output shaping (ADR 003 consumer principle).

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A project-graph cache lives at the supervisor I/O edge (sibling to lint/structure adapters), keyed by project root, built once via buildAppGraph and reused across validate_code calls (verified: N calls do not trigger N full builds).
- [x] #2 Blast-radius freshness: the edited file's in-flight buffer is overlaid onto the cached graph so dependents reflect the unsaved content — an added/removed reference changes the reported callers (covered by a test that edits a buffer and asserts the dependent set changes accordingly).
- [x] #3 validate_code surfaces blast-radius for the edited file via platformos-graph's dependentsOf (no reverse-index logic re-implemented in the supervisor); output shape decided, small, and agent-actionable.
- [x] #4 Non-misleading contract: 'no dependents' is distinguishable from 'not computed'; a cold/stale/unbuildable graph degrades gracefully and NEVER sinks the lint gate or emits a wrong blast-radius (mirrors F2).
- [x] #5 Reverse-index completeness guarantee decided + documented: the cache is built with a scope that yields complete dependents (per query.ts entry-point note), or the output explicitly states its scope.
- [x] #6 Cache invalidation strategy (TTL and/or fs-change) implemented + documented, resolving ADR 003 open question #5; cold-start/warm-up behavior defined and the warm path is sub-second on a ~1,500-node project.
- [x] #7 Coupled decision executed: the redundant dependencies/structural are demoted/removed from the default validate_code output (graph primitives retained for CLI/serialize/TASK-9.7), with rationale recorded.
- [x] #8 TDD + comprehensive tests: cache reuse, buffer-overlay freshness, invalidation, blast-radius correctness on a fixture, and graceful degradation; all package suites + direct-tsc type-check + format:check + frozen-lockfile green.
- [x] #9 Docs updated: SUPERVISOR-GRAPH-INTEGRATION.md (blast-radius wired, dependencies/structural demoted) and ADR 003 open question #5 marked resolved.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
BLAST-RADIUS SPEC for validate_code — EXACTLY what the graph contributes (and what it must NOT).

Principle: validate_code stays lint-first (forward-looking, per-file). The graph adds ONE thing lint structurally cannot: the BACKWARD direction — "who depends on the file being edited, and does this edit break them." Everything else the graph could add is either redundant with lint or noise, and is excluded.

=== INCLUDED (graph-unique; lint cannot produce these) ===
1. DIRECT DEPENDENTS of the edited file F — incoming edges, via `dependentsOf(cachedGraph, F)`.
   - Shape: { total, by_kind (render/include/function/background/graphql/layout), sample: capped ≤10 caller paths }.
   - Direct only. Count + capped sample — NEVER the full list, NEVER a raw dump.
   - Only meaningful for file kinds with incoming edges: partials, lib (commands/queries), layouts, graphql, schema. A page (entry point) normally has 0 dependents → impact empty → correct.

2. SIGNATURE-IMPACT (the high-value refinement — turns "106 files depend on this" into "3 of them break"):
   - Trigger: the in-flight buffer CHANGES F's declared interface vs the on-disk version.
   - For partials/lib: compare F's NEW `{% doc %}` @param signature (from the buffer via extractStructural / extractDocDefinition) against each caller's passed args (from the cached graph's edge.args).
   - Report, per affected caller: params now MISSING that F newly requires; args the caller passes that F NO LONGER declares (removed/renamed).
   - CONSERVATIVE: only when F HAS a `{% doc %}` block (explicit contract). No doc block → NO signature-impact (do not infer/guess — avoids false positives that would mislead). 
   - REUSE, do not re-implement: derive required/allowed params via the same logic as the PartialCallArguments check (feed it F's buffer signature instead of the on-disk target). This is the inverse of PartialCallArguments (that check fires when editing the CALLER; this fires when editing the TARGET) — genuinely non-redundant.

3. FRESHNESS / HONESTY: "no dependents" (safe to change) MUST be distinguishable from "not computed" (cache cold/unbuildable). Degrade gracefully — never emit a wrong or blank blast-radius (F2 secondary-signal contract).

=== EXPLICITLY EXCLUDED (redundant, noisy, or harmful) ===
- TRANSITIVE / closure dependents — explosive (a leaf util → hundreds), rarely actionable, token-bomb. Direct callers only. (A separate on-demand query can offer reachability if ever needed — not in validate_code.)
- F's OUTGOING dependencies (the current `dependencies` field) — redundant with lint: MissingPartial/MissingAsset resolve+flag targets, PartialCallArguments checks the args. DEMOTE from default output (this task's AC #7).
- Broken-reference detection on F's own refs — lint (MissingPartial/MissingAsset).
- Argument validation of F's own outgoing calls — lint (PartialCallArguments).
- did-you-mean / nearest-name for F's refs — lint (MissingPartial already suggests).
- `structural` self-echo — a summary of the buffer the agent just wrote; no signal. DEMOTE.
- ASSET dependents on a content edit — editing an asset's bytes does not break path-based references; low/zero value. Skip (rename/delete semantics are not modeled).
- Separate orphan/reachability status field — dependents.total === 0 already conveys "nothing references this."

=== OUTPUT SHAPE (illustrative; finalize in impl) ===
"impact": {
  "scope": "direct",
  "dependents": { "total": N, "by_kind": { ... }, "sample": [ ≤10 project-relative paths ] },
  "signature_risk": [ { "caller": "<path>", "missing_required": ["count"], "no_longer_accepted": ["foo"] } ],
  "status": "computed" | "unavailable"
}
- Present `impact` only when total > 0 OR signature_risk is non-empty; otherwise omit (or an explicit empty with status). Never clutter a brand-new/leaf file with noise.

=== SEQUENCING within this task ===
- MVP: cached graph + DIRECT DEPENDENTS (count + by_kind + capped sample) + freshness honesty + demote dependencies/structural.
- Enhancement (same task or fast-follow): SIGNATURE-IMPACT (the arg/@param inverse check). Highest value; do as soon as the cache + dependents land.

Note: dependents are INCOMING edges from OTHER files (read from the cached on-disk graph); the buffer overlay matters for the SIGNATURE side (F's new @param), not the dependents-list side (callers are other files). A NEW file the agent is creating has 0 dependents → correct empty impact.

APPROVED PLAN REVISIONS (2026-07-01).

DECISIONS (user-approved): Q1 signature-impact IS in this task (Phase C). Q2 FULL removal of dependencies/structural from validate_code output (no dead fields); drop the runStructure call + remove the now-dead supervisor structure adapter; KEEP the graph primitives (extractFileReferences/extractStructural in platformos-graph) for CLI/serialize/9.11/9.12.

AC #2 CORRECTION (approved): blast-radius = who depends on F = F's INCOMING edges, which live in OTHER files. Editing F's buffer changes F's OUTGOING edges/signature, never who points at F. So the dependents list does NOT overlay the buffer — it comes from the cached disk graph. The buffer is used ONLY for signature-impact (F's new doc block vs callers' args, parsed directly). Freshness for the dependents list = DISK freshness enforced by fingerprinting (below), NOT buffer overlay. AC #2's original buffer-overlay framing is superseded by this.

FRESHNESS = NEVER SERVE STALE (user mandate: staleness may mislead the LLM, avoid at all costs). SWR (serve-stale-while-revalidate) REJECTED. Design: GraphCache stores { graph, fingerprint } where fingerprint = map(liquidFilePath -> mtimeMs+size) over the build's liquid files (liquid files are the only edge SOURCES, so only their add/remove/modify can change dependents; schema/graphql/asset are leaves). Per request: recompute current fingerprint (cheap stat-walk; cheaper than lint's existing per-call whole-project parse), compare. MATCH -> fresh -> serve dependents (status: computed). MISMATCH or no graph -> do NOT serve old graph -> status: recomputing + fire dedup'd background rebuild. build error -> status: unavailable. Never blocks/awaits the build on the request path (F2); never serves stale. Practical behavior: agent validates BUFFERS (no disk write) across a burst -> fingerprint keeps matching -> fresh every call; rebuild triggers only after an actual file write.

PHASING: A = GraphCache (fingerprint, never-stale, background build) + blast-radius MVP (direct dependents: total/by_kind/sample<=10) wired into validate_code, graceful degradation. B = full removal of dependencies/structural + remove dead structure adapter + update assemble/stdio-smoke/validate-code specs. C = signature-impact (F's doc block vs callers' args; reuse PartialCallArguments param-derivation; conservative, doc-block-only). D = docs (SUPERVISOR-GRAPH-INTEGRATION.md + ADR003 Q5) + full cross-package verification. TDD each phase.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (Phases A-D complete). GraphCache src/graph-cache/ (never-stale, fingerprint-validated, background-built, dedup'd; injectable seams). Impact adapter src/impact/ (dependents via dependentsOf + signature_risk via extractDocDefinition vs edge args). validate_code reshaped: removed dependencies+structural, added impact; removed the dead structure adapter; SupervisorContext gains graphCache (created in startServer). Reuse-only: buildAppGraph/dependentsOf/toSourceCode + extractDocDefinition + isLayout/isPage/isPartial + recursiveReadDirectory; node:fs only for mtime (AbstractFileSystem.stat lacks it).

AC#2 delivered per the approved correction: dependents come from the cached DISK graph (buffer never overlaid — who points at F lives in other files); the buffer is used only for signature_risk. Freshness = fingerprint (mtime:size over edge-source liquid files), never stale.

SIGNATURE-IMPACT (Q1, in this task): conservative, doc-block-only (no inference); reports callers missing a required @param or passing an undeclared one; the cross-file inverse of PartialCallArguments.

MEASURED on real marketplace-dcra (1,505 nodes): warm request ~400ms (fingerprint scan, concurrent with lint → ~0 added wall-clock), cold first fingerprint ~8s (hidden behind lint's cold parse), background build ~22s (never awaited). Warm path sub-second confirmed.

VERIFICATION: supervisor 55 green (graph-cache 7, impact 10, validate-code 3, assemble 6, stdio-smoke 6 incl. real blast-radius + signature-impact e2e, guards 12, lint 3, args 8); direct tsc clean; format:check clean; frozen-lockfile clean, zero yarn.lock churn. No source changed outside the supervisor — graph/common/check-common/LSP suites unaffected (last green: graph 80, common 261, check-common 1057, LSP 467).

DOCS: SUPERVISOR-GRAPH-INTEGRATION.md §1/§4/§5.1/§6/§7 updated + new §9 (TASK-9.10); ADR 003 open question #5 marked RESOLVED (fingerprint never-stale cache).

FOLLOW-UPS (noted, out of scope): fingerprint walks whole tree incl. non-platformOS dirs (~400ms warm) — scope the walk / reuse lint's file list; bounded-await for small projects' cold start; getApp memoization (doubt #8) remains the higher-value perf lever.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired the graph into validate_code the way that actually earns its keep: a never-stale cached project graph powering a cross-file BLAST-RADIUS signal (who depends on the edited file + signature-impact), and removed the redundant per-file dependencies/structural (lint already covers broken refs via MissingPartial/MissingAsset and args via PartialCallArguments).

GraphCache (src/graph-cache/): builds the full AppGraph once (all liquid files as entry points -> complete dependents), reuses it across calls, background-built, NEVER served stale. Rejected TTL and stale-while-revalidate (both can mislead the agent); instead fingerprint-validates every request (mtime:size over edge-source liquid files) and reports `computing` on any change rather than a wrong answer. Never awaited on the request path (F2: a graph failure never sinks the lint gate). ADR 003 open question #5 resolved.

impact (src/impact/): dependents {total, by_kind, sample<=10} via dependentsOf; signature_risk (doc-block-only, conservative) flags dependent callers whose args violate the buffer's {% doc %} contract via extractDocDefinition vs the graph edges' args - the cross-file inverse of PartialCallArguments. status computed|computing|unavailable makes "nothing depends on this (safe)" distinguishable from "not computed" - never misleading.

Removed dependencies+structural from the result and the dead structure adapter; kept the graph primitives for the CLI/serialize/9.11/9.12. SupervisorContext gains a per-project graphCache (created in startServer).

TDD throughout. Verified on the real 1,505-node marketplace-dcra: warm request ~400ms (concurrent with lint => ~0 added wall-clock), background build ~22s. Supervisor 55 tests green (incl. real blast-radius + signature-impact end-to-end over stdio); direct tsc + format:check + frozen-lockfile clean, zero lockfile churn. Docs (SUPERVISOR-GRAPH-INTEGRATION.md new S9 + ADR 003 Q5) updated.
<!-- SECTION:FINAL_SUMMARY:END -->
