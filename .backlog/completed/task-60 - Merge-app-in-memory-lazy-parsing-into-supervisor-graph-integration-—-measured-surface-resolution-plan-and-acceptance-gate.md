---
id: TASK-60
title: >-
  Merge app-in-memory-lazy-parsing into supervisor-graph-integration — measured
  surface, resolution plan and acceptance gate
status: Done
assignee: []
created_date: '2026-08-03 21:50'
updated_date: '2026-08-11 20:40'
labels:
  - integration
  - merge
  - architecture
  - performance
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/merge/
  - .changeset/lazy-app-model.md
  - .changeset/check-takes-an-app-model.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why this task exists

`app-in-memory-lazy-parsing` (B) may change again. Everything below was MEASURED rather
than estimated, and re-deriving it costs ~20 minutes of builds plus two 4.5-minute
whole-project runs. Recorded so a second attempt starts from the plan, not from scratch.

Integration branch: `integration/supervisor-graph-integration-app-in-memory-lazy-parsing`,
created from `supervisor-graph-integration` @ `02404ce`.

## The topology (measured, `git merge-base`)

`master` @ `917e77c` **is** the merge base of both branches, and has not moved.

| | value |
|---|---|
| A = `supervisor-graph-integration` | 64 commits off master, 319 files changed |
| B = `app-in-memory-lazy-parsing` | **1 commit** (`788f9af`), 185 files, +14774/−3070 |
| files touched by both | 45 |
| **actually conflicting** (`git merge-tree`) | **20** — 3 backlog `.md`, 17 code/spec |
| auto-merged but both-touched | 25 ← no markers, highest risk |

Because master is the merge base, whichever branch lands first FAST-FORWARDS and the
second one carries the entire three-way merge. Ordering does not change the work.

## Direction: B into A, one merge, on the integration branch

- B is one commit, A is 64. One merge = one resolution pass; rebasing A onto B would be
  up to 64 resolutions and would destroy A's task-by-task provenance.
- B being squashed means no bisecting WITHIN B if resolution goes wrong. Its
  `.changeset/lazy-app-model.md` (279 lines) plus 19 backlog task files are the
  resolution spec — read them, do not resolve from the diff alone.
- Do NOT cherry-pick the `App` model out of B. Its 185 files are entangled through the
  root-anchored-classification decision, and half the correctness fixes depend on it.

## The 17 code conflicts, grouped with the decision for each

**Same problem solved twice — take B, delete A's version (3)**
- `platformos-check-node/src/index.ts` — A's `AppCache`/`getAppAndConfig`/`lintBuffers`
  vs B's shared reconciled `App`. B subsumes it AND covers the LSP, which `AppCache`
  never did. Keeping both would leave two caches with two invalidation rules.
- `platformos-check-common/src/ignore.ts` — B compiles each pattern once per config
  (measured 5-6x on the filter; `getApp` 207-267 -> 45-69 ms).
- `platformos-check-common/src/context-utils.ts` — B adds the lazy `getRouteTable`
  provider; A's translation helpers must be re-applied on top.

**platformos-common ownership — take B (2)**
- `documents-locator/DocumentsLocator.ts`, `translation-provider/TranslationProvider.ts`.
  B rewrote both around the O(1) name index.

**Graph — take B (3)**
- `graph/build.ts`, `graph/module.ts`, `cli.spec.ts`. B shares `AppFile` instances with
  the checks so each file parses once, not once each.

**Supervisor — real design work, A's features on B's foundation (6)**
- `transport/validate-code.ts`, `lint/lint.ts`, `result/assemble.ts`, `result/types.ts`
  and the two specs. Keep A's graph cache, `impact`, cost model, response budget and
  batch; adapt them to B's `lintBuffer` -> `{ status, offenses }`.
- B's `status` is strictly BETTER for the write gate and must reach
  `must_fix_before_write`, not only `next_step`: it distinguishes "checked and clean"
  from "never looked at". A cannot make that distinction at this seam — verified live,
  a relative path returns `misplaced-source` on B and an empty `Offense[]` on A.

**One check + trivia (3)**
- `checks/missing-content-for-layout/index.ts` — A's TASK-44 layout removal vs B's
  `context.fileType`. Hand-merge.
- `check-common/src/index.ts` (export list), `src/path.spec.ts` (add/add).

## The 25 auto-merged files are NOT done

Three are guaranteed wrong despite merging cleanly:

- `checks/index.ts` — A registers new checks; B DELETES `OrphanedPartial` and
  `json-syntax-error`. A textual merge can import a deleted module or silently retain
  `OrphanedPartial`.
- `configs/all.yml`, `configs/recommended.yml` — GENERATED. Run
  `node packages/platformos-check-node/scripts/generate-factory-configs.js`; never
  hand-merge.
- The check specs (`UnknownTag`, `InvalidTagSyntax`, `deprecated-tag`,
  `invalid-hash-assign-target`, `liquid-html-syntax-error/index`) — B introduced the rule
  that fixture paths must be REAL platformOS paths because `getApp` now THROWS on a path
  it drops. A's newer describe blocks predate that rule, so a clean textual merge can be
  green and semantically vacuous.

Also check `src/types.ts` (B removes `getReferences`, `singleFileOnly`) and
`to-source-code.ts` (A's `toLazySourceCode` vs B's App — dead code that still compiles).

## Acceptance gate: whole-project offense identity

Seam: `check(root, configPath?) => Offense[]`, exported with the SAME signature by
check-node on both branches. Almost nothing else is common — `getApp` returns
`App` vs `AppModel`, `lintBuffer` differs, the supervisor seams differ entirely.

Captured with `scratchpad/capture-offenses.mjs` (copied to
`/home/ecgtheow/Work/supervisor-tests/merge/`), which records
`check\turi\tstartIndex\tendIndex\tmessage` sorted, PLUS a file manifest and per-check
totals. Positions are included because a check reporting the right thing in the wrong
place is a regression a message-only diff hides. The manifest is separate because B
legitimately changes the SET of files in the app — without it, a file dropping out of
coverage looks identical to a file that stopped offending.

The merged tree must equal the UNION of both baselines. Only these deltas are allowed,
and each must be named before it is seen:
1. `{% layout %}` reported / the 8 registered tags accepted (A: TASK-44, TASK-56)
2. `OrphanedPartial` and the JSON checks absent (B) — note A independently documented
   the JSON checks as UNREACHABLE in `blocking.ts`, so this is agreement, not a loss
