---
id: TASK-28
title: >-
  Filter arity is never checked — derive it from the runtime, not from the
  docset's empty parameters array (F-07)
status: To Do
assignee: []
created_date: '2026-08-01 11:55'
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
- [ ] #1 Named-argument filters are probed first and the counting rule is established empirically, not assumed — `{{ product | image_url: width: 100 }}` must not be reported
- [ ] #2 Arity data is generated from runtime probes and committed, with the accepted range recorded per filter and the evidence retained
- [ ] #3 `{{ 'abc' | slice }}`, `{{ 'abc' | replace }}` and `{{ 'abc' | upcase: 1,2,3 }}` are each reported
- [ ] #4 A correctly-called filter of every arity shape (0 extra args, fixed N, ranged N..M, keyword args) produces no offense
- [ ] #5 A filter with no arity data — including the six generated undocumented filters — produces no offense rather than a guess
- [ ] #6 The check is run over several real projects and the false-positive count is recorded before any decision to make it blocking
- [ ] #7 A decision on `BLOCKING_CHECKS` membership is recorded with its rationale; the default is NOT blocking until the measured false-positive rate justifies it
<!-- AC:END -->
