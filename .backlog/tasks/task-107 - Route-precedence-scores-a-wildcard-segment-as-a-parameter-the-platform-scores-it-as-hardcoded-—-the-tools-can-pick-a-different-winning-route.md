---
id: TASK-107
title: >-
  Route precedence scores a wildcard segment as a parameter; the platform scores
  it as hardcoded — the tools can pick a different winning route
status: Done
assignee: []
created_date: '2026-09-05 18:59'
updated_date: '2026-09-06 12:42'
labels:
  - bug
  - platformos-common
  - route-table
  - correctness
  - platform-divergence
dependencies: []
references:
  - packages/platformos-common/src/route-table/parseSlug.ts
  - packages/platformos-common/src/route-table/RouteTable.ts
  - app/models/router/route_builder/route.rb (platform engine)
  - app/validators/page_slug_validator.rb (platform engine)
modified_files:
  - packages/platformos-common/src/route-table/parseSlug.ts
  - packages/platformos-common/src/route-table/parseSlug.spec.ts
  - .changeset/route-precedence-matches-the-engine.md
priority: medium
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`calculatePrecedence` in `platformos-common/src/route-table/parseSlug.ts` gives a `*` segment the weight of a `:param` — 10, or 1 inside an optional group. The platform gives it 100, the weight of a hardcoded component.

