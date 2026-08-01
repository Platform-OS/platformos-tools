---
id: TASK-20
title: >-
  12 of 13 entries in the undocumentedFilters allowlist do not exist —
  UnknownFilter silently accepts fake filters
status: Done
assignee: []
created_date: '2026-07-31 12:26'
updated_date: '2026-08-01 11:27'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
dependencies: []
modified_files:
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.ts
  - packages/platformos-check-common/src/undocumented-filters.ts
  - packages/platformos-check-common/src/undocumented-filters.spec.ts
  - packages/platformos-check-common/scripts/verify-undocumented-filters.mjs
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The evaluating agent reported that `{{ 'a' | push: 1 }}` passes the linter but raises `Liquid::UndefinedFilter — undefined filter push` at runtime, while siblings (`pop`, `shift`, `unshift`, `sum`, `pluck`) are correctly rejected.

`push` is in `undocumentedFilters` in `AugmentedPlatformOSDocset.ts` — a hardcoded allowlist described as "Filters that are valid in platformOS but not yet in the official docs". `UnknownFilter` consults the augmented docset, so anything on this list is accepted unconditionally.

Rather than remove the one reported entry, the WHOLE list was verified against a live platformOS instance via `liquid_exec`:

| filter | runtime |
|---|---|
| `debug` | undefined |
| `distance_from` | undefined |
| `encode_url_component` | undefined |
| `excerpt` | undefined |
| `format_code` | undefined |
| `h` | **EXISTS** |
| `handle_from` | undefined |
| `pad_spaces` | undefined |
| `paragraphize` | undefined |
| `push` | undefined |
| `sentence` | undefined |
| `unit` | undefined |
| `weight` | undefined |

**12 of 13 are fake.** Only `h` is real.

## Root cause

These are Shopify / Jekyll filter names (`handle_from`, `paragraphize`, `excerpt`, `pad_spaces`, `distance_from`, `weight`, `unit`, …). This repo is a fork of Shopify's Theme Tools, and the list was evidently carried over during the fork and never validated against platformOS. `push` was added separately in a one-line commit titled "Cleanup" with no test and no rationale.

The deeper problem is that the list is an **unverifiable assertion**: each entry claims "this filter is valid" with no provenance, no test, and no way for a reader to check. It cannot be validated from inside the linter, which is offline and browser-safe by design.

## Impact

Backwards: `UnknownFilter` is one of the checks in the supervisor's BLOCKING set (TASK-19), so a fake filter is not merely un-flagged — it is silently blessed by the write gate. An agent gets `must_fix_before_write: false` for a template that will raise at runtime. This is the same false-approval class as TASK-13/TASK-18, arriving through the docset instead.

## Fix

1. Remove the 12 verified-nonexistent entries; keep `h`.
2. Give the list PROVENANCE so it cannot silently rot again: document how each surviving entry was verified, and record the exact reproduction procedure (`liquid_exec` against a live instance) in the file so the next person can re-run it in minutes.

Do NOT add runtime verification to the linter itself — network calls from a browser-safe, offline lint engine would be a far worse defect than the one being fixed. The list stays static; what changes is that it is now evidence-backed and re-checkable.

## Caveats to record

- Verified against one live instance (`ps-01`). Filters are core platform rather than module-provided, so one instance is representative, and the `push` finding was independently corroborated by the evaluating agent.
- `undocumentedTags` (`elsif`, `ifchanged`, `when`) is a different situation and is CORRECT: `ifchanged` was verified to exist, and `elsif`/`when` are inner tags of `if`/`case` that legitimately do not appear in the docs as standalone entries.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The 12 verified-nonexistent filters are removed; `h` is retained
- [x] #2 `UnknownFilter` now flags `push` and the other 11
- [x] #3 `h` and genuinely documented filters are still accepted (no over-correction)
- [x] #4 The surviving list documents how it was verified and how to re-verify
- [x] #5 No test depended on the removed entries (checked: the `weight` hits in the LSP completion specs are a filter PARAMETER named `weight`, unrelated)
- [x] #6 check-common, LSP and CLI suites all still pass
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Both directions were wrong, and the list is now generated rather than typed

