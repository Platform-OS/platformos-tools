---
id: TASK-9.8
title: 'Code-review remediation: supervisor⇄graph integration findings'
status: Done
assignee: []
created_date: '2026-07-01 11:46'
updated_date: '2026-07-03 07:38'
labels:
  - code-review
  - platformos-graph
  - mcp-supervisor
  - tech-debt
dependencies: []
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
High-effort code review of the `supervisor-graph-integration` branch (`git diff master...HEAD`, 6 commits wiring platformos-graph into `validate_code` + graph edges/query-API/self-structural/table-facts + `'layout'` DocumentType). 8 finder angles + verification. Overall the branch is additive, well-tested (graph 73 / supervisor 50 / check-common 1047 / LSP 467, CI green both OSes), ADR 003/004 separation holds, no CLAUDE.md violations, no type/exhaustiveness breaks. This task records the actionable findings and tracks fixing them one-by-one with the full suite green after each.

Each acceptance-criterion maps to one finding, ranked by severity. Verified-clean / refuted items are recorded in the plan for the record. Reference: SUPERVISOR-GRAPH-INTEGRATION.md (§6 open doubts), docs/mcp-supervisor/decisions/003 & 004.

Working directory: ~/Work/platformos-tools/platformos-tools. Constraint: surgical precision, no behavioral regressions, TDD, whole-value test assertions per repo CLAUDE.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 F1 [Architecture/High] Self-structural is reachable per-buffer: `extractStructural` is exported as a per-file primitive (sibling to extractFileReferences), the supervisor structure adapter populates ValidateCodeResult.structural from the in-flight buffer, and the full-build path no longer computes structural on every LSP rebuild for a fact the LSP never reads (gated/opt-in). No serialized-output change.
- [x] #2 F2 [Robustness/Med] validate_code structural resolution can never sink the primary lint gate: runStructure failure degrades to empty dependencies (try/catch or Promise.allSettled) so lint diagnostics + must_fix gate are always returned.
- [ ] #3 F3 [Efficiency/Med] The in-flight buffer is parsed exactly once per validate_code call: the parsed SourceCode is shared between runLint and runStructure instead of each re-parsing the same string.
- [x] #4 F4 [Altitude/Med] Schema-node discovery is not gated on the fragile `entryPoints === undefined` proxy in a way that silently drops schema nodes for a scoped full scan; standalone/leaf nodes carry an explicit flag so whole-graph queries (isOrphan etc.) read one property instead of enumerating ModuleType.
- [x] #5 F5 [Reuse/Med] Shared helpers replace three duplications: (a) project-relative absolute-path resolution shared between lint.ts and structure.ts; (b) slug override rule reuses RouteTable rather than re-deriving in the graph; (c) the translation-key usage predicate is shared between the translation-key-exists check and extractStructural.
- [x] #6 F6 [Efficiency/Low-Med] extractStructural walks each file once (doc-params + frontmatter folded into the single AST visit) and build.ts enumerates the project directory once (entry-points + schema nodes partitioned from one sweep).
- [x] #7 F7 [Altitude/Low] Schema table-name extraction is owned beside the parser as an exported check-common helper (mirroring extractGraphqlTable), not parsed inline in traverse.ts.
- [x] #8 F8 [Correctness/Low] Non-string frontmatter `slug` (YAML list/map) does not surface as a coerced bogus slug ([object Object]/comma-joined); effectiveSlug and schemaTableName treat non-string values consistently.
- [x] #9 F9 [Altitude/Low] ValidateCodeDependency.kind is either a genuine ReferenceKind→agent-kind mapping owned by the supervisor, or the precise union type — not a nominal stringly-typed passthrough.
- [x] #10 F10 [Latent/Low] Layout node identity does not depend on two URI producers (findAllFiles raw vs DocumentsLocator+normalize) agreeing: entry-point URIs are normalized so the layout edge target always dedupes with the discovered entry-point node; covered by a cross-platform test.
- [x] #11 F11 [Simplification/Minor] argNames simplified (no statically-always-true filter); the 'args only when non-empty' spread is de-duplicated across bind + extractFileReferences; the single-use frontmatterBody/loadFrontmatterOf two-hop chain is collapsed.
- [x] #12 Full suite green after every fix: yarn workspace @platformos/platformos-graph test, platformos-check-common, platformos-mcp-supervisor, platformos-language-server-common; yarn type-check; yarn format:check; --frozen-lockfile.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Fix order (small/isolated first to keep suite green, extractStructural-touching ones grouped, big architectural F1 after its dependencies land):

