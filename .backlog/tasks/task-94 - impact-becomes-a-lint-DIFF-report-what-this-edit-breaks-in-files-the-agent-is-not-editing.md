---
id: TASK-94
title: >-
  impact becomes a lint DIFF: report what this edit breaks in files the agent is
  not editing
status: Done
assignee: []
created_date: '2026-08-25 14:30'
updated_date: '2026-08-25 16:27'
labels:
  - mcp-supervisor
  - impact
  - contract
  - performance
  - design
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - packages/platformos-mcp-supervisor/src/impact/project-scan.ts
  - packages/platformos-mcp-supervisor/src/lint/lint-batch.ts
  - packages/platformos-mcp-supervisor/src/validate/validate-buffers.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-check-node/src/index.ts
  - /home/ecgtheow/Work/supervisor-tests/auto-eval/suites/16-impact.mjs
  - /home/ecgtheow/Work/supervisor-tests/auto-eval/suites/09-graph.mjs
priority: high
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the hand-rolled signature comparison in `impact.ts` with a DIFF of the real check engine: lint the edited file's dependants twice — once with the changeset overlaid, once without — and report only the offenses that the change INTRODUCED.

WHY. `computeSignatureRisk` is a reimplementation of `MissingRenderPartialArguments` / `PartialCallArguments` aimed backwards. Its own docblock says so. It can drift from the check, carries no message, no `see_also`, no fix, and invents its own severity. The engine already answers the question; the supervisor simply never asks it about the right files — `lintBuffers` visits ONLY the buffers sent (`only: visit`), so a dependant is never visited and its offense is never computed.

MEASURED, on a temp project (see Implementation Notes for the full numbers):

    FORWARD   validating home.liquid  -> MissingRenderPartialArguments (error)
    BACKWARD  validating card.liquid  -> nothing about home.liquid at all

The diff also covers what the `{% doc %}` gate structurally CANNOT, because `signature_risk` requires a Liquid buffer with a doc block:

    translation key removed   -> TranslationKeyExists on the page
    graphql variable renamed  -> GraphQLVariablesCheck x2 on the caller (BLOCKING)
    partial gains @param      -> MissingRenderPartialArguments; pre-existing
                                 DeprecatedFrontmatterField correctly filtered out

Two of those three are YAML/GraphQL edits, where impact today returns `not_applicable`. None needs `{% doc %}` — and the production app has ZERO doc blocks in 2,768 liquid files, so today's impact fires never while this fires on edits people actually make.

SCOPE IS CAUSAL, NOT CATEGORICAL. No allowlist of "relevant check codes": an allowlist rots the first time a check is added, and it is the wrong axis anyway. `DeprecatedFrontmatterField` is out of scope because it was there BEFORE the edit, not because of its code. The twice-lint diff expresses exactly that and needs no maintenance.

THIS SUPERSEDES the `{% doc %}`-gated `signature_risk` shipped in TASK-93. That work is not wasted: it deleted the unsound claims (`dependents`, the empty all-clear), which this design also does not make. Land it first; this replaces the machinery underneath.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dependants are linted TWICE per request — once with the changeset overlaid, once with NO buffer overlaid — and only offenses present in the first and absent from the second are reported. Matched by identity (check + file + line + column) as a MULTISET, never by code alone
- [x] #2 The baseline pass overlays NONE of the request's buffers, so in a multi-file changeset one buffer's breakage cannot hide another's — asserted with a two-buffer fixture where both break the same page
- [x] #3 Caller discovery for GRAPH-EDGE kinds (partial / layout / graphql operation) reuses the graph's own resolver, with a test per kind. Translation and schema YAML are OUT OF SCOPE and filed as TASK-95: they have no edges, and building that join in the supervisor would give one consumer private knowledge of platformOS wiring
- [x] #4 A dependant's offense NEVER sets `must_fix_before_write` for the edited buffer, pinned at the layer that owns the gate. No second boolean restates what the presence of `breaks` already says
- [x] #5 Both bounds REPORT rather than silently shortening the analysis: `unchecked_dependants` when more dependants exist than are linted, `status: unavailable` when discovery refuses the work
- [x] #6 Both bounds are DERIVED from measurement and named in `cost-model.ts` — `MAX_DEPENDANTS_LINTED` and `MAX_CANDIDATE_BYTES`, with `DISCOVERY_MS_PER_KIB` measured across four differently shaped targets
- [x] #7 Whether impact runs is a SERVER setting (`--no-impact` / `POS_SUPERVISOR_NO_IMPACT`), never a tool parameter, and disabling it costs nothing — no project read, no extra lint passes — asserted by a test that the adapter is not called at all
- [x] #8 `disabled` is its own status, distinct from `unavailable`, because a retry cannot change it
- [x] #9 Cost measured on the 2,768-file corpus, each scenario in a fresh process, and recorded
- [x] #10 SERVER_INSTRUCTIONS, the result types and the README describe the new shape, state that nothing it returns is a clearance, and keep the claim that this server never answers "who depends on this file"
- [x] #11 Sabotage in both directions across every module — diff, discovery, orchestration, bounds and the flag — each failing its intended test and only that one
- [x] #12 auto-eval suites 16-impact and 09-graph rewritten against the new contract and RUN against the built server: 16 reports 0 findings across 4 sweeps, 09 keeps S09-EDGE-LOST re-aimed to MISSED_DETECTION
- [x] #13 A changeset accompanies the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ORCHESTRATION — decided by one hard constraint discovered before coding.