3. the `.csv.liquid` `MissingPartial` false positive disappearing (B's name index)
4. app-membership changes from root anchoring: GAINS `app/views/pages/vendor/**`
   (one real project loses 137 app files without it), LOSES `seed/post_import/**`

## B's central value has NO automated guard — add one

If a resolution discards A's correctness work, ~3167 sabotage-verified tests fail. If a
resolution discards B's laziness, NOTHING fails: no test fails when eager parsing
returns. That asymmetry is how the merge silently loses B's whole point, most likely by
resolving `check-node/src/index.ts` toward A's `AppCache`.

B already ships the instrument — `check-node/src/test/test-helpers.ts` wraps the injected
parser and reports which files it parsed. Turn B's measured numbers into assertions
(warm `lintBuffer` on a route-free page: 405 -> 8 `stat`s; parses the visited file plus
its render targets, not the project).

## Performance expectations after the merge

Measured on arabbank (2769 .liquid) at the `lintBuffer` seam, 3 alternating paired passes:

| shape | A (+AppCache) | B | after merge |
|---|---|---|---|
| cold first call | 1047 ms | 494 ms | expect B's |
| real page warm | 378 ms | 96 ms | expect B's |
| 128 KiB, 0% offending | 4352 ms | 3523 ms | expect B's |
| 128 KiB, 100% offending | 3113 ms | 4472 ms | **must reach A's** |
| peak RSS | 1084 MB | 910 MB | expect B's |

B pays ~+0.22 ms per offense where A pays -0.29 (an offending line short-circuits on A).
Fix that BEFORE measuring the merge or it reads as merge damage. It is NOT inherent to
lazy parsing — B WINS at 0% offending — so look in the offence-to-diagnostic path, and
instrument it rather than A/B it (A's `measure-lint-cost.mjs` header records three failed
wall-clock attribution attempts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The merge is resolved on the integration branch with every one of the 17 conflicts decided deliberately, and the decision for each recorded with its motivation
- [x] #2 All 25 auto-merged-but-both-touched files are reviewed rather than trusted, and the three known-wrong ones (checks/index.ts, all.yml, recommended.yml) are corrected or regenerated
- [ ] #3 Whole-project offense capture on the merged tree equals the UNION of both baselines, with every delta explained and matched against the four allowed classes
- [ ] #4 The app FILE MANIFEST is diffed separately, so an app-membership change is never mistaken for an offense disappearing
- [x] #5 B's laziness is pinned by an automated assertion using check-node's parse-tracking helper, so a future resolution that reintroduces eager parsing fails a test
- [x] #6 Full build, yarn type-check and format:check clean; every package suite green (run per-package, the combined run gets killed in this environment)
- [x] #7 LSP verified not regressed: its own suite green, and the check() call passes an AppModel rather than an array so cross-file checks still see the whole project
- [x] #8 Supervisor verified: A's graph cache, impact, cost model, response budget and batch all survive on B's lintBuffer contract, and B's status reaches must_fix_before_write
- [ ] #9 Perf re-measured with the same instrument: B's win retained at 0% offending and A's number reached at 100% offending, or the gap explained and accepted deliberately
- [x] #10 The merge's own NEW seams carry tests written for THIS merge, not inherited ones: the re-implemented batch seam, the widened FileStat.ctimeMs, hasIgnorePatterns, and every cross-branch reconciliation where the two sides' specs disagreed — each sabotage-verified
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## origin/B MOVED — re-based the analysis on `0bcc870`

My first pass measured `788f9af`. `origin/app-in-memory-lazy-parsing` is now `0bcc870` — an
AMEND of the same commit (identical subject, same parent `917e77c`), so it is NOT a
fast-forward. Delta: 35 files, +1365/−324, adding tasks 58/58.1-58.4 and 59/59.1-59.2.
Old commit preserved as tag `backup/B-788f9af-measured` so the first baseline stays
attributable.

**The conflict surface is UNCHANGED**: the same 20 files (17 code). origin/B's extra work
introduces zero new conflicts, so the resolution plan above still holds.

### Tasks 58/59 are not duplicates of A — they are overlap in A's most load-bearing checks

- **58** `UnknownProperty` shape resolution through partial boundaries and GraphQL
  fragments/`include`/`skip`. A has `UnknownProperty` (312 offenses on arabbank) and
  `property-shape.ts`, but only PERFORMANCE tasks there (12.1, 12.12). So 58 is new
  capability, not duplication.
- **58.1** `hash_assign` must not fabricate a shape for an unseen variable — adjacent to
  A's `InvalidHashAssignTarget` return-type work, different check. Read side by side.
- **59** doc drift reported on the partial, not the call site. It EDITS
  `partial-call-arguments/index.ts`, `missing-render-partial-arguments/index.ts`,
  `unrecognized-render-partial-arguments/index.ts` and `extract-undefined-variables.ts`.
  `PartialCallArguments` is **7922 of A's 9540 offenses (83%)**, and all three of those
  checks are named individually in A's `blocking.ts`. **A's blocking rationale must be
  re-verified after the merge, not assumed.** Note 59 records that the obvious fix —
  believe the source over the doc at the call site — was implemented and REVERTED, for the
  same reason A rejects message-string workarounds.

## THE GATE ALREADY PAID FOR ITSELF — 1019 false positives, one root cause

Whole-project capture on arabbank (2769 .liquid), same seam both sides:

| | offenses | files |
|---|---|---|
| A @ `02404ce` | 9540 | 1514 |
| B @ `788f9af` | 9970 | 1500 |

14 of 22 checks are byte-identical. The outliers:

| check | A | B | delta |
|---|---|---|---|
| `MissingPartial` | 28 | 372 | **+344** |
| `TranslationKeyExists` | 234 | 909 | **+675** |
| `LiquidHTMLSyntaxError` | 124 | 162 | +38 |
| `InvalidHashAssignTarget` | 0 | 13 | +13 |
| `PartialCallArguments` | 7922 | 7911 | −11 |
| `FilterWithoutEffect` | 619 | — | A-only check (TASK-47) |
| `DuplicateYAMLKey` | 10 | — | A-only check (TASK-51) |

### Root cause of BOTH large deltas: B lacks A's duplicate-key-tolerant YAML load

A has `platformos-common/src/yaml-load-options.ts` exporting
`PLATFORM_YAML_LOAD_OPTIONS` (`{ json: true }`) and uses it everywhere it loads platform
YAML. B calls bare `yaml.load(content)`. js-yaml THROWS on a duplicated mapping key, and
both call sites swallow it in a `catch` that answers "no config" / "no translations".

MEASURED on arabbank:
- `app/config.yml` — `plain yaml.load THREW: duplicated mapping key (123:1)`;
  with `{json:true}` it returns
  `theme_search_paths = ["theme/{{ context.constants.THEME }}", "theme/arabiemart", "theme/simple"]`.
- 6 of 66 translation `.yml` files throw the same way (`ar/layout.yml`,
  `en/activities.yml`, `en/admin.yml`, `en/layout.yml`, `en/orders.yml`,
  `en/static_pages.yml`) — exactly the files that appear in A's offense manifest and not
  in B's.

Consequences on B:
- `loadSearchPaths` returns `null`, so `{% theme_render_rc 'home/index' %}` cannot resolve
  `app/views/partials/theme/arabiemart/home/index.liquid` → **344 false `MissingPartial`**.
  `MissingPartial` is in `BLOCKING_CHECKS`, so those are **false BLOCKS**.
- 6 translation files silently absent → **675 false `TranslationKeyExists`**.

Verified with the locator directly: with A's paths it resolves to
`theme/arabiemart/home/index.liquid` **both with and without an `App`** — so the name index
is NOT implicated. Confirmed still present at `0bcc870`.

A's own comment predicted B's failure mode verbatim: *"A duplicated key must not cost the
project its search paths — see PLATFORM_YAML_LOAD_OPTIONS. The `catch` below would
otherwise answer 'no config', silently sending every lookup down the default paths."*

### Resolution for the two conflicts, and it is not "take B"

This REVISES the plan above. For `DocumentsLocator.ts` and `TranslationProvider.ts`:

- take **B's structure**, including its better path derivation — B replaced A's hardcoded
  `'app/config.yml'` with `getFixedFilePath(PlatformOSFileType.InstanceConfig)`, which
  keeps the location owned by the package that defines it;
- take **A's `PLATFORM_YAML_LOAD_OPTIONS`** at every load site. `yaml-load-options.ts` is
  A-only and comes across without conflict.

Best of both, and required for correctness rather than preference.

### Still open (do not merge before deciding)

- `LiquidHTMLSyntaxError` +38 — plausibly B linting `.scss.liquid` (its changeset says so),
  unverified.
- `InvalidHashAssignTarget` 0 → 13 — likely a B IMPROVEMENT: B's `context.app` is never
  undefined, so the check can infer types it previously had to stay silent about. Verify
  the 13 are true positives before accepting.
- `PartialCallArguments` −11 — unexplained; small but it is the 83% check.
- Add a regression test for the YAML options so this cannot be lost again: load a fixture
  with a duplicated key and assert the search paths / translations still resolve.

## SOURCE CHANGED AGAIN: merge `origin/master`, not the B branch

B was SQUASH-merged to master as `cf80cfa` (so B is not an ancestor of master), plus two
dependabot bumps. Master's version of B is **111 code files ahead** of the B branch
`0bcc870` — tasks 58/59 landed, adding checks that do not exist on the branch at all:
`missing-doc-param`, `required-doc-param-with-default`, `implicit-include-arguments`,
`duplicate-function-arguments`, `duplicate-render-partial-arguments`,
`call-site-tag-wording`.

So the B-branch baseline is void. Merge source is `origin/master` @ `cf80cfa`.

(Method note: my first attempt to measure that delta used a `packages/*/src` pathspec and
returned 0 files — git pathspec globs do not match across `/` that way. The same mistake
hit a `git grep` earlier in this work. Use `-- packages` and filter with grep.)

### Conflict surface grew 20 -> 60 (23 code, ~37 backlog .md)

Six code conflicts are new relative to merging the B branch:
`partial-call-arguments/index.ts` (was auto-merging — and it is the biggest check),
`yaml-syntax-error/index.ts` + spec, `yaml/parse.ts`, `graph/src/cli.ts`,
`language-server-common/src/TypeSystem.ts`.

Merge base is still `917e77c`; direction, ordering and all reasoning above are unchanged.

### Conflict triage by side-weight (lines changed vs base, A vs MASTER)

TAKE MASTER, RE-APPLY A'S SMALL DELTA:
- `TypeSystem.ts` A 11+6 vs **M 262+563** — master's task-58 shape work. A's delta is only
  the TASK-44 layout removal.
- `check-common/index.ts` A 21+6 vs M 140+40; `context-utils.ts` A 16+2 vs M 74+90;
  `partial-call-arguments/index.ts` A 14+5 vs M 30+95; `DocumentsLocator.ts` A 52+14 vs M 84+55.

TAKE A, INTEGRATE MASTER'S SMALLER DELTA:
- `yaml/parse.ts` A 168+20 vs M 69+2 (A's TASK-50/51 work);
  `yaml-syntax-error/index.ts` A 99 vs M 44; `graph/build.ts` A 51+11 vs M 15+9;
  `result/types.ts` A 195+60 vs M 0+4; `result/assemble.ts` A 102+19 vs M 2+11;
  `transport/validate-code.ts` A 234+50 vs M 90+11.

BOTH LARGE — REAL DESIGN WORK:
- `check-node/src/index.ts` A 332+34 vs M 190+140; `ignore.ts` A 60+9 vs M 79+13;
  `graph/module.ts` A 102+45 vs M 73+29; `path.spec.ts` add/add.
- `lint/lint.ts` and `lint.spec.ts`: A DELETED both (0+61, 0+79) in favour of
  `lint-batch.ts`; master modified them. Delete/modify conflicts.

### check-node public API: what must be decided, with blast radius measured

A-only exports and their only consumers (the supervisor, as expected of a leaf):
- `lintBuffers` + `BufferToLint`/`LintBuffersParams`/`LintBuffersResult` — used by
  `lint/lint-batch.ts`, `validate/validate-buffers.ts`. **A's BATCH feature depends on
  this and master has no batch seam. It must be RE-IMPLEMENTED on master's shared `App`,
  returning master's `{ status, offenses }` per file.** Not a merge — real work.
- `AppCache` — used by supervisor `context.ts`, `graph-cache/graph-cache.ts`,
  `lint/lint-batch.ts`, `blocking-emission.spec.ts`, `measure-lint-cost.mjs`. DELETE:
  master's shared reconciled `App` + `resetSharedApp` subsumes it and also covers the LSP.
- `fileFingerprint` — used by `graph-cache/graph-cache.ts` + `graph-cache-store.ts`.
  Master moved identity into `check-node/src/fingerprints.ts` (task-46.9) and its
  definition is `mtimeMs:size`, whereas A's was `mtimeMs:ctimeMs:size`. **Decision point:**
  A's is stricter (ctime catches a metadata-only or mtime-preserving replacement), and A's
  graph cache deliberately shares one definition with its App cache. Resolve when editing
  `fingerprints.ts`; do not silently weaken the graph cache's staleness test.
- `getAppFilesPathPattern`, `overlayFileSystem` — **zero consumers outside check-node** on
  A, and master removed the former deliberately. Drop both.

## MERGE IN PROGRESS (uncommitted, `--no-commit`). Layer 1 of 6: platformos-common RESOLVED

Master baseline: **9175 offenses / 1465 files** on arabbank (A: 9540/1514). Artifacts in
`/home/ecgtheow/Work/supervisor-tests/merge/` (`base-A.*`, `base-M.*`).

**Correction to the earlier note: master already fixed the translation half.** Its
`TranslationProvider.loadYaml` uses `{ json: true }`, and its own comment records the same
discovery independently ("five of the 39 `en/*.yml` files had a duplicate ... 561 offenses
that were not there"). `TranslationKeyExists` 233 vs A's 234. The defect is ONLY
`DocumentsLocator.loadSearchPaths`, still bare `yaml.load` — hence `MissingPartial` 372 vs
28, i.e. **344 false blocks still live on master**.

Master's gains that A lacks are large: `UnknownProperty` 312 -> 21 (task-58 shape
resolution), `PartialCallArguments` 7922 -> 6765 via the doc-drift rework, plus new
`ImplicitIncludeArguments` (1229), `MatchingTranslations` (61), `YAMLSyntaxError` (11).

**New open item:** master reports 11 `YAMLSyntaxError`, A reports 0, and that check is in
`BLOCKING_CHECKS`. A's TASK-50/51 work suppresses them, so they are likely 11 more false
blocks on master — verify when resolving `yaml/parse.ts` + `yaml-syntax-error/index.ts`.

## Layer 2 (platformos-graph): `build.ts` RESOLVED, 3 files still conflicted

### `graph/build.ts` — RESOLVED (master's anchored walk + A's Table-node discovery)

A discovered pages+layouts AND schema/custom-model-type YAML in one sweep via
`recursiveReadDirectory` with unanchored `getFileType(uri)` and `.yml`/`.yaml` tests.
Master walks `walkAppSourceFiles` (anchored) with `getFileType(uri, rootUri)` but is
Liquid-only — no Table nodes.

Merged: master's anchored `walkAppSourceFiles` + root-anchored `getFileType`, still ONE
sweep, partitioned by `sourceCodeTypeOf` instead of by extension. Liquid -> entryPoints,
non-Liquid -> `schemaUris`. Three A-side defects fixed by taking master's mechanism:
the name-blacklist walk (dropped `app/views/pages/vendor/**`, admitted
`tmp/app/.../x.liquid`), the unanchored classifier (`seed/post_import/app/migrations/x`
classified as Migration), and the spelled `.yaml` test (**`.yaml` is not a platformOS
extension**, so it promised coverage the platform never had). That last one is also why
`build.ts` no longer trips `directory-knowledge`'s source-extension guard.

### `PlatformOSFileType.CustomModelType` -> `Table` (master's rename), 3 sites

Master renamed it, matching the platform docs (`schema/` is canonical;
`custom_model_types/` and `model_schemas/` are legacy spellings). Renamed in
`graph/src/types.ts` (comment), `graph/traverse-edges.spec.ts` (describe name) and
**`supervisor/src/validate/file-type-coverage.spec.ts` (real code — would not compile)**.
That supervisor spec enumerates file types exhaustively, so when the supervisor layer is
reached it must also gain rows for master's NEW types: `ActivityStreamsHandler`,
`ActivityStreamsGroupingHandler`, `InstanceConfig`, `UserSchema`.

### `graph/module.ts` — NOT YET RESOLVED. Merge spec, because neither side can be taken whole

Each side has exports the other lacks:

| A-only | master-only |
|---|---|
| `isSupportedAssetFile` (gate at the CALL SITE, `traverse.ts:177`) | `getAssetModule`, `getPartialModule` (name-based variants) |
| `getSchemaModule` — **needed by `build.ts`** (task-9.19 Table nodes) | in-factory gating: `getAssetModuleByUri` returns `\| undefined` after `isSupportedAsset(uri)` |
| `getLayoutModuleByUri`, `internModule` | anchored `switch (getFileType(uri, appGraph.rootUri))` |

Decisions to apply:
1. Take master's **anchored `switch (getFileType(uri, rootUri))`** in `getModule` — replaces
   A's four unanchored `isLayout(uri)`/`isPartial(uri)` predicates, which master deleted
   package-wide.
2. Both sides independently fixed the SAME partial-keying bug (a path rebuilt from
   `basename` lost subdirectories and module prefixes) and both landed on
   `getPartialModuleByUri`. Keep it; the two comments say the same thing, keep master's.
3. Take master's **in-factory asset gate** (`| undefined` after `isSupportedAsset`): a gate
   inside the factory cannot be forgotten by a new caller, A's call-site-only gate can.
4. But KEEP a single exported predicate for `traverse.ts:177`'s early return, which avoids
   resolving a URI for a value that is not an asset at all. **One name, not two** — use
   master's `isSupportedAsset` and repoint `traverse.ts` off `isSupportedAssetFile`. Two
   names for one predicate is how they drift apart.
5. Re-add A's `getSchemaModule` (build.ts imports it), `getLayoutModuleByUri` and
   `internModule` on top of master's file.

### Also still conflicted in this layer
`graph/src/cli.ts` (3 hunks, both small) and `graph/src/cli.spec.ts` (3 hunks).
`graph/edge-sources.ts` is auto-merged but trips `directory-knowledge`'s directory-name
guard — it spells platformOS directory names and must derive them from
`FILE_TYPE_DIRS`/`APP_SOURCE_SUBTREES` instead.

## Layer 2 (platformos-graph) — RESOLVED (verification deferred: needs check-common built)

### `graph/module.ts` — resolved per the recorded spec, with two corrections found by reading both specs

The five decisions held, but reading the two sides' SPECS (not just their sources) changed two of them:

1. **Master's anchored switch — taken.** `getFileType(uri, appGraph.rootUri)` replaces A's `switch (true) { case isLayout(uri): … }`. Confirmed `FILE_TYPE_DIRS[Partial] = ['views/partials', 'lib']`, so master's anchored classifier still satisfies A's `module.spec.ts` cases for `app/lib/can/x.liquid` and `app/lib/queries/v2/projects/find.liquid`. Master's switch also adds an `Asset` case A never had.
2. **CORRECTION to the earlier plan — A's `path.normalize` in `getLayoutModule`/`getPageModule` is REQUIRED, not optional.** Master's versions store `uri: layoutUri` / `uri: pageUri` raw. A's `module.spec.ts` ("module factories: normalized node identity", code-review F10) asserts a backslash-spelled entry-point layout and a forward-slash edge-target layout are the SAME cached object. Master's raw version fails that. Master got away with it only because master has no layout edge at all (no `getLayoutModuleByUri`). Kept A's normalization + rationale comment in both factories.
3. **Master's in-factory asset gate — taken.** `getAssetModuleByUri` returns `AssetModule | undefined` and gates on the predicate itself, so a new caller cannot forget it.
4. **ONE predicate, master's name.** A's exported `isSupportedAssetFile(name)` and master's private `isSupportedAsset(nameOrUri)` were the same function under two names. Kept `isSupportedAsset`, now EXPORTED (A's `traverse.ts` needs it), dropped `isSupportedAssetFile`. Master's name is the accurate one: the factories pass a URI, the traversal passes a reference name. Both layers gate, and the docblock says so, so neither depends on the other remembering.
5. **A's `getSchemaModule`, `getLayoutModuleByUri`, `internModule` re-added** on top of master's file (live consumers: `build.ts:88`, `traverse.ts:284`, `deserialize.ts:41`). Also re-added A's `tables: []` to `getGraphQLModuleByUri` (`GraphQLModule.tables` is non-optional in the merged `types.ts`).

### `getPartialModule` (master-only, name-based) — DELETED. `getAssetModule` (master-only, name-based) — KEPT.

Measured first: after the merge EVERY edge kind in `traverse.ts` resolves through `DocumentsLocator.locateOrDefault`, so BOTH name-based factories have zero production consumers. They are not symmetrical, though:

- `getPartialModule` had exactly one consumer on master — `serialize.spec.ts` — and A rewrote that spec to `getPartialModuleByUri` deliberately, because keying a partial by name IS the bug both branches independently fixed. Partials have two search roots (`views/partials`, `lib`) and two extensions, so "first candidate" is a guess, and that guess split a `lib/` partial into two nodes. Zero consumers, zero specs, and the file's own `getModule` comment warns against the technique it implements → removed rather than left as a loaded footgun. Not in `src/index.ts`, so not a public-API change.
- `getAssetModule` is spec'd by master's `asset-resolution.spec.ts`, which pins `modules/admin/app.css` → `app/modules/admin/public/assets/app.css` and asserts agreement with `DocumentsLocator.locate`. No other graph test covers module-asset placement. Kept, spec untouched.
- **Follow-up, deliberately NOT decided inside this merge:** `getAssetModule` has no production consumer either. Whether the graph should keep a sync name→asset resolver is a real question, but deleting an exported, tested API is a separate reviewable change, not merge fallout.

### `traverse.ts`
- `isSupportedAssetFile` → `isSupportedAsset` (one call site + the import).
- The asset visitor now binds `const target = getAssetModuleByUri(...)` and returns early on `undefined` rather than assuming non-null. No non-null assertion: the early gate makes it unreachable in practice, but the type is honoured instead of argued with.

### `cli.ts` — master's version taken WHOLE, after verifying that is safe
`git checkout --theirs` discards a side's non-conflicting changes in that file too, so taking a side wholesale is only safe once the whole-file A-vs-master diff is known. Diffed first: the only differences are the three conflict hunks plus one auto-merged line.
- `path.toUri` → `uriFromPath` (2 sites + import): CLAUDE.md's path rule — `URI.file(p).toString()` percent-encodes the drive colon.
- `path.join(uri, entry.name)` → `path.childUri(uri, entry.name)`: master-only improvement, URI-safe child construction.

### `cli.spec.ts` — genuine two-way merge; taking master's file would have DELETED coverage for A's feature
A's version asserts a `kind: 'layout'` edge (`app/views/pages/index.liquid` → `app/views/layouts/application.liquid`) — the frontmatter→layout edge A added. Master has no such edge and no such assertion. Started from A's file and applied master's four `uriFromPath` conversions onto it. **This is the case that justifies the whole-file diff discipline above:** the layout assertion sits in a hunk git auto-merged, so it would have vanished silently.

### `graph/edge-sources.ts` — rewritten onto master's primitives; the `directory-knowledge` guard was right

A's file held `const SOURCE_ROOTS = ['app', 'marketplace_builder', 'modules']` and walked them with `recursiveReadDirectory`. That is a second encoding of `APP_SOURCE_SUBTREES`, and a less precise one: master's list is `[...APP_ROOTS, 'modules/*/public', 'modules/*/private']` — it also knows the access-level split, and that `app/modules/*` needs no entry of its own because it is under `app`.

- `enumerateEdgeSources` now calls `walkAppSourceFiles(fs, rootUri, ([uri]) => isEdgeSource(uri, rootUri))`. The file names NO directory at all, and the TASK-9.15 Phase-3A scoping win survives (a bundled `react-app/` is still never walked) with no second root list to drift.
- `isEdgeSource` is now ANCHORED — `isEdgeSource(uri, rootUri)` via `getFileType` — replacing the unanchored `isLayout(uri) || isPage(uri) || isPartial(uri)`. Blast radius measured before changing the signature: `enumerateEdgeSources` (signature unchanged) is the only export the supervisor's GraphCache consumes; `isEdgeSource` is exported publicly but used only in-package.
- The spec's docblock prose was updated too — it still described "the scoped roots".

### Two more copies of the predicate, surfaced by the type-checker
`deserialize.spec.ts:51` and `incremental.spec.ts:55` each re-implemented `isEdgeSource` inline as `isLayout(u) || isPage(u) || isPartial(u)`. Repointed both at the canonical exported predicate — the same "never re-encode the classification" rule the module's own docblock states. Four copies of that expression existed in the package before this; now one.

### New spec: the anchoring guard, WITH a control
`edge-sources.spec.ts` gained `'does not admit a platformOS-looking path outside the app subtrees'` — `tmp/app/views/partials/scratch.liquid`, `seed/post_import/app/views/pages/fixture.liquid`, `node_modules/pkg/app/lib/helper.liquid` must all be non-edge-sources. Paired with a CONTROL in the same test: the same three basenames placed at the real root ARE enumerated, so the silence is caused by the anchoring rather than by the fixture or the walk. (CLAUDE.md: a suppression wide enough to hide a real defect passes every "nothing was reported" assertion ever written.)

### Layer 2 verification state
`tsc --noEmit` on platformos-graph is down to 3 errors, all of them stale `platformos-check-common/dist` (`childUri`, `extractGraphqlTables`) — layer 3, not layer 2. `platformos-common` builds clean. The graph suite cannot run until check-common is resolved and built; that is the gate on calling layer 2 verified.

## Layer 3 (platformos-check-common) — IN PROGRESS

Conflicted: `index.ts` (DONE), `context-utils.ts`, `ignore.ts`, `yaml/parse.ts`, `checks/missing-content-for-layout/index.ts`, `checks/partial-call-arguments/index.ts`, `checks/yaml-syntax-error/index.ts` + `.spec.ts` (both add/add), `path.spec.ts` (add/add).

### `index.ts` — RESOLVED
- `filesToVisit` takes master's shape: `(app: AppModel, only?) => SourceAppFile[]` built from `app.sourceCodes()`; A's returned an `App`. Master's is required by the code below the hunk and is the lazy-App architecture. Kept master's load-bearing comment that the function carries no claim about ASTs — that is what keeps the parse lazy — plus A's parenthetical that an unknown URI yields no offenses.
- `CheckOptions.only` docblock: master's check names, A's fuller dependency list. **A's list named `OrphanedPartial`, which does not exist post-merge** (removed in B for cost — confirmed, no `checks/orphaned-partial` directory). Master's `MissingPage` is correct. A's `getRouteTable`/`fileExists` additions are real and kept.

### `context-utils.ts` — RESOLVED (master's resolution logic, A's shared constant)

Master's default-translations read is better on two counts and both are correctness, not style:
- it looks the buffer up BY URI (`openBufferSource(app, defaultLocaleUri)`) where A scanned the app for any file whose URI ends `/en.yml` — A's would match a module's or a nested `en.yml`;
- the `??` keeps the `stat` off the buffer path entirely. Asking the disk whether the file exists is pointless once an open buffer has answered, and that is the lazy-App discipline.

But master hard-coded `load(yamlContent, { json: true })` inline. Swapped for `PLATFORM_YAML_LOAD_OPTIONS`.

**Also removed a FOURTH copy of that knowledge.** The auto-merged part of this file carried a local `const PLATFORM_YAML_OPTIONS = { json: true }` with its own 8-line docblock. Deleted in favour of the shared constant — `yaml-load-options.ts` exists precisely so "is a duplicated key fatal" is answered once, and a local copy in the file that reads translations is the copy most likely to drift.

A's `getDefaultTranslationsFromBuffer` helper is gone with it (master's targeted lookup subsumes it).

### `ignore.ts` — master's version taken WHOLE (whole-file diff verified first: the entire divergence is inside the conflict)

Both sides fixed the same measured hot spot — `isIgnored` re-ran three regex replaces and constructed a fresh `Minimatch` on EVERY call, 140-232 ms of a 207-267 ms `getApp`. A cached compiled matchers in a bounded LRU keyed by pattern string plus a `WeakMap<Config>` of transformed patterns; master caches the compiled matcher ARRAY in one `WeakMap<Config>` keyed by check.

Master's is simpler and strictly sufficient — a config compiles its patterns once ever either way, and A's cross-config pattern sharing saves one `Minimatch` construction per (config, pattern), not per call. Master's also brings two things A lacks:
- `uriFromPathOrUri` on the SUBJECT, so a `file://` URI, a percent-encoded URI and a raw filesystem path get ONE answer. `file:///c%3A/project/x.liquid` and `c:/project/x.liquid` are otherwise different strings, and "which files are ignored" must not depend on who asked — CLAUDE.md's path rule.
- `hasIgnorePatterns`, so check-node can skip PRODUCING paths to ask about (4 ms per `getApp` on a 3139-file project, spent to be told there is nothing to match).

A's `createBoundedCache` survives with two other consumers (`extract-undefined-variables`, `graphql-schema`), so nothing was orphaned.

### `checks/missing-content-for-layout/index.ts` — master's code, corrected prose
Master's `context.fileType()` (the run's anchored classification) replaces A's `getFileType(context.file.uri)` — the package's own CLAUDE.md forbids the latter: "never call `getFileType` with a bare URI, which cannot be anchored at the run's root". But master's DOCBLOCK still described the code it replaced ("via `getFileType` (re-exported as `isLayout`)"), and A's prose was the accurate one. Merged: master's mechanism, prose naming `context.fileType()` and the canonical `PlatformOSFileType.Layout` shared with DocumentsLocator's `'layout'` and the graph's layout edge.