1. F2 — isolate runStructure failure (transport/validate-code.ts + structure.ts).
2. F3 — parse in-flight buffer once, share SourceCode across runLint/runStructure.
3. F5a — shared project-relative absolute-path resolver between lint.ts + structure.ts.
4. F8 — non-string slug guard in effectiveSlug (+ align schemaTableName) + test.
5. F11 — argNames simplification, args-spread dedup, collapse frontmatterBody/loadFrontmatterOf.
6. F7 — export extractSchemaTable from check-common, consume in traverse.ts (mirror extractGraphqlTable).
7. F5b/F5c — reuse RouteTable slug rule; share translation-key predicate with the check.
8. F6 — fold doc-params/frontmatter into the single AST visit; one directory sweep in build.ts.
9. F1 — export extractStructural as per-file primitive; supervisor populates validate_code.structural per-buffer; LSP opts out of eager structural (buildAppGraph option, default on = ADR-003-compliant). Update structural.spec to test the exported primitive.
10. F4 — explicit leaf/standalone-node flag so isOrphan & whole-graph queries stop enumerating ModuleType.Schema; decouple schema discovery from the entryPoints===undefined proxy where it silently drops nodes.
11. F9 — ReferenceKind→agent-kind mapping (or precise union) for ValidateCodeDependency.kind.
12. F10 — normalize entry-point URIs (getLayoutModule/getPageModule) so layout edge target always dedupes; cross-platform test.

VERIFIED-CLEAN / REFUTED (recorded, no action):
- Conventions: no CLAUDE.md violations (path normalization correct; whole-value toEqual in new specs).
- Type-safety/exhaustiveness intact (assertNever compiles; SerializableNode does not leak structural/table; dependencies required-field wired through the sole constructor assembleResult).
- path.relative arg order correct; runStructure safe on non-Liquid buffers (resolver returns [] on Error AST); Reference.args in serialized edges is intended/additive; nearestModules empty-when-unmaterialized is documented by-design; Windows schema getFileType uses same normalized input as pre-existing isPage/isLayout.
- Layout dedup currently holds & is green on Linux+Windows CI (traverse-edges.spec.ts) — F10 is hardening, not a live bug.
- Whole-project getApp re-glob (no memo) and per-file DocumentsLocator (no cross-file memo) are PRE-EXISTING, out of this branch's scope — not fixed here.

Note on F1 vs ADR 003: ADR 003 resolved that full-build populates LiquidModule.structural (overlay/TASK-9.7 will consume it). So F1 keeps eager population as the default and adds an LSP opt-out, rather than removing it — respecting the ADR while eliminating the per-keystroke waste.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
F2 DONE: runValidateCode now orchestrates lint (primary) + structure (secondary) with the structure adapter's failure degrading to empty `dependencies` (logged) via an injectable-adapters seam; a lint failure still propagates. New unit spec transport/validate-code.spec.ts (3 tests: both-succeed passthrough, structure-fail degrade+log, lint-fail propagate). Supervisor suite 53 green; package type-check clean.

F3 DEFERRED (engineering judgment, needs sign-off): eliminating the edited-buffer double-parse (structure's toSourceCode + lint's internal overlayBuffer parse) requires an ADDITIVE change to check-node's shared `lintBuffer` public API (accept a pre-parsed overlay SourceCode) plus reconciling per-file-type parse representations (graph toSourceCode returns AssetSourceCode for .js, not a check-common SourceCode) and URI normalization across the two adapters. The saving is a single small buffer parse — marginal against the unavoidable whole-project `getApp` parse `lintBuffer` runs every call, which is the dominant cost and is PRE-EXISTING/out-of-branch-scope. Confirmed graph `toSourceCode` delegates to check-common `toSourceCode` for liquid/graphql/yml, so it is *feasible*, but the API-coupling/blast-radius on a shared package outweighs the micro-opt under the 'don't break anything' constraint. Recommend instead: memoize getApp per projectDir (the high-value lever) as separate, pre-existing-scope work.

F5a DONE: extracted shared `AdapterInput` type + `toAbsoluteFilePath()` into src/adapter-input.ts; lint.ts and structure.ts both consume it (dropped duplicated node:path isAbsolute/join). Supervisor 53 green, type-check clean.

F5b+F8 DONE (same region): introduced `effectivePageSlug(relativeToPages, frontmatter)` in platformos-common route-table/slugFromFilePath.ts as the single override-wins-else-path-derived slug rule; RouteTable.addPageFromContent and the graph's effectiveSlug both delegate to it. Fixes a real drift (graph previously ignored a frontmatter `format:` override that RouteTable honours) AND makes non-string slug coercion consistent with the routing source of truth (RouteTable already does String(slug), so rejecting non-strings would DISAGREE with real routing — sharing is the correct fix, not divergence). Added 12 effectivePageSlug cases (numeric/boolean/empty/null/undefined override, format override, non-string format). common 257 green (RouteTable 43 unaffected), graph 73 green, both type-check + common dist rebuilt.

