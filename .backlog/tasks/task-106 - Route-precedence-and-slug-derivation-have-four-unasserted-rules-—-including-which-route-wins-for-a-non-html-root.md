---
id: TASK-106
title: >-
  Route precedence and slug derivation have four unasserted rules — including
  which route wins for a non-html root
status: Done
assignee: []
created_date: '2026-09-05 16:07'
updated_date: '2026-09-06 12:55'
labels:
  - testing
  - platformos-common
  - route-table
  - mutation-testing
dependencies: []
references:
  - packages/platformos-common/src/route-table/parseSlug.ts
  - packages/platformos-common/src/route-table/parseSlug.spec.ts
  - packages/platformos-common/src/route-table/slugFromFilePath.ts
  - packages/platformos-common/src/route-table/slugFromFilePath.spec.ts
modified_files:
  - packages/platformos-common/src/route-table/slugFromFilePath.spec.ts
priority: medium
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Stryker run over `platformos-common/src/route-table/{parseSlug,slugFromFilePath}.ts` scored 87.80% across 254 mutants and found NO user-facing malfunction. It did find four rules that can be changed with every test still green. Precedence decides WHICH ROUTE WINS for a URL, so a regression in it is user-visible as the wrong page being served, and nothing would catch it.

Each item below was verified by applying the change by hand and running the suite — the mutation report alone was not trusted, and see the OUT OF SCOPE note for why.

1. THE ROOT CASE IGNORES FORMAT, UNASSERTED. In `calculatePrecedence`, the `slug === '/'` branch
   ends with `if (format === 'html') precedence += 1`. Making that unconditional leaves all 25
   `parseSlug.spec.ts` tests passing. Every existing precedence test uses a non-root slug, or
   root with html. The untested case is a ROOT PAGE IN A NON-HTML FORMAT — `index.json.liquid`
   derives slug `/` with format `json`, and should score -99 rather than -98.

2. WILDCARD WEIGHTING IS ENTIRELY UNTESTED. Emptying the `} else if (part.startsWith('*'))` branch,
   so a `*` segment contributes 0 instead of 10 (or 1 inside an optional group), leaves all 25
   passing. No precedence test uses a wildcard at all.

   Note while there: that branch is character-for-character identical to the `:param` branch above
   it, and the function's docblock lists weights for "Static/hardcoded: 100" and "Required
   parameter (:param): 10" but says nothing about wildcards. Whether a wildcard really scores like
   a param is an interpretation of the Ruby original, not a documented rule. Worth settling in the
   docblock when the test is written.

3. THE FRONTMATTER `format` OVERRIDE IS UNEXERCISED. In `effectivePageSlug`, making
   `typeof frontmatter?.format === 'string' && frontmatter.format` always falsy — so the override
   is ignored and the format always comes from the filename — leaves all 103 route-table tests
   passing. MEASURED that it does change the answer: `data.json.liquid` with `format: html` in
   frontmatter yields slug `data.json`, and without the override `data`.

4. `formatFromFilePath`'s `lastDot > 0` GUARD IS UNTESTED — 6 mutants on that one condition,
   including `lastDot >= 0` and replacing the whole condition with `true`. The guard is what stops
   a filename that is nothing but an extension being read as that format: without it,
   `.json.liquid` reports format `json` instead of `html`.

OUT OF SCOPE, checked and set aside so nobody re-investigates:

  - The format-in-last-component adjustment (`dotIdx > 0 && dotIdx < cleanLast.length - 1`) IS
    covered. The mutation report showed the whole condition surviving as `true`; applying that by
    hand fails 6 tests. The real survivor is a narrower sub-condition. Read report `replacement`
    fields as a hint, not a fact.
  - `.html.liquid` derives an EMPTY slug, which `parseSlug` and `calculatePrecedence` both treat as
    root — it would collide with `index.liquid` at an identical precedence of -98. It is
    UNREACHABLE: `app/walk.ts`'s `collectFiles` skips any entry whose basename starts with `.`,
    files included, before the directory branch. Latent, not live.
  - `parseSegment`'s trailing-`)` strip is NOT dead code. It is reached by a malformed slug where
    `)` precedes any `(` — `weird)/x` parses to `static('weird')`.

