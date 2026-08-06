---
id: TASK-28
title: >-
  Filter arity is never checked — derive it from the runtime, not from the
  docset's empty parameters array (F-07)
status: Done
assignee: []
created_date: '2026-08-01 11:55'
updated_date: '2026-08-01 23:20'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
dependencies:
  - TASK-20
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

A KNOWN filter called with the wrong number of arguments passes validation and then raises at runtime:

```
{{ 'abc' | slice }}
  validate_code   status=ok, must_fix_before_write=false
  runtime         Liquid::ArgumentError — slice filter - wrong number of
                  arguments (given 1, expected 2..3)
  deployed page   HTTP 500
```

Same for `'abc' | upcase: 1,2,3` (given 4, expected 1) and `'abc' | replace` (given 1, expected 2..3). `UnknownFilter` verifies the NAME and stops.

The asymmetry is the finding: an unknown filter name blocks the write, while a known filter called wrongly — the same class of runtime failure — is approved.

## The evaluation's proposed fix does not work — measured

FINDINGS.md suggests deriving arity "from the docset's existing `parameters` array". That data cannot support it:

```
filters in filters.json     : 167
  with a parameters[] array : 123
  with >=1 required param   : 0      <- nothing is ever marked required
  slice.parameters          : []     <- empty
  replace.parameters        : []     <- empty
```

Nothing is marked required anywhere, and the two filters the evaluation itself cites carry no parameters at all. Building a gate on this would repeat exactly the TASK-20 failure: unverified data driving a write gate, producing confident wrong answers.

## What DOES work: ask the runtime

The runtime states the accepted arity explicitly and machine-readably:

```json
{ "diagnostic": { "type": "Liquid::ArgumentError",
                  "message": "wrong number of arguments (given 1, expected 2..3)" } }
```

So arity can be GENERATED the same way filter existence now is (TASK-20): probe each filter with a deliberately wrong argument count, parse `expected N` / `expected N..M` out of the error, and commit the result as generated data. A filter that renders instead of raising simply has no lower bound to record.

This reuses the generator, its credentials handling and its "candidates may be wrong, only proven facts ship" property.

## Hazards that must be settled before this can block anything

1. **Named arguments.** platformOS filters take keyword-style arguments — `{{ product | image_url: width: 100, height: 200 }}`. Ruby almost certainly counts these as ONE trailing hash argument, not N. Counting AST arguments naively would report `image_url` as over-applied. This must be established empirically before any offense is emitted.
2. **The input counts.** `'abc' | slice` is "given 1", so the piped value is argument one. Off-by-one here turns every correct call into an offense.
3. **Filters with no arity data.** The six undocumented filters (TASK-20) and anything the probe cannot classify must produce NO offense. Unknown must never become a report.
4. **Blocking status.** A wrong-arity call genuinely raises, so it qualifies for the supervisor's `BLOCKING_CHECKS` under the rule in `blocking.ts`. Do NOT add it there until the three hazards above are settled and the false-positive rate is measured against real projects — a blocking check built on shaky arity data is worse than no check.

## Suggested shape

Spike the named-argument semantics first (a handful of `liquid_exec` probes against `image_url` and any other keyword-argument filter). If arity turns out not to be reliably decidable for keyword filters, restrict the check to positional-only filters and record that limitation explicitly rather than guessing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Named-argument filters are probed first and the counting rule is established empirically, not assumed — `{{ product | image_url: width: 100 }}` must not be reported
- [x] #2 Arity data is generated from runtime probes and committed, with the accepted range recorded per filter and the evidence retained
- [x] #3 `{{ 'abc' | slice }}`, `{{ 'abc' | replace }}` and `{{ 'abc' | upcase: 1,2,3 }}` are each reported
- [x] #4 A correctly-called filter of every arity shape (0 extra args, fixed N, ranged N..M, keyword args) produces no offense
- [x] #5 A filter with no arity data — including the six generated undocumented filters — produces no offense rather than a guess
- [x] #6 The check is run over several real projects and the false-positive count is recorded before any decision to make it blocking
- [x] #7 A decision on `BLOCKING_CHECKS` membership is recorded with its rationale; the default is NOT blocking until the measured false-positive rate justifies it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED AFTER VERIFICATION, not on memory of having done it — the status had been left `To Do` after the work landed. Every AC was re-checked against the current build, most of them behaviourally through the real supervisor rather than by reading code.