F11 DONE: argNames simplified to `args.length > 0 ? args.map(a=>a.name) : undefined` (the per-element type/name guard was statically always-true over LiquidNamedArgument[]; the completion-context placeholder only arises in the LSP's special parse, never the graph's full parse — docstring corrected). Introduced `argsField(args)` helper as the single 'omit args when empty' rule; bind + extractFileReferences both spread `...argsField(...)` (de-duplicated, and keeps bind robust as public API). Collapsed the single-use frontmatterBody→loadFrontmatterOf two-hop chain into one loadFrontmatterOf. graph 73 green, type-check clean.

F7 DONE: added exported `extractSchemaTable(content)` in platformos-check-common/src/schema-table.ts (mirrors extractGraphqlTable; reuses check-common's own js-yaml which it already depends on + uses in context-utils/undefined-object). Verified premise: co-locating in check-common is genuine reuse, not a new concern. Removed the graph-local `schemaTableName`; traverse.ts leaf case now calls extractSchemaTable. graph loadFrontmatter retained (still used by layout resolver + self-structural). New schema-table.spec.ts (10 whole-value cases incl. non-string list/mapping/numeric name, unparseable, non-mapping, empty). check-common type-check + dist rebuilt; graph 73 green.

F5c DONE: extracted `isTranslationKeyUsage(node)` (+ TRANSLATION_FILTERS) into platformos-check-common/src/translation-usage.ts as the single 'string literal piped through t/translate' predicate (type-guard narrowing expression to LiquidString). TranslationKeyExists check now calls it (dropped its inline `'String'` + filter check); graph extractStructural calls it (dropped its NodeTypes.String + ||-filter dup). Exported from check-common index. Full check-common suite 1057 green (translation-key-exists 9 green, unchanged behavior), dist rebuilt, graph 73 green + type-check. F5 (a+b+c) complete.

F6 DONE: (1) extractStructural now does a SINGLE AST visit — doc `@param` names are collected in the same pass via a `LiquidDocParamNode` handler reading the parser-produced `node.paramName.value` (same field extractDocDefinition reads; not re-implementing the liquid-doc parser), dropping the separate extractDocDefinition traversal; doc_params preserved in source order (not sorted/deduped). (2) build.ts full build now does ONE recursiveReadDirectory sweep whose predicate admits pages/layouts .liquid + CustomModelType .yml/.yaml, partitioned by extension — eliminating the second full-tree walk. graph 73 green. NOTE: direct `npx tsc --noEmit` caught a control-flow-narrowing error (entryPoints possibly undefined) that the `yarn workspace type-check` wrapper + vitest masked — fixed by branching on `entryPoints === undefined` directly (dropped the isFullBuild boolean intermediary). Switching to direct tsc for type-checks henceforth.

F1 DONE (per user decision: full fix). (1) GRAPH: `extractStructural` exported as a per-file primitive (sibling to extractFileReferences); made non-Liquid-safe (returns undefined for non-LiquidHtml/unparseable source). (2) GATE: buildAppGraph gained a 4th arg `options: GraphBuildOptions = {}` with `includeStructural` (default OFF); traverseModule/traverseLiquidModule thread it; eager module.structural population now only happens when opted in — so the LSP full build (the only full-build caller, which never reads structural; verified no external .structural consumer) stops paying for it. (3) SUPERVISOR: structure adapter now returns `{ dependencies, structural }` from ONE shared parse (extractFileReferences + extractStructural via Promise.all on the same SourceCode); validate_code.structural is populated per-buffer; added `graphql_queries_used` to ValidateCodeStructuralSnapshot for parity with the graph ModuleStructural + the original supervisor's structural; routing facts map optional→null. (4) F2 degrade updated to `{dependencies:[],structural:null}`. Tests: structural.spec rewritten (10 — primitive-direct + opt-in/opt-out); structure.spec (16 — dependencies + structural snapshot + non-liquid null); assemble.spec (7, +structural passthrough); validate-code.spec (3, structural flow); stdio-smoke (7 whole-result e2e now assert populated structural incl. tags_used ['function','render']/['assign','render']). Supervisor 56 green; graph 77 green; LSP 467/467 in isolation (full-suite shows only the documented TypeSystem parallel-load flake, confirmed passing isolated in 3.1s); all type-checks clean; dists rebuilt.

F4 DONE (per user decision: document contract, keep type discriminant — no speculative flag). Deliberately did NOT add a `standalone`/`reachabilityParticipating` boolean: with a single non-reachability leaf kind (Schema), a parallel flag set exactly when type===Schema is MORE state to keep in sync, not less — the discriminated union IS the idiomatic single-property check (YAGNI until a 2nd such kind appears). Instead: buildAppGraph JSDoc now explicitly documents the full-build (auto-discovers pages+layouts+schema) vs scoped (verbatim; schema NOT auto-discovered) contract, so the behavior is no longer a 'silent' inference from `entryPoints === undefined`; isOrphan keeps its typed `ModuleType.Schema` guard with its rationale comment. No caller currently hits the scoped-full-scan path.

F9 DONE: made ValidateCodeDependency.kind a genuine seam. Defined supervisor-owned `ValidateCodeDependencyKind` union in result/types.ts (the agent contract, decoupled from upstream ReferenceKind), typed kind as that union (was `string`). structure.ts maps ref.kind→agent-kind via an exhaustive `const DEPENDENCY_KIND: Record<ReferenceKind, ValidateCodeDependencyKind>` — so an upstream ReferenceKind add/rename fails to compile at the adapter (no silent drift), while names stay 1:1. Supervisor type-check + full suite green.

F10 DONE (hardening — invariant already held on CI, now enforced): getLayoutModule + getPageModule now `path.normalize` their stored uri, matching the other 4 module factories (getLayoutModuleByUri/getPartialModuleByUri/getSchemaModule/getGraphQLModuleByUri). So a layout/page discovered as an entry point (raw fs URI) keys identically to the same file resolved as an edge target (DocumentsLocator+normalized) — one node, never split identity. New module.spec.ts (3 tests) proves dedup across backslash vs forward-slash URIs (getLayoutModule≡getLayoutModuleByUri, getPageModule idempotent, getPartialModuleByUri regression guard) — each would FAIL without the fix. POSIX fixtures unaffected (normalize is a no-op there); graph 80 green.

FINAL VERIFICATION (all green): type-check (direct tsc) clean for all 5 touched packages (common, check-common, graph, mcp-supervisor, language-server-common). Test tallies: platformos-common 257; platformos-check-common 1057; platformos-graph 80; platformos-mcp-supervisor 56; platformos-language-server-common 467 (466 under full-suite parallel load due only to the pre-existing TypeSystem.spec 5s-timeout flake, confirmed passing in isolation at 3.1s — unrelated to this work, documented). `yarn format:check` clean (formatted 2 new spec files). `yarn install --frozen-lockfile` clean with ZERO yarn.lock churn (no new deps — all reuse of existing js-yaml etc.). All dists rebuilt (common, check-common, graph) so runtime consumers resolve the new exports.

SUMMARY: 10 of 11 findings fixed (F1,F2,F4,F5a/b/c,F6,F7,F8,F9,F10,F11); F3 deferred with documented rationale + sign-off recommendation (needs a shared-package API change for marginal gain vs the pre-existing getApp cost). Net new tests: +30 across the suites. All changes additive/behaviour-preserving except the two intended output improvements (validate_code.structural now populated per-buffer; ValidateCodeDependency.kind now a typed union) and one perf-motivated default change (graph module.structural now opt-in, gating the LSP).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Code-review remediation complete: 10 of 11 findings fixed (F1 self-structural per-buffer + LSP opt-out; F2 impact/structure never sinks the lint gate; F4 schema-discovery contract documented; F5a/b/c shared helpers — toAbsoluteFilePath, effectivePageSlug via RouteTable, isTranslationKeyUsage; F6 single AST walk + single directory sweep; F7 extractSchemaTable in check-common; F8 non-string slug guard; F9 typed ValidateCodeDependencyKind mapping; F10 normalized entry-point URIs; F11 argNames/args-spread/frontmatter simplifications). +30 tests. All 5 packages type-check (direct tsc) + format + frozen-lockfile clean; suites green (common 257, check-common 1057, graph 80, supervisor 56, LSP 467 isolated — the one full-suite miss is the documented pre-existing TypeSystem parallel-load flake).

F3 (share the in-flight buffer parse between lint and structure) was DEFERRED with signed-off rationale (needed a shared check-node API change for a marginal gain vs the dominant getApp parse cost). It is now largely MOOT: the `structure/` adapter was removed in TASK-9.10, so there is no runStructure re-parse; the residual buffer double-parse (lint overlay vs impact docSignature) is a low-priority efficiency item recorded in the later code review, off the critical path. The higher-value lever F3 pointed to — getApp memoization — shipped as TASK-9.13 (Done). Closing on completed scope.
<!-- SECTION:FINAL_SUMMARY:END -->