`getSharedApp` hands the SAME mutable `App` to every caller and has no lock; `lintBuffers`
overlays buffers into it and reverts on the way out. Two concurrent `lintBuffers` calls on
one project therefore interleave overlays and rollbacks. Today that is safe only because
impact never touches the App — this task breaks that, so every `lintBuffers` call in a
request must be SERIALIZED, and the sequence is chosen to keep two invariants:

  INV-1  the primary lint is never delayed, broken, or made to wait on impact. It is the
         write gate; impact is discardable enrichment.
  INV-2  impact remains fully discardable — failure or the 2 s deadline yields `unavailable`
         and the response is otherwise unchanged.

    t0  ┌ primary lint  (runBatchLint, touches the App)
        └ project scan  (fs reads only, touches NO App)          ← safe to overlap
    t1  pass A = runBatchLint([...changeset, ...dependants])     ← serial, after both
    t2  pass B = runBatchLint([...dependants])                   ← baseline
        diff = A \ B, matched by identity

The scan overlapping the primary lint is what preserves INV-1 at no cost: it is pure fs I/O
and cannot race the App. The two extra passes are serial afterwards.

Rejected: folding the primary lint into pass A (one fewer pass, but the gate would then wait
on the scan and die with it — violates INV-1). Rejected: giving impact a private `App` and
calling `lintApp` directly — it would mean reimplementing `lintBuffers`' overlay/restore,
which is the "invent what already exists" trap.

REUSE, deliberately: `runBatchLint` for both passes (mapping, keying and `notChecked`
already solved), `createProjectScan` for the dependants' disk text (already read — no second
read), `incomingReferences` for edge-kind discovery, `enrichDiagnostics` so a dependant
finding carries the same `see_also` as any other.

CHEAP WIN, sound: pass B only needs dependants that produced at least one offense in pass A.
diff = A \ B, so an empty A makes B irrelevant. On a clean project pass B is usually empty.

NUANCES ALREADY IDENTIFIED (each needs a test)
  - A dependant that is ALSO in the changeset must be excluded from the dependant set: it is
    being edited, its diagnostics are already its own result, and including it double-reports.
  - A dependant that exists only as a buffer is by definition in the changeset, so the rule
    above covers it.
  - `ProjectScan` overlays the changeset, so for any file NOT in the changeset its text IS
    disk content — which is exactly what pass B needs. Excluding changeset files makes this
    correct by construction rather than by a second read.
  - A dependant the lint declines (`notChecked`, e.g. ignored by config) is skipped, not
    reported as clean.
  - Identity for the diff is check + file + line + column. The dependant's text is
    byte-identical across both passes, so positions are stable.

ORDER OF WORK
  1. Diff engine + orchestration + edge-kind discovery (partials / layouts / graphql).
  2. Edgeless discovery for translations and schemas via CHANGED SYMBOLS (highest risk —
     see Implementation Notes NUANCE 1).
  3. The `unchecked` frontier.
  4. Flag / default decision, driven by the measured per-request cost.
  5. SERVER_INSTRUCTIONS + result types.
  6. auto-eval suites 16-impact and 09-graph.