Probed every candidate against a live instance (`fk-docs.ps-01-platformos.com`) via `liquid_exec`, using `diagnostic.type === 'Liquid::UndefinedFilter'` as the discriminator — a filter that exists but rejects the arguments raises something else, so this distinguishes "absent" from "misused".

**12 of 13 hardcoded entries did not exist** — every one a FALSE APPROVAL, since a name on this list silences `UnknownFilter`:

```
drop  debug, distance_from, encode_url_component, excerpt, format_code,
      handle_from, pad_spaces, paragraphize, push, sentence, unit, weight
KEEP  h  -> rendered "abc"
```

**5 real filters were MISSING** — the opposite failure. They are in neither `name` nor `aliases` in `filters.json`, so `UnknownFilter` fired, and because the supervisor treats it as blocking, working code was refused:

```
KEEP  sum -> "6"   where -> "[{k:1}]"   find -> "{k:2}"   find_index -> "1"   has -> "true"
```

## Root cause, and why a corrected list was not enough

Hand-typing is unverifiable, so it rots silently — 92% of the entries were wrong and nothing could tell. Replacing 13 bad names with 6 good ones would have left that mechanism intact.

The list is now GENERATED by `scripts/verify-undocumented-filters.mjs`, which asks a live instance. The safety property is that candidates are ALLOWED to be wrong: a name reaches the output only if the runtime proves it exists AND `filters.json` does not already document it. A mistaken guess is dropped, so adding a candidate can no longer break the write gate — it can only fail to help. All 13 original names are retained as candidates so regenerating re-proves their removal rather than forgetting they were claimed.

Not run in CI (needs instance credentials); output is committed, matching check-node's generated factory configs.

## Source of truth

Not the docs API. `filters.json` has exactly 167 entries and is demonstrably incomplete — all six surviving filters are absent from it. Only the runtime can answer "does this filter exist", so the generator asks the runtime.

(This also explains an apparent contradiction with the evaluation's "0 of 167 bundled filters are missing from the instance": its sweep covered exactly those 167 documented filters. The hand-typed array was never in it.)

## Left untouched, per review

`expandAliases` (correct — the 39 aliases are declared in `filters.json` on 37 parent entries and merely promoted to lookup-able entries), `normalizeDeprecation` (real upstream data bug, correctly patched), and `undocumentedTags` (`elsif`/`ifchanged`/`when` — independently probed, all three real and absent from `tags.json`; load-bearing for case/if parsing).

## Verification

4 unit tests pin the exact set, name each of the 12 fictional filters individually, assert no entry duplicates a documented name or alias, and assert the list actually reaches the docset (otherwise deleting the spread would break every filter unnoticed). Sabotage-checked: re-adding `push` fails 2 of them.

End to end against the real server — the gate flips in both directions and the control still holds:

```
sum / where / find / find_index / has / h   must_fix=false   (were blocked)
push + the other 11 fictional               must_fix=true    UnknownFilter (were approved)
no_such_filter_xyz (control)                must_fix=true    UnknownFilter
```
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`undocumentedFilters` was a hand-typed array injected into the docset to silence `UnknownFilter`. Probing a live instance showed it was wrong in both directions: 12 of its 13 entries did not exist (false approvals — `{{ 'a' | push: 1 }}` cleared the write gate and raised `Liquid::UndefinedFilter` at runtime), while five real filters were missing from it entirely (false blocks — `sum`, `where`, `find`, `find_index`, `has` all work but were refused, and `UnknownFilter` is a blocking check).

Fixed by making the list generated instead of typed. `scripts/verify-undocumented-filters.mjs` asks a live instance whether each candidate exists and emits only what the runtime proves, excluding anything the docs already document. Candidates are allowed to be wrong — that is the point: a bad guess is dropped rather than shipped, so this cannot rot the same way again. The docs API is not the source of truth here and cannot be, since `filters.json` (167 entries) omits all six real filters.

The list went from 13 hand-typed names to 6 verified ones. `expandAliases`, `normalizeDeprecation` and `undocumentedTags` were reviewed and deliberately left alone.
<!-- SECTION:FINAL_SUMMARY:END -->