### `checks/partial-call-arguments/index.ts` — master's rework taken, A's perf fix re-applied AT ITS NEW HOME
A's entire delta vs base was one thing: memoize the documented-globals filtering pass, because `objects()` is memoized upstream but the SCAN over every documented object re-ran at every call site, and a partial rendered from dozens of places paid it dozens of times.

Master's task-58/59 rework moved that logic out to `liquid-doc/target-params.ts` and made it strictly better: scope now depends on the TARGET's file type (`isObjectInScope(object, targetFileType)`) rather than one "globally accessible" flag — `data` and `response` belong to an api_call, so a partial reading one is reading an argument nobody passed.

The two are not in tension: master's per-target filter STILL runs at every call site. So master's file was taken whole and A's memoization re-applied in `target-params.ts` as `inScopeNames`, keyed weakly on the docset's objects ARRAY (which is stable for a docset's life, so a re-downloaded docset makes a new entry and the old is collected — nothing to invalidate, nothing to bound, the same discipline master's `isIgnored` uses) and then by target file type. Returns a FRESH array per call, which A's comment is the reason for: callers extend it, and it is also a cache KEY inside `extractUndefinedVariables`, so a shared array pushed onto would corrupt both the next caller's scope and that key. `PartialCallArguments` is the highest-volume check in the suite, so this is the one place the memo matters most.