The tree stays green at every step.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MEASUREMENTS (all on this machine; corpus is `auto-eval/substrate-large`, a real deployed app)

Corpus shape
    edge sources                     2,615        signature edges          8,464
    liquid files                     2,768        files with {% doc %}         0
    unparseable edge sources            62 (2.4%) non-literal call sites      23 in 19 files

Lint cost — twice-lint is NOT the expensive part
    buffer alone (what validate_code does today)      22 ms
    buffer +   1 dependant, one pass / twice      18 / 27 ms      <- p50 is 1 dependant
    buffer +  10                                  23 / 39 ms
    buffer +  50                                  77 / 140 ms
    buffer + 200                                 254 / 484 ms

Caller discovery — this IS the expensive part
    project text read                            ~235 ms @ 2,615 files, ~850 ms @ 10k
    candidates surviving the name filter         p50 1, p90 6, p99 62, max 769
    name filter soundness                        0 of 8,464 real edges dropped

Dynamic-call text scan (the frontier)
    /\b(?:render|include)\s+([^\s'"%}])|\bfunction\s+[A-Za-z_][\w.]*\s*=\s*([^\s'"%}])/
    19 files by AST truth, 21 by text scan, 0 missed, 2 false positives, 5.3 ms
    Two earlier regexes FAILED and both failures are instructive: `{% liquid %}` blocks put
    one tag per line with no `{%`, and `\s+` backtracks past a negative lookahead so every
    extra-spaced literal matched. Recall must be pinned by test (AC#6), not by reading.

Unparseable candidates per target
    94.2% of targets: 0    p99: 2    max: 39    (never the full 62 — see AC#5)

────────────────────────────────────────────────────────────────────────────
NUANCE 1 — CALLER DISCOVERY IS NOT ONE MECHANISM. Highest risk in this task.

`incomingReferences` finds dependants through platformos-graph edges, and an edge exists
only where a static literal spells the target's LOGICAL NAME. That covers partials, layouts
and graphql operations. It covers NEITHER of the two cases that make this design worth
doing:

  - TRANSLATIONS. `TranslationKeyExists` loads all defined keys (app + modules) and checks
    usages. Nothing references `app/translations/en/app.yml` by name; a page just writes
    `{{ 'app.greeting' | t }}`. Zero graph edges to that file, ever.
  - MODEL SCHEMAS. Same shape: wired by model/table NAME, not by file reference (ADR 004).

An implementation that reuses `incomingReferences` alone will pass the partial fixture, look
correct, and deliver ZERO of the translation/schema coverage that justified the task.

Proposed approach for the edgeless kinds: diff the dependency itself to get the CHANGED
SYMBOLS (removed/renamed translation keys, removed schema properties), then use those
symbols as the substring filter instead of a file name. Cheap, uses the same scan, and it
is more precise than a filename would be. Needs its own measurement — treat the symbol
extraction as the risky part, and assert a removal is reported (AC#3).

NUANCE 2 — THE GATE. A dependant's error must not set `must_fix_before_write` for the file
being written: that buffer may be perfect. But silence is also wrong when the edit breaks
three pages. Decide explicitly (AC#4). Leaning: a separate boolean/count, because
`must_fix_before_write` is documented as "will THIS file be broken if I write it", and
widening it silently changes a contract agents already act on.

NUANCE 3 — THE `impact` FLAG. Weigh against precedent: `mode` was a real parameter on this
tool and was RETIRED; `stdio-smoke.spec.ts` still asserts a stale `mode: 'full'` is ignored
rather than rejected. Adding a knob back needs a better argument than "it is cheaper".

  default OFF (opt-in)   cheapest, and wrong for a safety feature: an agent that does not
                         know it is editing a shared partial is exactly the agent that will
                         not ask, and this server exists for what the agent does not know.
  default ON (opt-out)   pays ~235 ms/request concurrent with lint, under the 2 s deadline.
                         For a pre-write gate that is nothing; the CTO's 10k case is ~850 ms.
  no flag                simplest surface; no escape hatch for bulk work.

Leaning: default ON with an opt-out, but this is AC#8 and must be decided on the measured
per-request cost, not on preference.

A FREE PRE-GATE worth measuring first: a brand-new file usually has no existing dependants
to break, and `stat` is ~0.1 ms. NOT strictly true — creating a partial that callers already
render turns their `MissingPartial` into `MissingRenderPartialArguments` — so measure the
frequency before relying on it, and do not let it become a silent skip.

NUANCE 4 — CACHING. The earlier quoted-filter experiment REFUTED the idea that the filter
can be made cheaper: quote-wrapped drops 4 real callers (format-suffixed partials — a caller
writes `'theme/available_themes.json'` for a file whose logical name is
`theme/available_themes`), and the sound quote-prefixed variant saves only 3.3%. So the
~235 ms is not reducible by a smarter filter. It IS reducible by a persistent index —
`AppFile.derived()` over check-node's process-level `App`, which is already reconciled per
call by stat fingerprints (`shared-app.ts:reconcilePaths`), so staleness is solved.

The blocker there is real and must be designed around, not assumed away: `lintBuffers`
MUTATES that shared App — `setSource` per buffer, then `invalidate`/`remove` on the way out —
while impact runs CONCURRENTLY with the lint. Reading the App mid-overlay races both the
write and its rollback. `platformos-graph/src/parsers.ts` documents the supervisor as
deliberately not sharing for this reason. (Its other stated reason, that sharing "would win
nothing", is WRONG and should be corrected: it holds only for the changeset's own files,
which are reverted; the other ~2,600 project files keep their parses.)

NUANCE 5 — TRUNCATION MUST BE LOUD. Both the dependant bound (AC#7) and the frontier caps
(AC#5) hide analysis, not just output. A capped list that does not say it was capped is the
same class of defect this whole line of work exists to remove.

────────────────────────────────────────────────────────────────────────────
BRANCH. To be done on `fix/impact-reports-findings-not-a-caller-count`, on top of TASK-93.
The user may revert their commit; it is on the remote if needed.

PROGRESS — step 1 of 6 complete (diff engine, discovery, orchestration). 513 tests green, type-check clean.

NEW FILES
  src/impact/diff.ts        introducedDiagnostics(after, before) — multiset diff, identity is
                            (check, line, column). 8 tests, 4 sabotages bite.
  src/impact/dependants.ts  dependantsOf / hasGraphEdges / toDependantBuffers. 18 tests,
                            6 sabotages bite (one is a cost test — see below).
  src/impact/impact.ts      rewritten: two-pass orchestration. 12 tests, 5 sabotages bite.
  src/enrich/enrich.ts      +enrichBatch, extracted from validate-buffers so dependant
                            findings carry the same see_also/hint as any other.

WIRE SHAPE NOW
  { status } | { status, breaks: [{ file, diagnostics[] }] }
  `scope` removed (it described the deleted dependants traversal). `signature_risk` and
  `ValidateCodeSignatureRisk` deleted — superseded by the engine's own diagnostics.

MEASURED WINS
  The payload is strictly richer than the hand-rolled one. On the integration fixture a
  break now arrives as: the check's exact message ("Missing required argument 'title' in
  render tag for partial 'card'"), its documentation URL, precise start/end position, AND a
  suggestion carrying an applicable edit (`, title: ''`). None of that was expressible by
  computeSignatureRisk.

FINDINGS THAT CHANGED THE DESIGN
  1. RAW NUL BYTES in a template literal (diff.ts identity key) — the same trap this repo hit
     before. Invisible in an editor, makes grep treat the file as binary and return nothing
     silently, and it made two sabotage rounds APPEAR to pass when they had never applied.
     Fixed to \\u0000 escapes; whole package audited, no others.
  2. IMPACT REUSES THE PROJECT'S CONFIG, which is correct and was invisible until it broke
     two integration tests: their fixture is `extends: platformos-check:nothing`, so the
     check that would have fired was disabled and impact rightly reported nothing. A project
     that disables a check is a project impact cannot report it in. Both fixtures now enable
     the one check they assert on, and the config comment says why.
  3. THE PASS-B SKIP IS WORTH LESS THAN CLAIMED. `DeprecatedFrontmatterField` fires on any
     page whatever it contains, so a PAGE dependant is never clean and always needs a
     baseline; only PARTIAL dependants skip it. The docblock overstated this and was
     corrected; the test now uses a partial and says why the first version used a page and
     never skipped.
  4. toDependantBuffers can DROP an entry, so zipping its output back against its input by
     index would pair later buffers with the wrong file. Caught before running: DependantBuffer
     now carries its own `uri`.

ATTRIBUTION, DECIDED — needs the user's eye. With several buffers in one request, a
dependant of two of them reports the SAME findings under each, because impact does not guess
which buffer of a coherent change caused what. Splitting it would need one lint pass per
buffer, which is both expensive and semantically wrong (a changeset is one change; linting
with only half of it overlaid invents findings). Documented in the type and asserted by test.

SABOTAGE, all confirmed to fail the intended test and only that test:
  diff        code-only identity / set-not-multiset / message in identity / no diff at all
  discovery   no changeset exclusion / self as dependant / skip exact resolution /
              YAML declared edge-bearing / lint a missing dependant as empty / NAME FILTER
              DELETED (cost test, ratio-controlled, stable over 3 runs each way)
  orchestrator baseline overlays the changeset / no baseline / breaks:[] when empty /
              PASSES RUN CONCURRENTLY (6 tests fail — the App corruption is real) /
              changeset not excluded

STILL TO DO: steps 2-6 — edgeless discovery for translations and schemas (the highest-risk
item, NUANCE 1), the `unchecked` frontier, the dependant bound, the flag/default decision
driven by a fresh cost measurement, SERVER_INSTRUCTIONS + README, and the two auto-eval
suites. Changeset last.

COMPLETE. Monorepo green: 355 files, 4491 tests. Type-check and format clean.

SCOPE CHANGED MID-TASK, on the user's architectural direction: do not reimplement in the
supervisor what belongs upstream. Two planned steps were dropped for that reason.

  STEP 2 (translations/schemas) -> TASK-95, in platformos-graph. Investigating first made the
  task smaller than it looked: `isTranslationKeyUsage` is ALREADY the shared definition of a
  key usage, the graph ALREADY extracts `ModuleStructural.translation_keys`, and
  `loadAllDefinedKeys` ALREADY enumerates every defined key. Only the JOIN is missing — nothing
  resolves a key to the file that defines it, so `extractFileReferences` emits no edge. Also
  recorded there: the supervisor's substring prefilter matches a FILENAME, and a page contains
  `'app.greeting'` and never `en/app.yml`, so even with edges the prefilter finds nothing.

  STEP 3 (the `unchecked` frontier) dropped for the same reason. The dynamic-call regex
  re-derives what the AST already says (`snippet.type !== 'String'`), traded for speed, and
  TASK-88 already exists for a CHECK that reports it. The right home is the graph surfacing
  dynamic references once, consumed by both.

WHAT REPLACED THE FLAG DEBATE. Measured per-request cost, each scenario in a FRESH PROCESS
(the shared `App` re-stats every loaded file, so in-process A/B comparisons are contaminated —
two earlier measurement attempts produced nonsense like lint=5209ms for a 1-dependant file and
were discarded rather than reported):

    typical page edit         lint  59 ms -> 307 ms   (+248 ms)  computed
    heaviest partial          lint  95 ms -> 325 ms   (+230 ms)  unavailable
    schema YAML               lint  46 ms ->  60 ms   (+13 ms)   not_applicable

The user chose option D: a SERVER flag (`--no-impact` / `POS_SUPERVISOR_NO_IMPACT`), not a
tool parameter. Reasoning recorded in `args.ts`: a per-call knob puts the choice with the
agent, and the agent that does not know it is editing a shared partial is exactly the one that
would not ask. `mode` was already retired from this tool once.

THE BOUND THAT WAS MISSING. `MAX_DEPENDANTS_LINTED` bounds the lint passes but NOT discovery,
which parses every candidate. Measured: the most-referenced file on the real app cost 4,658 ms
and then returned `unavailable` anyway — seconds spent to reach "I do not know". Discovery is
now bounded by BYTES (`MAX_CANDIDATE_BYTES`, 64 KiB, from a measured 8.6-14.6 ms/KiB across
four differently shaped targets), decided from the substring scan before a single parse. Same
answer, 4,658 ms -> 230 ms.

A SABOTAGE THAT DID NOT BITE, and the fix. Reporting "too much candidate text to examine" as
NO DEPENDANTS passed every test — the exact false-clearance class this line of work exists to
remove. Now pinned by a test whose control is the same fixture and the same candidate COUNT,
differing only in size.

EVAL, RUN AGAINST THE BUILT SERVER (not just rewritten):
  16-impact  rewritten — its old premise is dissolved, not changed: IMP-01 and IMP-02 both
             attacked `computed` + `total: 0`, and there is no count left to falsify. Four new
             sections attack the new construction. 0 findings, 4 sweeps, and every section
             verified to measure something real: 9/9 chain positions reported the right file;
             the pre-existing `MissingPartial` control FIRED while impact reported only
             `MissingRenderPartialArguments`; 130 dependants -> 100 linted with
             `unchecked_dependants {returned:100,total:130}`.
  09-graph   S09-EDGE-LOST RE-AIMED rather than deleted. The probe (an unparseable caller
             loses its edge) is still real, but it is no longer a false CLAIM — only a blind
             spot — so severity drops CONTRACT -> MISSED_DETECTION. Two other sweeps were
             measuring the removed field and were rebuilt: freshness now proves the overlay
             through the caller's OWN result (a file in the changeset is deliberately excluded
             from its target's dependant set), and the grep comparison now carries NO VERDICT
             when impact answered `unavailable`, instead of counting a bound as a disagreement.

STILL OPEN, deliberately: TASK-95 (graph edges for translation keys) and TASK-88 (dynamic
references). Until those land, impact fires on partial `@param` contracts and GraphQL variable
changes; the production app declares zero `{% doc %}` blocks, so GraphQL is the near-term
value. The mechanism widens automatically as the graph grows, with no further supervisor work.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
impact now reports what your change breaks in files you are not editing, using the real check engine instead of a reimplementation of it.

WHAT CHANGED
- `src/impact/diff.ts` (new): multiset diff of two lint passes, identity (check, line, column).
- `src/impact/dependants.ts` (new): discovery, bounded by candidate BYTES; no edge-kind filter any more — the engine decides what is broken, discovery only decides what to look at.
- `src/impact/impact.ts`: rewritten as a two-pass orchestration. `computeSignatureRisk` and `docSignature` deleted.
- `src/enrich/enrich.ts`: `enrichBatch` extracted so a dependant's finding carries the same `see_also`/hint as any other.
- `cost-model.ts`: `MAX_DEPENDANTS_LINTED`, `MAX_CANDIDATE_BYTES`, `DISCOVERY_MS_PER_KIB` — each derived from measurement and named.
- `--no-impact` / `POS_SUPERVISOR_NO_IMPACT`, and a `disabled` impact status distinct from `unavailable`.
- Wire shape: `{ status, breaks?: [{ file, diagnostics[] }], unchecked_dependants? }`. `scope` and `signature_risk` removed.

THE CONSTRAINT THAT SHAPED IT. `getSharedApp` hands every caller the same mutable `App` with no lock, and `lintBuffers` overlays then reverts on it. Impact now calls it twice, so the passes must be serialized — the project READ overlaps the primary lint (pure fs I/O, no App), the lint passes never do. Sabotaging this fails 6 tests, so the corruption is real rather than theoretical.

COST. +248 ms on a typical request against a 2,768-file app, almost entirely the project read. The heaviest file went from 4,658 ms (then `unavailable`) to 230 ms once discovery was bounded by bytes.

TESTS. 4491 across the monorepo. Sabotage across every module — diff, discovery, orchestration, both bounds, the flag — each failing its intended test and only that one. Two sabotages initially did NOT bite and both were fixed: an untested extension guard, and "too much text to examine" being reportable as "no dependants".

VERIFIED, not just written: both auto-eval suites were rewritten and RUN against the built server. 16-impact reports 0 findings across 4 sweeps with every section confirmed to measure real behaviour; 09-graph keeps S09-EDGE-LOST, re-aimed from CONTRACT to MISSED_DETECTION because the false claim it attacked no longer exists.

FOLLOW-UPS: TASK-95 (translation-key edges in platformos-graph) and TASK-88 (dynamic references) widen coverage with no further supervisor work.
<!-- SECTION:FINAL_SUMMARY:END -->