VERIFIED AGAINST THE ENGINE, not against a reading of it. The platform's own
`slug_components_weighted_size` was extracted from
`app/models/router/route_builder/route.rb` BY CONCATENATION (not retyped) into a standalone
harness and run under real Ruby, then compared with the shipped `calculatePrecedence`. Its two
branches are the whole story:

    slug.split(%r{\(?/}).inject(0) do |acc, el|
      acc += if el.start_with?(':')
               el.end_with?(')') ? 1 : 10
             else
               100
             end
    end

There is no wildcard case. A `*` does not start with `:`, so it falls to `else` and scores 100.
The TypeScript port added a third branch that treats `*` like `:`.

DIFFERENTIAL, format `html`, 14 slugs — 5 diverge and every one contains `*`:

    slug                     tools      platform
    files/*                  -10999     -19999
    files(/*)                -10099     -19999
    a/*/b                    -20999     -29999
    users(/section/*)        -20099     -29999
    *                        -999       -9999
    users/:id                -10999     -10999     (agree)
    users/:id(/:action)      -11099     -11099     (agree)
    users/section/1          -29999     -29999     (agree)
    users(/:id)              -10099     -10099     (agree)
    a(/b)(/c)                -29999     -29999     (agree)
    users/data.json          -20000     -20000     (agree)
    data.json                -10000     -10000     (agree)
    blog/:year/:month        -11999     -11999     (agree)
    /                        -98        -98        (agree)

The nine agreeing rows matter as much as the five: they include the optional-group discount, the
format-in-last-component adjustment and the root special case, so the port is faithful everywhere
except the wildcard.

WHY IT IS A DEFECT AND NOT A STYLE DIFFERENCE. `RouteTable` sorts candidate routes by precedence
ascending — lowest number wins — at `RouteTable.ts:361` and `:392`. The tools score a wildcard
route far LESS negative than the platform does, so they rank it lower than the engine does. Given
`files/*` and `users/:id`, the platform prefers `files/*` (-19999 against -10999); the tools score
both -10999 and fall back to sort order. Any consumer that asks "which page serves this URL" can
therefore get a different answer than the engine gives, which is what `MissingPage` reasons about
(TASK-75, TASK-76).

REACHABLE THROUGH ORDINARY CONFIG. A `*` in a page slug passes both platform validators:
`PageSlugValidator` only rejects reserved prefixes and the `/(/` double slash, and
`UrlPathValidator` accepts `*` because `URI.parse` does. The tools also model wildcards
deliberately — `parseSegment` returns `{ type: 'wildcard' }` and the `parseSlug` docblock gives
`users(/section/*)` as an example — so this is a supported shape scored wrongly, not an
unsupported one.

HOW IT WAS FOUND: a Stryker run flagged the wildcard branch as entirely untested (emptying it
leaves all 25 `parseSlug.spec.ts` tests passing). The mutation run only pointed at the area; the
defect came from then comparing against the engine.

TO RE-RUN THE DIFFERENTIAL: extract `slug_components_weighted_size` from the platform's
`route.rb` by string slicing rather than retyping it, assert the extraction is not degenerate,
splice it into a small Ruby class alongside the `calculate_precedence` adjustments from the same
file, and compare against `calculatePrecedence` over a slug corpus. Retyping the method by hand
would test the transcription rather than the engine.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `calculatePrecedence` scores a `*` segment as 100, matching the platform, for a required wildcard (`files/*`) and one inside an optional group (`files(/*)`)
- [x] #2 A test asserts the exact precedence for at least the five slugs measured as diverging, with the values the platform produces
- [x] #3 The nine slugs measured as already agreeing keep their current scores, asserted in the same place so the fix cannot silently move them
- [x] #4 The `calculatePrecedence` docblock states that a wildcard is weighted as hardcoded and that the platform has no wildcard case — its `else` branch is what scores it
- [x] #5 SABOTAGE-VERIFIED: restoring the `*` branch to the param weighting fails the new assertions; reverted afterwards and the suite is green
- [x] #6 The optional-group discount is confirmed NOT to apply to a wildcard — the platform scores `files(/*)` and `files/*` identically at -19999
- [x] #7 platformos-common suite passes, plus type-check and format:check
- [x] #8 A changeset accompanies the change, stating that route ordering shifts for any app whose page slug contains a wildcard
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a real oracle before touching anything: slice the engine's `slug_components_weighted_size`, `calculate_precedence`, `slug_components` and `format_from_last_component` out of `route.rb` by string index (never retyped), shape-assert each extraction, splice into a Ruby harness.
2. Run a corpus wide enough to find what a 14-slug probe would miss — 40 slugs across statics, params, optional groups, wildcards, dots, roots and malformed shapes, in html and non-html.
3. Fix what the differential shows, not what the task assumed.
4. Sabotage each cause independently; run every downstream package; re-run the full differential last.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THE TASK UNDERSTATED THE PROBLEM AND THE WIDER CORPUS IS WHY. Filed as one defect (the wildcard), measured on 14 slugs. Run against 40 slugs x 2 formats, 30 of 80 pairs disagreed with the engine, in FOUR distinct ways:

  A wildcard scored as a param      20 cases   a/* -10999 vs -19999
  B empty components skipped         6 cases   a//b -19999 vs -29999
  C bare trailing dot not a format   2 cases   a. -9999 vs -10000
  D empty slug treated as root       2 cases   '' -98 vs -99

Fixing only A would have shipped a function still wrong three ways, in the same twenty lines. All four are now fixed together, because the honest change is 'make the port faithful', not 'patch the branch the task named'.

THE TRAP THAT WOULD HAVE BROKEN A PASSING CASE: `RUBY'S String#split DROPS TRAILING EMPTY FIELDS AND JAVASCRIPT'S DOES NOT`. The obvious fix for B is deleting the `if (part.length === 0) continue`, and that alone would have made `a/` score 200 where the engine scores 100 — breaking a case that currently AGREES. Verified with `ruby -e` on the split itself before writing the loop. The port now pops trailing empties explicitly and scores leading and interior ones, which is exactly Ruby's behaviour.

D FELL OUT FOR FREE AND IS CONFIRMED BY THE ENGINE'S OWN CONSTANT: `ROOT_SLUGS = %w[/]`, so `''` is not root there. With the trailing-empty pop in place, `''` splits to nothing, hits `weighted_size.zero? -> 1`, and lands on -99 with no special case — so the whole root early-return could be deleted rather than corrected. `/` still scores -98 through the general path.

C WAS MEASURED, NOT ASSUMED: `File.extname('a.')` is `"."` under the platform's Ruby, `File.extname('.hidden')` is `""`. The port required a non-empty extension; dropping that condition matches both.

REACHABILITY CHECKED AGAINST THE PLATFORM'S OWN VALIDATORS, by running them: `a/*`, `a//b`, `a.` and `''` all pass `UrlPathValidator` and `PageSlugValidator`. `/a` does not (leading slash), so that row is faithful-but-unreachable and is not in the test table.

SABOTAGE, five variants, each caught: wildcard back to param weight (1 test), trailing-empty pop removed (3 tests), interior empties skipped again (1 test), trailing dot excluded again (1 test), empty slug treated as root again (1 test).

NET EFFECT ON THE FILE: 17 lines in, 25 out. The root special case, the `*` branch and the `continue` all disappear, leaving a loop with the same two cases the engine has.

VERIFICATION: differential 0 of 80 after (30 before). platformos-common + check-common + check-node + graph 2714/2714 across 152 files; language-server-common + mcp-supervisor 1144/1144 across 91. The 103 pre-existing route-table tests passed unchanged throughout, which is the control that no already-correct score moved.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`calculatePrecedence` now scores every slug the way the platform engine does — verified by running the engine's own Ruby, not by reading it.

**Scope grew, on evidence.** The task was filed as one defect (wildcards scored as parameters) from a 14-slug probe. Against a 40-slug corpus in both formats, **30 of 80 pairs disagreed with the engine in four distinct ways**: the wildcard weighting, empty path components being skipped, a bare trailing dot not counting as a format, and an empty slug being treated as root. Fixing only the wildcard would have left the same twenty lines wrong three other ways.

**The fix is a faithful port, not a patch.** The root special case, the `*` branch and the `continue` all disappear; what remains is the two cases the engine actually has — `:param` at 10 (1 inside a group), everything else at 100. Net 17 lines in, 25 out.

**One trap worth naming:** Ruby's `String#split` drops trailing empty fields and JavaScript's keeps them. The obvious fix for the empty-component bug — deleting the `continue` — would have made `a/` score 200 against the engine's 100, breaking a case that already agreed. The port now pops trailing empties explicitly.

**Reachability was checked by running the platform's own validators:** `a/*`, `a//b`, `a.` and `''` are all accepted slugs. `/a` is rejected for its leading slash, so it stays out of the test table as faithful-but-unreachable.

**Tests bite.** A sixteen-row table asserts the engine's measured values for every diverging shape plus the controls that must not move, in one whole-value equality that names the offending row on failure. Five sabotage variants — one per cause, two for the split behaviour — each fail it.

**Verification.** Differential 0 of 80 after, 30 before. platformos-common + check-common + check-node + graph 2714/2714 across 152 files; language-server-common + mcp-supervisor 1144/1144 across 91. The 103 pre-existing route-table tests passed unchanged throughout — the control proving no already-correct score moved. Type-check and prettier clean. Changeset is `minor` and states which slug shapes shift.

**Knock-on:** TASK-106's item 2 is now satisfied here and can be struck; its other three items stand.
<!-- SECTION:FINAL_SUMMARY:END -->