### `checks/yaml-syntax-error/` (add/add) — THE 11 FALSE BLOCKS ARE CONFIRMED, and this is the most consequential resolution so far

Both branches wrote this check independently. The implementations differ on ONE thing that matters enormously: **master's reports a duplicated mapping key as a `YAMLSyntaxError`.**

`YAMLSyntaxError` is severity ERROR and IS in `BLOCKING_CHECKS` (`blocking.ts:84`), where its listed justification is *"does not parse, and the converter rejects the changeset"*. But the converter ACCEPTS a duplicated key — measured with `pos-cli deploy --dry-run` at the top level, inside a property, and in a translation file — and the platform resolves it LAST-WINS (measured separately on 2026-08-02 via `liquid_exec`). So master's version blocks writes the platform would take, through a check whose blocking rationale explicitly claims the opposite. **That is the source of the master-vs-A `YAMLSyntaxError` 11 vs 0 delta recorded above: 11 more false blocks, now explained.**

A's design is the measured one and it wins: this check answers "does this file PARSE?" and nothing else, and `DuplicateYAMLKey` reports the discarded value as a non-blocking WARNING. `blocking-emission.spec.ts:491` already asserts that treatment.

Resolution:
- **A's implementation**, which is also better mechanically: it reads the failure off `file.ast` instead of re-parsing the source (no second parse), and it additionally covers CONVERSION errors — a document that parsed and then could not be mapped to the shared JSON node model — which master's version misses entirely.
- **Master's docs `url` and description sentence** folded in.
- **Master's `---` terminator insight is already subsumed** by A's parse layer: `toYAMLNode` filters `MULTIPLE_DOCS`, on stronger and broader grounds than master's `parseAllDocuments` (multi-document YAML is valid YAML; the parser is objecting to OUR calling convention, not the author's file). Master measured the same cost independently — 88 offenses on one real project, 83 model schemas plus the instance config plus three translation files.
- `yamlProblems`/`toProblem`/`keyAt` in `yaml/parse.ts` therefore had no remaining caller (verified repo-wide) and were removed, with the now-unused `parseAllDocuments`/`YAMLError` imports.

**Spec merged, not replaced.** A's spec (every admitted YAML file type + real positions) plus master's compatible cases ported: clean file, message without the line/column suffix, unterminated string, trailing terminator not reported, and every complaint reported rather than just the first. Master's three duplicate-key cases are deliberately NOT ported — replaced by an explicit SILENCE assertion (this check does not report a duplicated key, including in a file that also ends with a terminator) **paired with a CONTROL** that `DuplicateYAMLKey` does report it, with its exact message. Without the control, deleting the check entirely would pass the silence half.

**One finding of master's is genuinely lost and needs its own task:** `'Only the first YAML document in a file is read; everything after this is ignored.'` That is silent data loss and A's own `MULTIPLE_DOCS` comment concedes the same cost. It must NOT ride in `YAMLSyntaxError` (ERROR + blocking, for a file the converter accepts), so it belongs in a non-blocking check of its own — to be filed separately, not smuggled into this merge.

### `path.spec.ts` (add/add) — UNION, because the two specs cover disjoint functions
The merged `path.ts` exports BOTH A's `toUri` and master's `childUri`. A's spec pins `toUri` (the drive-colon case reproduces on POSIX, so the guard would have caught the Windows break before it shipped); master's pins `childUri === join` for every name shape a directory listing can produce, and that `normalize`/`relative`/`join` are the common package's `normalizeUri`/`relativeUriPath`/`joinUri`. No overlapping cases — concatenated with one reconciled import block.

### Dependency lockfile: `yarn install` is a REQUIRED merge step
`JSONValidator.ts` failed to type-check with `Property 'getMessageString' does not exist on type 'typeof Diagnostic'`. Not a resolution error — master bumped `vscode-json-languageservice` (yarn.lock differs by 4662 lines, auto-merged) while `node_modules` was still at A's versions. After `yarn install`, `platformos-check-common` type-checks CLEAN.

## Layer 3 verification: 1540 passing, 41 failing — categorized, and the failures are BITING

`yarn workspace @platformos/platformos-check-common test`: 96 files passed, 8 failed. `tsc --noEmit` clean, `build` clean.

| n | cause | files |
|---|---|---|
| **37** | `Error: Fixture paths are not in any platformOS directory, so the app does not …` | `filter-arity` (16), `invalid-hash-assign-target` (15), `filter-return-type-sweep` (4), `deprecated-tag` (1), `InvalidHashAssignTargetSyntax` (1) |
| 1 | `duplicate-keys.spec.ts`: expected `['DuplicateYAMLKey', …3]`, got `['MatchingTranslations', …2]` | `yaml-syntax-error/duplicate-keys.spec.ts` |
| 1 | `expected 2 to deeply equal +0` | `ignore-memoization.spec.ts` |
| 1 | `TypeError: Cannot read properties of undefined (reading 'slice')` | `fixed-path-files.spec.ts` |
| 1 | offense `uri` is `file:///app/views/partials/file.liquid`, spec expects `file:///file.liquid` | `InvalidHashAssignTargetSyntax.spec.ts` |

**The 37 are exactly the class this task predicted** — "B introduced the rule that fixture paths must be REAL platformOS paths because `getApp` now THROWS on a path it drops" — and they are FAILING LOUDLY rather than passing vacuously, which is master's guard working as designed. Fixing them means giving each fixture a real platformOS path: adapting to a deliberate architectural decision, NOT weakening an assertion. Do them file by file, and where a test's subject depends on the file's TYPE (layout / page / translation), name the path deliberately instead of taking the default.

The other four each need individual judgement and must NOT be swept into the mechanical pass:
- `ignore-memoization.spec.ts` is A's spec measuring A's caching MECHANISM (counted `Minimatch` constructions), which master's `ignore.ts` replaced. Rewrite against master's mechanism — it must still bite if per-call compilation returns, because that was 140-232 ms of a 207-267 ms `getApp`.
- `duplicate-keys.spec.ts` — the check SET changed (master added `MatchingTranslations`). This is the spec that ENFORCES the duplicate-key silence, so it is load-bearing for the false-block finding above. Re-derive the expected set; do not relax the assertion.
- `fixed-path-files.spec.ts` `undefined.slice` is a candidate REAL defect, not a fixture problem. Investigate before touching anything else.

## NEXT (a fresh context starts here)
1. The 37 fixture-path failures file by file, then the four judgement calls above.
2. Re-run the platformos-graph suite — layer 2 is RESOLVED but UNVERIFIED and was gated on exactly this build.
3. Layers 4-6 still fully conflicted: `check-node/src/index.ts` (6 hunks — `AppCache` vs shared `App`, plus re-implementing A's BATCH seam on master's `App`; the biggest single piece of work left), `language-server-common/src/TypeSystem.ts` (1), supervisor `result/assemble.spec.ts` (5), `transport/validate-code.ts` (3), `result/types.ts` (2), `result/assemble.ts` (1), and the `lint/lint.ts` + `lint.spec.ts` delete/modify pair.
4. Then AC#2 (the 25 auto-merged files, including regenerating `all.yml`/`recommended.yml`) and AC#3-#9.

Still uncommitted throughout — `git merge --no-commit --no-ff origin/master` remains in progress.

## Layer 3 GREEN, layer 2 VERIFIED. 1578 + 123 + 574 passing.

`platformos-check-common`: **103 files, 1578 tests, 0 failures**, `tsc --noEmit` clean, build clean.
`platformos-graph`: **13 files, 123 tests, 0 failures** — layer 2 is now verified, not just resolved.
`platformos-common`: 574 passing, 2 failing, both the `directory-knowledge` guards naming files in LATER layers (see the bottom of this note).

### The four judgement calls — all four were real defects, not fixture noise

**1. `fixed-path-files.spec.ts` — found a VACUOUS test of master's, by writing the control for it.**
Master's docblock credited `YAMLSyntaxError` with "a duplicated key in `app/config.yml` is the same bug it is in a translation file". Post-merge that finding belongs to `DuplicateYAMLKey`, which I verified has NO type guard either — so it is the SECOND deliberate type-agnostic exception, and the enumeration now lists it. Added a test that MEASURES the exception (a duplicated key in `app/config.yml` draws exactly `DuplicateYAMLKey`) instead of only asserting the intent.

That new test exposed the vacuity: the sibling `'attract no offenses from any check'` filtered on `['file:/app/config.yml', 'file:/app/user.yml']`, but `check()` reports `file:///app/config.yml`. **The filter matched nothing, so its `toEqual([])` passed without looking at anything.** Corrected the spelling; sabotage-verified (a duplicated key in the config fixture now fails it, and did not before).