CONTEXT FOR WHOEVER PICKS THIS UP: route precedence is what TASK-75 (MissingPage parameterized-route
near misses) and TASK-76 (removing MissingPage suppressions) reason about, so pinning these rules
first makes that work safer. Stryker is not part of this repository and is not needed — every item
names the exact change that survives today, so apply it by hand, write the test, watch it fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `calculatePrecedence` is asserted for a ROOT slug with a non-html format, distinguishing it from the html root — the two must not score the same
- [x] #2 `calculatePrecedence` is asserted for a wildcard segment, both required (`files/*`) and inside an optional group (`files(/*)`), so the weight and the optional-group discount are both pinned
- [x] #3 The wildcard's weight is stated in the `calculatePrecedence` docblock alongside the static and `:param` weights, or the docblock says it is an interpretation of the Ruby original if that cannot be confirmed
- [x] #4 `effectivePageSlug` is asserted with a frontmatter `format` override that DISAGREES with the filename extension, so the override is shown to win — for example `data.json.liquid` with `format: html`
- [x] #5 A control asserts the override is ignored when it is absent or not a string, so the test cannot pass against code that always prefers frontmatter
- [x] #6 `formatFromFilePath` is asserted for a filename that is nothing but an extension (`.json.liquid`), pinning that it reports `html` and not `json`
- [x] #7 SABOTAGE-VERIFIED for each: the exact change named in the description fails the new test afterwards, and no other test changes result; reverted, suites green
- [x] #8 platformos-common suite passes, plus type-check and format:check
- [x] #9 No source behaviour change — this task adds assertions and at most a docblock line; if any behaviour is found to be wrong while writing them, it is raised separately rather than fixed here
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check which items TASK-107 already closed rather than re-testing them — sabotage the html adjustment and see whether 107's table catches it.
2. For the rest, verify the BEHAVIOUR against the engine before pinning it: slice `Page.default_routing_options` out of `page.rb`, run it under Ruby, compare across twelve path/format combinations.
3. Pin only what the engine confirms; raise what it contradicts rather than asserting either side.
4. Sabotage the three mutations that previously survived; confirm the change is spec-only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ITEM 2 IS NOW A CONFIRMED DEFECT, NOT AN INTERPRETATION — see TASK-107. With the platform engine source to hand, the wildcard weighting was checked against the real `slug_components_weighted_size` extracted from `app/models/router/route_builder/route.rb` and run under Ruby. The platform has only two branches, `:param` and everything-else-100; a `*` falls to the `else` and scores 100, where the tools score it 10 (or 1 optional). Five of fourteen slugs diverge, all of them wildcards.

DO TASK-107 FIRST. Writing item 2's test here would pin the WRONG numbers. Once 107 lands, item 2 of this task is satisfied by 107's own assertions and can be struck.

THE OTHER THREE ITEMS STAND, and the same differential confirmed the surrounding behaviour is faithful: the nine non-wildcard slugs agree with the engine exactly, including the optional-group discount, the format-in-last-component adjustment and the root special case. So items 1, 3 and 4 are genuine coverage gaps over CORRECT behaviour — tests to write, nothing to fix.

ALSO CHECKED WHILE THERE, and not a defect: the rule ORDER in `slugFromFilePath` differs from the Ruby. The platform runs index -> home -> strip `/index`; the port runs index -> strip `/index` -> home. The two middle rules are disjoint (`home` exactly versus ends-with-`/index`), so no input distinguishes them — `home/index` gives `home` either way.