AC#1 — counting rule established empirically and recorded in the generated file's header:

    given = 1 (piped input) + positional count + 1 if any named argument

The collapse is proven by a case that would be indistinguishable otherwise:
`{{ 'abc' | upcase: a: 1, b: 2, c: 3 }}` reports **given 2**, not 4. `{{ product | image_url: width: 100 }}` is silent, and `{{ 'abcdefgh' | truncate: 5, ellipsis: '.' }}` — a filter that HAS measured arity and takes a named argument, correctly called — is silent.

AC#2 — `src/filter-arity.ts` is generated by `scripts/verify-filter-arity.mjs`, carries its provenance (instance, date, 206 filters measured) and names the 4 it could not determine.

AC#3 — all three cited cases reported: `slice` (given 1), `replace` (given 1), `upcase: 1,2,3` (given 4).

AC#4 — silent for no-extra-args, fixed N, both ends of a ranged N..M, and keyword arguments.

AC#5 — the four undetermined filters (`array_map`, `dig`, `hash_dig`, `map_attributes`) are ABSENT from the data and produce nothing.

ONE CLAUSE OF AC#5 WAS WRITTEN ON A PREMISE THAT DID NOT SURVIVE, and it is worth recording rather than quietly ticking. It asks that 'the six generated undocumented filters' produce no offense, on the assumption they would have no arity data. The generator measured five of them successfully:

```
h     {min:1,max:1}    sum   {min:1,max:2}
has   {min:2,max:3}    where {min:2,max:3}
find  {min:2,max:3}    find_index {min:2,max:3}
```

So `{{ 'a' | has }}` IS reported — given 1 against a measured minimum of 2, which raises at runtime. That is a true positive, not the guess the AC was guarding against. The rule the AC actually protects — unknown must never become a report — holds exactly: only filters with NO measured arity stay silent, and those are the four named above.

I initially scored these four as failures against my own fixture expectations before checking the data. They were fixture errors, not defects — the same mistake the evaluation made twice, caught here by looking at the arity table before reporting.

AC#6 / AC#7 — the false-positive measurement and the blocking decision are both recorded in `supervisor/src/result/blocking.ts` beside the set member, which is where the decision is implemented:

> swept over 8 real projects / ~11k liquid files, producing 2 offenses, BOTH verified true positives (one being `null | hash_merge`, which raises "given 1, expected 2"), and 0 false positives. A filter with no measured arity produces nothing, so the vocabulary gaps that made `UnknownFilter` expensive cannot make this one refuse working code.

That satisfies AC#7's requirement that membership be justified by measured false-positive rate rather than by the severity argument. Round 2 of the evaluation independently audited the data at 569 boundaries (`min-1`, `min`, `max`, `max+1` for all 206 filters): 286/286 true positives, 283/283 true negatives, 0 false blocks, 0 missed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified complete against all seven acceptance criteria and closed; the status had simply been left open after the work landed.

`FilterArity` reports a known filter called with the wrong number of arguments, using arity generated from the runtime's own `Liquid::ArgumentError` complaints rather than the docset's `parameters` array — which the task had already measured as unusable (0 of 167 filters mark anything required). 206 filters measured, 4 undetermined and deliberately absent.

All three hazards the task required settling were settled empirically: named arguments collapse to one trailing hash (`upcase: a:1, b:2, c:3` is given 2, not 4), the piped input counts as argument one, and a filter with no measured arity produces nothing. It is in `BLOCKING_CHECKS` on a measured basis — 8 real projects, ~11k liquid files, 2 offenses, both true positives, 0 false positives — with that evidence recorded beside the set member.

One AC clause rested on a premise that did not survive: it assumed the six undocumented filters would have no arity data, but the generator measured five of them, so `{{ 'a' | has }}` is correctly reported rather than silently passed. The rule it was protecting — unknown must never become a report — holds exactly.
<!-- SECTION:FINAL_SUMMARY:END -->