**2. `ignore-memoization.spec.ts` — DELETED, after porting its three unique claims into master's `ignore.spec.ts`.**
The failing assertion was A's claim that matchers must be keyed on PATTERN STRINGS rather than config identity ("a fresh Config is built on every lint run"). Measured instead of argued: master's `lintBuffer` does call `loadConfig` per call and `loadConfig` does NOT memoize, so a fresh `Config` really does arrive each call. But the cost that mattered was never per-call — `check()` asks `isIgnored` per (file, check) pair, THOUSANDS of times per call, all against that one Config object, and master's `WeakMap<Config>` kills exactly that. What A's keying adds on top is one `Minimatch` construction per pattern per call (13 on the measured project) — nothing. **A's "must" was overstated; master's mechanism is sufficient**, and master's own tests are stricter than A's besides (exact `Minimatch.mock.calls` arrays vs A's `toBeLessThanOrEqual(2)`, which CLAUDE.md forbids).

Ported into `ignore.spec.ts` the three claims master did not make: an absolute pattern is not reused across two ROOTS (trivially true under config-keying, but it is the exact trap a future pattern-keyed cache falls into, since an absolute pattern's compiled form embeds the root); a changed ignore list is followed in BOTH directions; and nothing is compiled when there are no patterns. Also added the first coverage for **`hasIgnorePatterns`, a new master export that had no test and no consumer** — including the per-check/check-less asymmetry, since a caller that skips work must ask the same question it will act on. Both new guards sabotage-verified (dropping root anchoring fails 2 tests; making `hasIgnorePatterns` ignore the per-check set fails 1).

**3. `duplicate-keys.spec.ts` — A's silence test for `.yaml` was asserting silence over an EMPTY APP.**
A looped its duplicate-key silence assertions over `['yml', 'yaml']`, on the premise that "`isSupportedSourceFile` accepts `.yml` and `.yaml` … the second spelling was an untested path through the same gate". Checked the authority rather than the comment: `REFERENCE_EXTENSIONS` excludes `.yaml` **deliberately and with backend citations** — every YAML model anchors `\.yml\z` (`translation.rb:7`, `custom_model_type.rb:12`, `instance_profile_type.rb:7`, `transactable_type.rb:7`, `activity_streams/handler.rb:7`), so `app/translations/en.yaml` is never deployed. There is no second path. **The `.yaml` half was a suppression test that could not fail**, and it passed for exactly as long as `getApp` tolerated a path it dropped. Removed, with the false premise replaced by the fact and a pointer to `path-utils.spec.ts`, which already owns and tests the exclusion (no duplicated coverage).

**4. `InvalidHashAssignTargetSyntax.spec.ts`** — expected `uri: 'file:///file.liquid'`; master's `runLiquidCheck` default is `app/views/partials/file.liquid`. Updated the expectation; it still pins the whole offense exactly.

### The 37 mechanical fixture-path failures — fixed, and they were NOT all the same thing

- `filter-arity/index.spec.ts`: its `MockApp` was keyed `'file.liquid'` → `'app/views/partials/file.liquid'`.
- `invalid-hash-assign-target/index.spec.ts` and `filter-return-type-sweep.spec.ts`: passed `'file.liquid'` EXPLICITLY as `runLiquidCheck`'s path argument, overriding a default that was already correct. The same spec's other 16 fixtures already used `app/views/partials/file.liquid`, so the file was internally inconsistent — now homogeneous. The path is NAMED rather than defaulted because `InvalidHashAssignTarget` reaches `isObjectInScope(object, fileType)`: its subject does depend on the file's type.
- `deprecated-tag/index.spec.ts`: `runLiquidCheck` used the default path but `highlightedOffenses` was handed a MockApp keyed `'file.liquid'` — the offense and the app disagreed about which file it was.

### Layer 2: `recursiveReadDirectory` is gone from check-common, and the fix is NOT one substitution

Master removed it once the anchored `walkAppSourceFiles` superseded it. Four specs used it, wanting two different things:

- `deserialize.spec.ts` / `incremental.spec.ts` only wanted "the edge-source files" as build entry points → now call `enumerateEdgeSources(fs, rootUri)`, the canonical primitive. That also removes the last two re-derivations of the predicate.
- `edge-sources.spec.ts` needed something categorically different: an INDEPENDENT whole-tree walk to compare the scoped walk against. **Using `walkAppSourceFiles` there would compare the mechanism against itself, and the equivalence assertion would hold no matter how wrong `APP_SOURCE_SUBTREES` became.** The control is now a local brute-force `everyFileUnder` recursion in the spec, with a comment saying why it must not be shared.
- `supervisor/graph-cache-store.spec.ts` still imports it — deferred to the supervisor layer.

### Sabotage revealed a real GAP in my own new fixtures

The first sabotage of the equivalence guard (dropping `marketplace_builder` from `APP_ROOTS`) failed 3 OTHER tests but NOT the equivalence one — `FILE_TYPE_DIRS` derives from `APP_ROOTS`, so that edit moves the classifier and the walk TOGETHER and the two sides still agree. A walk-only sabotage was needed, and building one exposed that `EDGE_SOURCES` had no top-level module **private** source at all, though the classifier admits `modules/<name>/private/**`.

Added `modules/shop/private/lib/secret.liquid`. Restricting the walk's `ACCESS_LEVELS` to `['public']` — which the classifier does not follow — now fails the equivalence test, so that invariant is proven load-bearing rather than assumed.

### Remaining `platformos-common` failures: 3 offenders in the two `directory-knowledge` guards

- directory-name guard: `supervisor/src/transport/validate-code.ts` — still CONFLICTED, so its text holds both sides' spellings. Expect it to clear in the supervisor layer.
- source-extension guard: `check-node/src/index.ts` — still CONFLICTED (layer 4) — and **`check-common/src/to-source-code.ts`, auto-merged and needing a real decision.**

Down from 4 offenders to 3.

### `to-source-code.ts` / `toLazySourceCode` is a LAYER-4 decision, deliberately not made now

It is A's answer to the same problem master solved with the lazy `App`, and A's own docblock says so: *"WHO SHOULD USE IT. Callers that build an `App` for CONTEXT and visit a subset — i.e. check-node's project loader."* Master's `App` is lazy by construction with parsers injected, so that caller may no longer exist.

Measured its consumers: the ONLY production import is `check-node/src/index.ts` (`toLazySourceCode as commonToLazySourceCode`), still conflicted, plus two specs (`to-source-code-lazy.spec.ts`, `check-node/lazy-project-parse.spec.ts`). It also spells `.liquid`/`.graphql`/`.yml`/**`.yaml`** — and `.yaml` is not a platformOS extension, which is why the extension guard fires on it.

Its fate follows the check-node resolution: if check-node goes to master's shared `App`, `toLazySourceCode` and both specs are dead and the guard clears with them. **Do not delete it before that decision** — and `lazy-project-parse.spec.ts` is one of the few instruments available for AC#5, so read it before removing anything.

### NEXT, revised
1. Layer 4 — `check-node/src/index.ts` (6 hunks): `AppCache` vs master's shared reconciled `App`; re-implement A's BATCH seam on master's `App`; settle `fileFingerprint` (A's `mtimeMs:ctimeMs:size` vs master's `mtimeMs:size`); decide `toLazySourceCode`; wire `hasIgnorePatterns` (now tested, still no consumer).
2. Layer 5 — `language-server-common/src/TypeSystem.ts` (1 hunk: master's task-58 shape work + A's TASK-44 layout delta).
3. Layer 6 — supervisor: `assemble.spec.ts` (5), `validate-code.ts` (3), `types.ts` (2), `assemble.ts` (1), the `lint.ts`+`lint.spec.ts` delete/modify pair, `graph-cache-store.spec.ts`, `file-type-coverage.spec.ts` rows for master's new types.
4. Then AC#2 and AC#3-#9.

## Layer 4 (platformos-check-node) RESOLVED and GREEN. 22 files, 164 tests, 0 failures.

Layers 1-4 together: **2146 passing**, one failure left in the whole set (see the end).

### All six hunks: master's architecture, with ONE feature rebuilt on top

Hunks 1, 2, 3, 5, 6 are one decision — master's shared reconciled `App`, `getSharedApp`/`resetSharedApp`, `getSharedRouteTable`, `uriFromPath`, `getApp(config): AppModel`. A's `AppCache`, `overlayFileSystem`, `AppSourceCode` and the cache-aware `getApp` all go with it.

**Hunk 3 deserves its own note, because A's version carried a hard-won finding.** A built a `docDefinitions` Map keyed by `pathUtils.relative(file.uri, rootUri)`, with a long comment about how `node:path.relative` or `URI.file().toString()` produce a key the consumer's `relative(locatedFile, rootUri)` never matches — and that a missing key means `getDocDefinition` returns undefined, so a partial's `{% doc %}` params are invisible and `MissingRenderPartialArguments`, a BLOCKING check, never fires. Master replaced it with `makeGetDocDefinition(app, NodeFileSystem, nodeParsers)`, which is better on three counts and **dissolves A's bug structurally rather than matching spellings**: it resolves the CALLER's relative path forward (`app.get(joinUri(app.rootUri, relativePath))`) so there is no pre-built key to disagree with; it is lazy (no map over every file per call); and it handles a target the app does not contain at all (`docDefinitionOutsideApp`), which A's map could not — and whose absence makes `PartialCallArguments` infer params from source and report an OPTIONAL param as a missing required argument.

### Hunk 4: A's BATCH seam re-implemented on master's `App`, with `lintBuffer` DELEGATING to it

Master's `lintBuffer` is architecturally better than A's (per-file `status`, and `app.setSource`/`invalidate`/`remove` instead of copying the app array). A's `lintBuffers` is a feature master lacks. Rather than keep two overlay paths, `lintBuffers` is now the primary seam and `lintBuffer` is a one-line delegation — so there is ONE overlay/restore path, and **master's own `lint-buffer.spec.ts` (9 tests) passes unchanged against it**, which is the oracle proving the public contract is preserved.

Design decisions inside it:
- **One vocabulary, not two.** A's result was `{ offenses: Map, ignored: Set }`; the batch now returns `Map<UriString, LintBufferResult>` — master's OWN result type, per buffer. Master's `status` already expresses `excluded-by-config` plus four cases A could not distinguish, so a caller never has to learn a second way of being told "not checked".
- **Restore is collected as we go** (`restore.push(...)` inside the loop, drained in `finally`), so a throw mid-batch still reverts what was applied. Registered BEFORE the `file.type === undefined` check, because an asset was still overlaid and still has to be reverted.
- **Ignored buffers are decided before the app is walked**, exactly as the single-buffer seam does, so an all-ignored batch never pays for a walk.
- **Results are returned in REQUEST order.** The first implementation leaked its internal two-pass partitioning into the map's iteration order (ignored entries first). That surfaced as a test failure, and the right fix was the implementation, not the expectation.

### Sabotage found my own decorative test

Sabotage 1 (revert only the FIRST overlay) initially passed — my "reverts every overlay" test overlaid a page named `ghost` and then asserted on `render 'ghost'`, which resolves to a PARTIAL, so the surviving overlay was invisible to it. Rewritten to overlay two phantom PARTIALS and assert both are gone, which is order-independent. Now: partial-restore fails it, and visiting only the last buffer fails two others.

### `fingerprintOf`: A's ctime protection RESTORED onto master's structure — and my first attempt broke master's race test

Earlier in this task I deferred A's `mtimeMs:ctimeMs:size` fingerprint as an unmeasured hypothetical, because `FileStat` has no ctime and widening it looked like scope creep. **That deferral was wrong, and A's own spec is why:** `file-fingerprint.spec.ts` MEASURES the hole — five bytes written over five bytes with the mtime pinned back via `utimes`, asserting the fingerprint still changes. `mtime` is settable from userland; `ctime` is not. Master's `mtime:size` is blind to exactly that edit, and BOTH process-level caches (shared `App`, shared `RouteTable`) use this to decide whether what they remember is still true — for an agent editing files out of band, which is the case they exist for.

First implementation read `node:fs.stat` directly to get ctime without touching `FileStat`. **That broke `shared-app.spec.ts`'s race test** (`does not wipe a buffer overlaid while its revalidation stat is in flight`), which spies on `NodeFileSystem.stat` to land an overlay inside the stat window. The test was right; I had moved the seam it hooks. "Fixing the test" would have silently unhooked a guard on a real race.

Final resolution, serving both:
- `FileStat` gains an **OPTIONAL** `ctimeMs?: number`, documented as "cannot say, never unchanged" — so no filesystem implementation is forced to grow a field it has no concept of (the browser one included).
- `NodeFileSystem.stat` answers it from the stat it already makes: same syscall, one more field.
- `fingerprintOf` goes back through `NodeFileSystem.stat` (the spy seam survives) and degrades to `mtime:size` when ctime is absent rather than pretending.

Master's `UNKNOWN` sentinel is KEPT and is better than A's `undefined`: A's `getApp` read `undefined` as "vanished between glob and stat" and DROPPED the file; master re-reads. Fail-safe in the direction a write gate needs.

**Ported A's measurement into a new `fingerprints.spec.ts`** — master's `fingerprintOf` had NO test, the same gap `hasIgnorePatterns` had. Keeps A's `awaitFilesystemTick` helper and its reasoning (on ext4 two back-to-back rewrites share a `ctimeMs` ~69% of the time, so a test rewriting microseconds later asserts what no stat-based fingerprint can deliver — it was written off as a known flake for that reason), plus the deliberate SHAPE assertion pinning the remaining bound: two changes inside one filesystem tick at equal byte length are indistinguishable, and closing that means hashing content per call. Sabotage-verified twice — dropping ctime from the fingerprint fails 2 tests; making `NodeFileSystem` stop answering `ctimeMs` fails the same 2.

### A's specs deleted, each only after checking what it uniquely covered

- `lazy-project-parse.spec.ts` — **master's `lazy-app.spec.ts` strictly subsumes it**: `getApp` reads and parses NOTHING (A's App read every file), `lintBuffer` parses only the visited file plus resolved render targets, parse errors both visited and unvisited, lazy `{% doc %}` resolution, unsaved-buffer cross-referencing, equivalence with a whole-project run. **This closes the AC#5 worry: the guard on B's laziness already exists on master and is stronger than A's.**
- `app-cache.spec.ts`, `overlay-file-system.ts` + spec — with the mechanisms they tested.
- `file-fingerprint.spec.ts` — superseded by `fingerprints.spec.ts`, the same measurement against the surviving function.

### `to-source-code.ts` / `toLazySourceCode` — the layer-3 open item is now DECIDED and removed

Taking master's check-node index removed its only production consumer, so `toLazySourceCode` and `to-source-code-lazy.spec.ts` are gone, with a now-orphaned `memo` import. A's lazy SourceCode and master's lazy `App` were two answers to one problem; the `App` is the one the whole toolchain shares.

### Guard status: the source-extension guard is now CLEAN

`check-node/src/index.ts` and `to-source-code.ts` both cleared. The single remaining failure across layers 1-4 is the directory-NAME guard, naming only `supervisor/src/transport/validate-code.ts`, which still carries conflict markers. It should clear when layer 6 is resolved; if it does not, that file genuinely spells platformOS directory names and must derive them instead.

### NOTE FOR THE REMAINING LAYERS: this merge needs tests of its OWN (new AC #10)

Inherited specs from either side cannot cover a seam that exists only because of the merge. Done that way so far: the batch seam, `FileStat.ctimeMs`, `hasIgnorePatterns`, the walk-equivalence control, the `DuplicateYAMLKey`/`YAMLSyntaxError` split. Still owed for layers 5-6 — above all the supervisor, where A's graph cache, `impact`, cost model, response budget and batch must be re-proved against master's `{ status, offenses }` contract, and where `must_fix_before_write` must be shown to receive B's `status`.

## Layer 5 (platformos-language-server-common) RESOLVED and GREEN. 67 files, 526 tests, 0 failures.

### `TypeSystem.ts` — master's task-58 rework, with A's documented deletion preserved above it

The single hunk is asymmetric in exactly the way the side-weight triage predicted (A 11+6 vs master 262+563). Master replaced separate per-tag shape handling with ONE branch — `{% parse_json %}`, `{% graphql %}` (inline and file-based), `{% hash_assign %}`, `{% function %}` all ask `analyzer.shapeAt(identifier, rangeStart + 1)`, i.e. the analyzer that already walked the file, plus a fallback that substitutes a placeholder per interpolation so completion/hover can read a `{% parse_json %}` body containing `{{ … | json }}` that a diagnostic must refuse to act on. Taken whole.

A's entire contribution to the hunk is a COMMENT: the documented removal of the `layout` branch that used to introduce `none` as a keyword inside `{% layout none %}` and drive hover/completion for it. Kept verbatim above master's branch, because per CLAUDE.md a documented silence's justification matters as much as its behaviour — the next person reasons from the comment.

Verified the comment is still ACCURATE rather than assumed: A's TASK-44 grammar removal survived the merge (`liquid-html.ohm` has the explanatory comment and no `layout` rule, with the measurement recorded — all 50 grammar tag names checked against the runtime, `layout` the only one missing).

### An auto-merge hazard checked and cleared, not trusted

Master's `TypeSystem.ts` DOES still contain `} else if (node.name === 'layout') {` — at stage-3 line 463, immediately ABOVE the conflict region. That is precisely the "25 auto-merged files are NOT done" class, and in the LSP. Checked the working tree directly: the branch is absent and A's comment stands in its place, so git applied A's deletion cleanly (master never touched those exact lines; it modified the shape branch below them, which is what conflicted). Had it merged the other way, the editor would again be autocompleting an author into a converter rejection that fails the whole changeset.

### The layout silence IS tested, from both directions — checked rather than assumed

CLAUDE.md's rule is that a "must stay silent" case needs a control that must still fire. Both halves survived the merge and are in the green suites:
- SILENCE: `ObjectCompletionProvider.spec.ts` (`offers no completion inside {% layout %}, which platformOS does not implement`) and `LiquidObjectHoverProvider.spec.ts` (`offers NOTHING inside {% layout %}`), each carrying the reason.
- CONTROL: check-common's `UnknownTag.spec.ts` asserts `{% layout %}` IS reported, with the actionable message (`platformOS has no layout tag — it selects a layout from the …`), not merely `Unknown tag 'layout'`.

So the LSP staying quiet is paired with the linter speaking up, which is the correct division: hover/completion must not advertise a tag the platform rejects, and the check must still tell the author.

### Layer 5 verification
`tsc --noEmit` clean (after building platformos-graph — the three initial errors were stale `graph/dist`, not resolution defects). Full suite 526/526.

## STATE: layers 1-5 resolved and green. Only the supervisor remains.

Remaining conflicted files, all in `platformos-mcp-supervisor`:
- `result/assemble.spec.ts` (5 hunks), `transport/validate-code.ts` (3), `result/types.ts` (2), `result/assemble.ts` (1)
- the `lint/lint.ts` + `lint/lint.spec.ts` DELETE/MODIFY pair (A deleted both in favour of `lint-batch.ts`; master modified them)

Plus, in the same package and NOT conflicted but known-wrong:
- `graph-cache/graph-cache-store.spec.ts` still imports `recursiveReadDirectory`, which no longer exists → use `enumerateEdgeSources(fs, rootUri)`, as the two graph specs now do.
- `validate/file-type-coverage.spec.ts` enumerates file types exhaustively and needs rows for master's NEW ones: `ActivityStreamsHandler`, `ActivityStreamsGroupingHandler`, `InstanceConfig`, `UserSchema`.
- `transport/validate-code.ts` is the LAST offender in `directory-knowledge`'s directory-name guard. If it still trips after resolution, it genuinely spells platformOS directory names and must derive them from `FILE_TYPE_DIRS`.

The supervisor consumers of check-node APIs that CHANGED under this merge, so each is a real edit rather than a merge: `AppCache` (deleted — `context.ts`, `graph-cache.ts`, `lint-batch.ts`, `blocking-emission.spec.ts`, `measure-lint-cost.mjs` all referenced it), `fileFingerprint` (now `fingerprintOf` in `fingerprints.ts`, and now `mtime:ctime:size`), and `lintBuffers` (now returns `Map<UriString, LintBufferResult>` instead of `{ offenses, ignored }`).

## Layer 6 (platformos-mcp-supervisor): ALL CONFLICTS RESOLVED. Zero conflict markers remain anywhere in the tree.

Confirmed by the user mid-pass: **"A branch is all about supervisor, so when it comes to supervisor, A is its revamp."** Every resolution below had already been made that way, on the evidence rather than on the instruction — in each file master's side turned out to be the pre-A scaffold that A finished.

### `result/types.ts` — A's vocabulary, plus one case A could not express

A adds `not_applicable` + `NotApplicableReason` + `Declined`; master has only `ok|warning|error`. A's is the write-gate safety work ("reporting an unchecked file as `ok` reads as validated, safe to write"), so it wins outright.

But master's `LintBufferStatus` distinguishes something A's six reasons could not: **`misplaced-source`** — a platformOS SOURCE outside every deployed subtree, i.e. dead code the platform will never load. A collapsed that into `unsupported_type`, whose correct advice is the OPPOSITE (routine, must never be advised "move it under app/"). Added `misplaced_source` as a seventh reason, documented as kept-separate-because-the-remedies-differ, and rewrote `unsupported_type`'s docblock so the two read as a pair. check-node already pays for this distinction at the point classification happens; collapsing it here would discard it and leave the agent re-deriving it from a raw path.

### `result/assemble.ts` + `assemble.spec.ts` — A's, and master's remainder is provably scaffold

A brings reading-order sorting, `impact`, and `blocksWrite`. Diffed master's whole file against the resolution to check nothing was lost: every master-only line is placeholder prose for work A completed — *"The ergonomic transforms … are added in later tasks; they are left empty/null here"* and *"Minimal gate: any error blocks the write. The richer blocking-warning set is defined in the result-assembly task."*

The spec's five hunks were all the same mechanical `assembleResult(x, NO_IMPACT)` vs `assembleResult(x)`. **One of A's tests was deleted rather than carried over:** `'returns the same result for `full` and `quick` — the mode is reserved and does nothing yet'` asserted `assembleResult(d, NO_IMPACT)` equals `assembleResult(d, NO_IMPACT)` — the same call with identical arguments, which is true of any pure function. It cannot fail, and `mode` never reaches `assembleResult` at all, so it read as coverage of mode-independence while testing nothing. TASK-12.5 is where that question actually lives.

### `transport/validate-code.ts` — A's, and the directory-name guard's last offender is gone

A's side carries the batch, the request-level refusals (`batchTooLarge`, `collidingBufferPaths`) and `assembleNotApplicableResult`. Master's side is the pre-batch single-file shape plus `runLint` and a spelled `APP_SOURCE_SUBTREES` import — which is exactly why this file was the last file tripping `directory-knowledge`'s directory-name guard. Verified after resolving: no dangling reference to `APP_SOURCE_SUBTREES`, `runLint` or `Logger`, so the guard should now be clean repo-wide.

### `lint/lint.ts` + `lint.spec.ts` — A's deletion honoured, after verifying it is safe

Delete/modify conflict (A deleted both for `lint-batch.ts`; master modified them). Checked for consumers first: **zero** references to `runLint` or `lint/lint.js` outside the two files themselves. Deleted.

### Four check-common exports the supervisor consumed that master moved

- `PlatformOSFileType` → now `platformos-common` (classification moved there when it became root-anchored).
- `isKnownLiquidFile` / `isKnownGraphQLFile` → one `sourceCodeTypeOf(uri)` question. `impact.ts`'s `isGraphTrackable` now names the two types explicitly, which keeps the YAML exclusion VISIBLE — that exclusion is what its docblock turns on (YAML is wired by model/table NAME, not by file reference, so `total: 0` would be a false "safe to change").
- `recursiveReadDirectory` + `isLayout||isPage||isPartial` in `graph-cache-store.spec.ts` → `enumerateEdgeSources(NodeFileSystem, rootUri)`, the same reconciliation the two graph specs got. Third and fourth copies of that predicate now gone.
- `isSupportedSourceFile` → **deliberately NOT master's anchored `isSupportedSourceFile(uri, rootUri)`**, even though `adapter-input.ts` has `projectDir` in scope. A's gate asks "is this a type we parse at all", and a `.liquid` in an undeployed subtree IS one. Anchoring there would answer `unsupported_type` — "not a platformOS source", the opposite of the truth — for precisely the file check-node calls `misplaced-source`. Used `sourceCodeTypeOf(uri) === undefined`, which preserves A's semantics exactly, with the reasoning in a comment beside it.

### Layer 6 REMAINING: the `AppCache` removal is a refactor, not an import fix — stopped deliberately

`tsc --noEmit` on the supervisor is down to TWO errors, both in specs, and both are the same root cause: `SupervisorContext` still has an **`appCache`** field, and `AppCache` no longer exists (deleted with layer 4, superseded by master's shared reconciled `App` + `resetSharedApp`, which also covers the LSP as `AppCache` never did).

Blast radius, measured: `context.ts` (the field itself), `graph-cache/graph-cache.ts`, `lint/lint-batch.ts`, and the two specs that construct a context — `validate/file-type-coverage.spec.ts:127` and `result/blocking-emission.spec.ts:276`, both `appCache: new AppCache()`.

That is real design work, not a mechanical substitution: each consumer has to be repointed at `getApp`/`getSharedApp` semantics, and `graph-cache.ts` additionally consumed A's `fileFingerprint`, which is now `fingerprintOf` in `check-node/src/fingerprints.ts` AND now includes ctime. Started without room to verify, it would leave the tree worse than it is now — so it is recorded rather than half-done.

### Also still owed in this package

- `validate/file-type-coverage.spec.ts` enumerates file types EXHAUSTIVELY and needs rows for master's four new ones: `ActivityStreamsHandler`, `ActivityStreamsGroupingHandler`, `InstanceConfig`, `UserSchema`. Without them the spec's exhaustiveness claim is false while still passing.
- The `LintBufferStatus` → `NotApplicableReason` MAPPING is now the central piece of supervisor work: check-node returns five statuses per buffer, `NotApplicableReason` has seven codes, and `misplaced_source` was added specifically so the mapping is total and loses nothing. This is where TASK-60's original requirement lands — *"B's status is strictly BETTER for the write gate and must reach `must_fix_before_write`, not only `next_step`"*. Decide deliberately whether `misplaced-source` BLOCKS: the file is dead code, but the write itself is not invalid, and a false block ranks with silent data loss as the worst outcome. My reading is loud `not_applicable` + `misplaced_source`, NOT a block — but it must be decided, not defaulted.
- A's batch (`lintBuffers`) now returns `Map<UriString, LintBufferResult>` rather than `{ offenses, ignored }`. `lint/lint-batch.ts` and `validate/validate-buffers.ts` consume the old shape and must be moved onto the per-file `status`, which is strictly more information than A's `ignored` set carried.
- Per AC#10: every one of the above needs a test written FOR this merge. The status mapping in particular must be pinned exhaustively (one case per `LintBufferStatus`), with a control that `checked` + empty still means clean — the whole reason the status exists.

### Verified state at this point

| package | tests | conflicts |
|---|---|---|
| platformos-common | 574 pass / 2 fail (both `directory-knowledge`, expected to clear now) | 0 |
| platformos-check-common | 1578 pass | 0 |
| platformos-graph | 123 pass | 0 |
| platformos-check-node | 164 pass | 0 |
| platformos-language-server-common | 526 pass | 0 |
| platformos-mcp-supervisor | not runnable until `appCache` is removed | 0 |

**Zero conflict markers remain in the tree.** Nothing committed; `git merge --no-commit --no-ff origin/master` is still in progress. Re-run `directory-knowledge.spec.ts` first thing next session — `validate-code.ts` was its last offender and should now be clean, which would take platformos-common to 576/576.

## Three questions SETTLED by the maintainer, one of them with a measurement attached

**1. `mode` (quick/full) is REMOVED — one mode only.** Verified: no `mode` remains in supervisor production code. The single mention left is at `validate-code.ts:16`, deliberately citing the removed parameter as a cautionary precedent ("the same empty promise `mode: full|quick` was") — prose, not a remnant. This also confirms deleting A's `'returns the same result for full and quick'` test was correct rather than convenient: the parameter it claimed to cover does not exist, and the assertion compared a call to itself.

**2. `misplaced_source` is a WARNING and must NEVER block a write.** Recorded as decided, and it is no longer a judgement call — see below.

**3. Linting outside `/app` — the maintainer's stated uncertainty, now MEASURED. Filed as TASK-61.**

Probed the built `platformos-common` with root `file:///repo`. A module DEVELOPER's repo root is the module itself, so its tree starts at `public/`/`private/` with no `modules/<name>/` above it:

| path | `getFileType` | `sourceCodeTypeOf` |
|---|---|---|
| `public/views/partials/card.liquid` | **undefined** | LiquidHtml |
| `private/views/pages/index.liquid` | **undefined** | LiquidHtml |
| `modules/shop/public/views/partials/card.liquid` | Partial | LiquidHtml |
| `app/views/partials/card.liquid` | Partial | LiquidHtml |

Every file is a source the toolchain PARSES but has no file TYPE. Tracing `lintBuffer`: `app.setSource` returns undefined → `misplaced-source` for **literally every file in the project**. And `walkAppSourceFiles` matches none of those subtrees, so the `App` is EMPTY — no cross-file resolution at all.

**That turns decision 2 from a preference into a requirement:** blocking on `misplaced_source` would make the supervisor unusable for module development, because the status fires on every file. It also means the supervisor currently returns results to a module developer that LOOK like answers while nothing examined the project — which is the exact false-approval shape `not_applicable` exists to prevent, one level up.

TASK-61 carries the measurement, the four design questions in order, and the trap to avoid: adding `public`/`private` to `APP_SOURCE_SUBTREES` unconditionally would make `public/views/partials/x.liquid` a Partial inside a normal APP too, which is the false classification master's anchoring work exists to prevent.

### Consequence for the supervisor mapping still owed

The `LintBufferStatus` → `NotApplicableReason` mapping must therefore treat `misplaced-source` as non-blocking `not_applicable` + `misplaced_source`, and must not be written as though that case were rare — for one whole class of user it is universal. AC#10's exhaustive mapping test should include a module-shaped fixture for exactly that reason.

## The `appCache` removal is NOT the blocker — the STATUS MAPPING is. Full design, ready to execute.

Traced properly this session. `appCache` itself is a pure deletion and a SIMPLIFICATION, because master moved the cache from "the caller holds and threads it" to "the runtime owns one shared `App` per project" (`getSharedApp`, reconciled per call). Sites: `context.ts:21` (field + `AppCache` import), `server.ts:91-92` (construction), `validate-buffers.ts:182` (`ctx.appCache` as `adapters.lint`'s 2nd arg), `lint-batch.ts:70,88` (`cache?: AppCache` and its pass-through), and five specs that construct a context (`file-type-coverage`, `response-bound`, `validate-code`, `blocking-emission`, `blocking-silence`).

**Deleting it alone will NOT compile**: `runBatchLint` consumes `result.ignored` and `result.offenses`, and the re-implemented `lintBuffers` returns `Map<UriString, LintBufferResult>` with a per-file `status`. That is the real work, and it is where TASK-60's original requirement lands — *"B's status is strictly BETTER for the write gate and must reach `must_fix_before_write`, not only `next_step`."*

### The contract change, and why NOT the cheap version

`BatchLintResult` is `{ diagnostics: Map<key, Diagnostic[]>, ignored: Set<key> }` — TWO outcomes. Master's seam has FIVE. The cheap option derives `ignored` from `excluded-by-config`, drops the other three statuses, compiles, and leaves `validate-buffers.ts` untouched — while throwing away exactly the distinction this merge exists to gain. Do not do that.

Replace `ignored: Set<string>` with `notApplicable: Map<string, NotApplicableReason>` — one vocabulary with `result/types.ts`. Keyed by the caller's ORIGINAL `filePath` string, as `diagnostics` already is, for the reason `lint-batch.ts` states: the caller may pass relative, absolute or a mix and must find its results without reconstructing our normalization.

### The mapping table (total by construction)

| check-node `LintBufferStatus` | `NotApplicableReason` | blocks? |
|---|---|---|
| `checked` | — (goes to `diagnostics`) | per its offenses |
| `excluded-by-config` | `ignored` | no |
| `not-a-source-file` | `unsupported_type` | no |
| `not-a-platformos-file` | `unsupported_type` | no |
| `misplaced-source` | `misplaced_source` | **NO — warning only** (maintainer's decision) |

Write it as a `satisfies Record<LintBufferStatus, …>` lookup, NOT a `switch` with a `default`: a status added upstream must fail the BUILD here rather than fall into a catch-all that silently reports the wrong reason. That is why `misplaced_source` was added to the vocabulary this session.

### `Declined` factories needed

`adapter-input.ts:213` already has `ignoredByProjectConfig(relativePath)`. Two siblings are needed, and their prose must NOT be interchangeable — keeping the reasons apart is the entire point:
- `unsupportedType(relativePath)` — routine. A project holds plenty of files that are not platformOS sources and are not meant to be. **Must never advise "move it under app/".**
- `misplacedSource(relativePath)` — actionable, and the OPPOSITE advice: this IS a platformOS source sitting where the platform will never load it, so it is dead code. Name where it should live.

`validate-buffers.ts:97`'s `for (const key of lint.ignored)` becomes a loop over `lint.notApplicable` dispatching to the right factory.

### Tests owed (AC#10), each sabotage-verified

1. One case per `LintBufferStatus` through `runBatchLint`, asserting the whole `BatchLintResult`. Fixtures: a clean source, an offending source, an `ignore`d path, an asset (`app/assets/x.js`), a non-source (`README.md`), a misplaced source (`scratch/card.liquid`).
2. **The control:** `checked` with an empty array still means CLEAN and is distinguishable from every `notApplicable` entry. Without it, a mapping that declared everything not-applicable would pass every "not checked" assertion.
3. `misplaced_source` does NOT set `must_fix_before_write`, asserted directly — it is a deliberate decision, and a future "tighten the gate" change should have to argue with a test.
4. Exhaustiveness: adding a `LintBufferStatus` without a mapping row fails to COMPILE. Note in the spec docblock that the guard is the type, not a runtime check.

### Everything else in the package is READY
Zero conflicts; the two remaining `tsc` errors are precisely the `appCache` field and nothing else. `file-type-coverage.spec.ts` additionally needs rows for master's four new file types (`ActivityStreamsHandler`, `ActivityStreamsGroupingHandler`, `InstanceConfig`, `UserSchema`) — their absence makes its exhaustiveness claim false while it still passes.

## Supervisor now COMPILES. appCache removed + the not-checked contract landed.

The blocker was never `appCache` (a pure deletion — master moved the cache to a process-level shared `App`). It was that `runBatchLint` consumed a two-outcome `{diagnostics, ignored}` while master's seam reports FIVE per-buffer statuses.

**THE DESIGN CHANGED ONCE THE BRANCHES WERE ACTUALLY DIFFED, and this is the important entry.** My recorded plan was to map `LintBufferStatus` -> `NotApplicableReason` inside `lint-batch.ts` and write my own refusal prose. Then `stdio-smoke.spec.ts` failed on two tests I had not noticed were **master's** (`cf80cfa`), and they turned out to encode this exact distinction already:

- master HAS the misplaced/unsupported split, four prose messages, `DEPLOYED` derived from `APP_SOURCE_SUBTREES`, and a `DIRECTORY_STRUCTURE` doc link. A had NONE of it — A collapsed everything into one `unsupported_type`.
- master's ENVELOPE is worse: `status: 'ok'` + prose, no machine code. Its own comment admits why — *"Until the contract has a status of its own for this, the reason goes where the agent is told what to do next"*. A's contract HAS that status.

So the resolution is **master's prose content inside A's envelope**, which is what both branches were reaching for. Verified: master's two integration tests now pass end to end against A's `not_applicable` + `not_applicable_reason`.

Had I followed my own recorded plan I would have hand-written prose that duplicated master's, hard-coded the subtree list master derives, and dropped the doc link.

### What landed (supervisor compiles; 405/405 supervisor tests pass)

- `context.ts` / `transport/server.ts` — `appCache` field, construction and thread-through deleted. Docblock says why it must not come back.
- `lint/lint-batch.ts` — `BatchLintResult.ignored: Set` -> `notChecked: Map<string, LintNotCheckedStatus>` where `LintNotCheckedStatus = Exclude<LintBufferStatus, 'checked'>`. **`Exclude` rather than a hand-written union**: a status added in check-node lands in the type automatically and fails the build at the one place that must decide the advice. No mapping table here at all — the adapter just partitions.
- `validate/validate-buffers.ts` — ONE `DECLINE: Record<LintNotCheckedStatus, (p) => Declined>` table. Each factory returns BOTH halves (machine code + prose), which is what lets `not-a-platformos-file` and `not-a-source-file` collapse to one `unsupported_type` CODE while keeping different WORDING. Two tables would have had to stay in step.
- `adapter-input.ts` — refusal factories `notPlatformOSFile` / `assetNotLinted` / `misplacedSource`, plus `DEPLOYED` (derived from `APP_SOURCE_SUBTREES`) and `DIRECTORY_STRUCTURE`, both taken from master.
- `result/types.ts` — `misplaced_source` added to `NotApplicableReason` with paired docblocks against `unsupported_type`.
- `graph-cache/graph-cache.ts` — `fileFingerprint(fsPath)` -> `fingerprintOf(uri)`; takes a URI so no path round-trip.

**SABOTAGE VERIFIED, both directions.** (1) Deleting a `DECLINE` row -> build error naming the missing status. (2) Adding `'brand-new-status'` to check-node's `LintBufferStatus`, rebuilding check-node -> the supervisor build fails at `DECLINE`. That second one is the real guard and it works.

### Defects the merge FOUND (not introduced), and what was done with each

1. **A latent FALSE APPROVAL in A's `lint-batch`.** The re-key loop did `(result.offenses.get(uri) ?? [])` — a map miss SET an empty array, reporting the file CLEAN and making `resultFor`'s `internal_error` fail-safe unreachable. Now a miss sets nothing, so the fail-safe actually fires. Also switched the lookup to `uriFromPath` (the same function check-node keys with) rather than check-common's `path.toUri`; measured byte-identical on POSIX, Windows drive, non-ASCII and unnormalized segments, but a map lookup should not rest on two normalizers agreeing.

2. **A FALSE BLOCK on assets — fixed for the write gate, filed as TASK-62.** `app/assets/x.liquid` holding `{% if unclosed` returned `must_fix_before_write: true`. A bare `.liquid` has no response format so `sourceCodeTypeOf` falls back to `html.liquid` and a parser claims it, while `theme.css.liquid` — the form the platform DOES process — was exempt. Exactly backwards. `fileApplicability` now refuses `PlatformOSFileType.Asset` by TYPE. **The user raised this mid-session and was right**; my first version of the coverage spec would have PINNED the false block as correct behaviour.

3. **`misplaced-source` is over-broad for `.yml` — filed as TASK-63, deliberately NOT fixed here.** `.platformos-check.yml` gets told to move under `app/`. Preserved as master's shipped behaviour and pinned in `adapter-input.spec.ts` so the fix has a test to flip. Fixing it means deciding which extensions carry a platformOS signal at the point of classification, which is not a merge change.

4. **A stale JUSTIFICATION in `blocking.ts`.** It argued `PartialCallArguments` is safely non-blocking because "a partial with a `{% doc %}` block ALSO raises `MissingRenderPartialArguments` — verified, both fire together". Master rewrote that check to split ownership by whether a contract exists, so they no longer fire together at all. Same verdict, sounder reason; comment rewritten and the history recorded, because the next person reasons from the comment.

### AC#10 — tests written FOR this merge (all sabotage-checked where sabotage is meaningful)

- `DECLINE` totality, both sabotage directions (above).
- `stdio-smoke.spec.ts` — master's two cases re-expressed in A's envelope, whole-object equality including the exact prose, plus a stated CONTROL relationship between them (same status, same non-blocking verdict, OPPOSITE advice).
- `adapter-input.spec.ts` — new `asset(...)` expectation over 8 spellings incl. `marketplace_builder/assets/`; new "admits X, leaving the verdict to the lint" group for the three cases the gate now passes through. Sabotage: `false &&` the Asset branch -> 10 tests fail.
- `file-type-coverage.spec.ts` — 5 rows added for master's new types (`UserProfileType` rename + `ActivityStreams{,Grouping}Handler`, `InstanceConfig`, `UserSchema`); YAML pin widened from 6 to 12 paths (every directory spelling + both singletons); asset row now 4 real spellings asserting the prose says ASSET, plus the bare-`.liquid` case as its own test.
- `blocking-emission.spec.ts` — `MissingRenderPartialArguments` fixture corrected to a single error, WITH a new control proving `PartialCallArguments` still fires on an undocumented partial and still does not block. Silence + control, per the rule.
- `graph-cache.spec.ts` — the "never walks the project root" assertion was true of the older probe-based walk; master lists the root once to discover which subtrees exist. Asserted POSITIVELY (`[rootUri]`) rather than deleted, so both designs stay pinned.
- `blocking-emission.spec.ts` — the `isSupportedSourceFile` sample list gained the root argument (anchored now) and a `.yaml` NEGATIVE control: `.yaml` is not a platformOS extension, and it is the one sample that reaches `toSourceCode`'s JSON editor fallback. A list of all-`true` rows could not tell the two halves of that invariant apart.

### check-node API change
`fingerprintOf` + `isKnownFingerprint` exported. **The sentinel `UNKNOWN` stays private**: an outside caller only needs the question, while the value carries a footgun — `UNKNOWN === UNKNOWN`, so a cache that STORES it for an unreadable file concludes "unchanged" forever. The graph cache omits such files instead, which reconciles as `deleted` now / `added` on the first scan that can read it. A's docblock claimed sharing the definition stops the two caches disagreeing; corrected — they never compare against each other, what is shared is the measured definition.

### Two more merge artefacts closed

**`directory-knowledge.spec.ts` — the last offender was A's tool DESCRIPTION.** `validate-code.ts` spelled `app/views/partials/card.liquid` etc. as example paths in the MCP tool schema and the `DESCRIPTION` prose. Master's version of that file spells none, and the guard's exemption list is empty *on purpose* ("it must stay that way").

Adding an exemption would have been defensible — an example path is documentation, not classification — and was still the wrong trade. These strings are the shape an agent IMITATES when it invents a path, so an example naming a directory the platform stopped accepting teaches the mistake to every caller. Now derived: `exampleOf(type, name)` = `getAppPaths(type)[0] + '/' + name + '.liquid'`, taking the CANONICAL directory (first entry) rather than a legacy alias. Same precedent as master's `DEPLOYED` in the same file. `KNOWN` stays empty; `directory-knowledge.spec.ts` 4/4; `validate-code.spec.ts` still passes, which is what proves the derived strings are byte-identical to the hand-written ones.

**`.backlog/` had 35 files with 66 live conflict markers.** Code was clean but the task files were not, and they are the merge's own record. Classified before touching anything: 53 hunks were "ours empty, master added frontmatter" (`updated_date`, `ordinal`) → take master's; 11 were `updated_date` on both sides → keep the later stamp; both resolved by script. Two needed judgement and were done by hand:
- TASK-26 — a genuine field UNION (ours had `modified_files`, master had `ordinal`; both kept).
- TASK-12 — substantive notes on both sides. Kept BOTH chronologically: A's 2026-07-29 branch-split note (relabelled SUPERSEDED, with its three now-false claims named — `AppCache`/`fileFingerprint` gone, 12.8 landed AS 12.6, 12.5 dropped not decided) then master's 2026-08-03 closing note. 0.9–1.0 s warm (eager) and 99–123 ms warm (lazy `App`) are both real on different architectures, and the pair is the only record of what the lazy model bought.

Zero conflict markers remain anywhere in the repo (`packages/` and `.backlog/`).

## THE MERGE SHIPPED. It is on master as `a8f4da9` — 'Integration/supervisor graph integration app in memory lazy parsing (#93)', 330 files, +39 846/−1 343.

Established by measurement, not by reading the notes above: every artifact this task's
resolution log claims is present on master HEAD — `LintNotCheckedStatus` (3 files), the `DECLINE`
table (2), `fingerprintOf` (8), the single exported `isSupportedAsset` (2), `misplaced_source`
(4), `PLATFORM_YAML_LOAD_OPTIONS` (6). The integration branch
`integration/supervisor-graph-integration-app-in-memory-lazy-parsing` still exists locally and is
**71 commits ahead of / 10 behind** master, i.e. a stale leftover of a squash-merge, not an
outstanding branch. `git merge-base --is-ancestor` says no because the merge was squashed.

So what was left of this task was never the merge — it was the acceptance gate. Verified on
master + today's working tree (2026-08-11):

**AC #1, #2, #10 — met, by the resolution log above.** All six layers resolved, the 25
auto-merged-but-both-touched files reviewed rather than trusted, the three known-wrong ones
corrected or regenerated, and the merge's own tests written for THIS merge (DECLINE totality
both sabotage directions, `stdio-smoke`, `adapter-input`, `file-type-coverage`,
`blocking-emission`, `graph-cache`).

**AC #5 — met, and TIGHTENED today.** `check-node/src/index.spec.ts`, 'lintBuffer parses only the
visited file and the render targets it resolves', built on `withCountedLiquidParses`, is the
automated laziness assertion this task asked for. It was asserting `parsedUris.length <= 4` plus
`every(/home|documented|p7/)` — a bound and a name pattern, the exact pair the repo's test
guidelines forbid. Measured: rendering `p70` instead of `p7` PASSES it, because the count is a
bound and `/p7/` matches `p70`…`p79`, so it accepted a parse of the wrong file. Now a whole-value
equality on the sorted URI set; sabotage-verified against both the extra-parse and
wrong-file cases.

**AC #6 — met.** `yarn build`, `yarn type-check`, `yarn format:check` clean. Per-package suites
(the combined run still gets killed here): check-common 1536, platformos-common 522, LSP 535,
check-node 173, graph 130, supervisor 407, parser 302, prettier plugin 144, browser/node LSP
shims and docs-updater green.

**AC #7 — met.** LSP suite green, and `check(root, configPath?)` delegates to `appCheckRun`, which
builds and passes an `App`; check-common's `check()` takes an `AppModel` only — the array form is
gone, so the regression this AC guards is now impossible by type rather than by discipline.

**AC #8 — met.** The supervisor's 407 tests pass with A's features intact on master's contract:
`graph-cache` (8 files), `impact` (14), `runBatchLint` (4), and B's per-buffer status reaching the
write gate — `must_fix_before_write` in 13 files, `notChecked` in 4, `DECLINE` in 2.

## AC #3, #4 and #9 are VOID BY SUPERSESSION — not skipped, unmeasurable

They compare the merged tree against baselines from **A @ `02404ce`** and **master @ `cf80cfa`**.
Neither is the artifact that shipped, and master has since moved 10 commits past the merge
(`4567a07`, `f644a30`, `a482392`, `87a59d9`, `93b4e80`, `28395f9`, `ed244ad`, `b00cbf9`,
`7dfee46`), several of which deliberately CHANGE offense counts — shape analysis, `use app`,
the MissingPage work. A capture equal to 'the union of both baselines' is therefore not a
property the current tree can have, and building a 71-commit-old branch to re-derive it would
measure an artifact nobody will ever ship. This task already recorded the same lesson twice
('the B-branch baseline is void', 'SOURCE CHANGED AGAIN').

AC #9's perf comparison (B's win at 0% offending, A's number at 100%) dies with them for the
same reason: A no longer builds as a comparable artifact.

**Forward baseline, captured today so the next change has something valid to diff against** —
sorted `check\turi\tstart\tend\tmessage` fingerprints plus a separate file manifest (AC #4's
method, kept), master + working tree, `platformos-check` CLI:

| project | offenses | files | CPU |
|---|---|---|---|
| pos-module-community | 36 | 1507 | 31–33 s |
| htevent | 16 758 | 2895 | 150–151 s |
| Accala-MP | 252 | 2789 | 20 s |
| arabbank | 11 059 | 3139 | 74–77 s |

Note how far these are from this task's own numbers (A 9540/1514, master@cf80cfa 9175/1465 on
arabbank): ten commits of deliberate check changes, which is exactly why the old baselines cannot
serve as a gate.

**The oracle method this task argued for is now the method in use**: capture is JSON-parsed,
sorted, then hashed — never a hash of the report text, which TASK-74 measured is not byte-stable
across runs of the same build. Kept as `scratchpad/offense-oracle.py` for the next change.

Closing this rather than leaving it In Progress: the deliverable landed, its gate is met on
everything still measurable, and the three void criteria are recorded with the reason instead of
being quietly checked off.
<!-- SECTION:NOTES:END -->