ITEMS 1 AND 2 WERE ALREADY CLOSED BY TASK-107, verified rather than assumed. 107's engine table carries both `['/', 'html', -98]` and `['/', 'json', -99]`, so the non-html root is covered; making the html adjustment unconditional now fails four tests including that table. Item 2 (wildcards) was fixed outright there.

THE TWO REMAINING ITEMS WERE CHECKED AGAINST THE ENGINE BEFORE BEING PINNED, which changed the outcome. `Page.default_routing_options` was sliced out of `app/models/page.rb` and run under Ruby over twelve path/format pairs. ELEVEN MATCH — including the deprecated `home` alias, `blog/home` not being the alias, `home/index` stripping to `home`, an unknown format supplied via frontmatter still stripping, and `.json.liquid`. So the behaviour these tests pin is confirmed correct, not merely current.

ONE ROW DISAGREES and is deliberately NOT in the table: `data.json.liquid` with no frontmatter format gives `data` here and `data.json` in the engine, because the tools derive format from the filename and the engine appears to use the frontmatter value only. Raised as TASK-108 with the evidence and, explicitly, the limits of it — no `spec/` in the checkout, and the page `model_hash` assembly not traced end to end. Pinning that row either way would have asserted a guess.

WHY THE EXISTING OVERRIDE TESTS DID NOT BITE, which is the same fixture problem as B1 in TASK-103: `effectivePageSlug('api/data.liquid', { format: 'json' })` and `effectivePageSlug('data.json', { format: 'json' })` both use paths where the override AGREES with the filename, so they pass unchanged when the override is ignored entirely. The discriminating case is `data.json.liquid` with `format: html` — override says `data.json`, filename says `data` — and the engine confirms `data.json`.

AC#6 IS CORRECT BEHAVIOUR, not just current: `File.extname('.json')` is `''` in Ruby, so a leading dot starts a name rather than an extension, and the engine calls `.json.liquid` html too. The `lastDot > 0` guard is the equivalent of that rule.

SABOTAGE, all three previously-surviving mutations now caught:
  frontmatter override ignored          -> 1 test
  `lastDot > 0` -> `lastDot >= 0`       -> 2 tests
  whole format guard -> `true`          -> 2 tests

Spec-only, confirmed by `git diff --name-only`: 40 insertions in one file, no source touched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Four unasserted rules, closed — two of them by TASK-107, two here, and one turned out to be a question rather than a gap.

**Items 1 and 2 were already covered by 107** and I confirmed that rather than duplicating work: its engine-measured table carries both root formats, and making the html adjustment unconditional now fails four tests.

**The two remaining items are pinned against the engine, not against current behaviour.** `Page.default_routing_options` was sliced out of `app/models/page.rb` and run under Ruby across twelve path/format pairs; eleven match, so the new table asserts confirmed-correct behaviour — the deprecated `home` alias, `blog/home` not being it, `home/index` stripping to `home`, an unknown format via frontmatter still stripping, and `.json.liquid` reporting html.

**The existing override tests were vacuous, in the same way B1 was.** Both used paths where the frontmatter format agrees with the filename, so they passed when the override was ignored outright. The new table uses `data.json.liquid` with `format: html`, where the two disagree — and the engine confirms the override wins.

**One row is deliberately absent.** `data.json.liquid` with no frontmatter format gives `data` here and `data.json` in the engine. Raised as **TASK-108**, with the limits of the evidence stated plainly: no `spec/` in the checkout, and the page `model_hash` assembly not traced end to end. Asserting either answer would have pinned a guess, so the test comment says the row is omitted and why.

**Verification.** All three previously-surviving mutations now fail: the ignored override (1 test), `lastDot >= 0` (2), and the whole guard as `true` (2). Spec-only — 40 insertions in one file, no source touched, per AC#9. 2716/2716 across 152 files in platformos-common, check-common, check-node and graph; type-check and prettier clean.
<!-- SECTION:FINAL_SUMMARY:END -->
