---
id: TASK-85
title: >-
  signature_risk answers "every caller matches" when no caller was visible to
  check
status: Done
assignee: []
created_date: '2026-08-22 18:58'
updated_date: '2026-08-22 18:59'
labels:
  - mcp-supervisor
  - correctness
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
priority: medium
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`impact.signature_risk` is three-valued by design: absent means this file publishes no parameter contract, an empty array means checked-and-every-caller-matches, and a populated array names the callers that will break.

Sending one logical change as several calls makes the middle value a lie. A partial edited alone, with a `@param` made newly required — a breaking change — answered:

```jsonc
"impact": { "status": "computed",
            "dependents": { "total": 0, "by_kind": {}, "sample": [] },
            "signature_risk": [] }
```

That empty array reads as an affirmative all-clear. It was produced because the only caller was in a different call, so nothing was checked at all. An absent answer would have been better than a false one.

## Scope, and what it is NOT

The blast radius itself is left alone. `dependents` is a true statement about the project as it stands, and a file that is not yet on disk is the NORMAL case for this tool — the server's own instructions tell an agent to call it before the write. Returning `not_applicable` for every not-yet-written file would degrade the primary flow to fix a narrow one; the sharp edge is the affirmative, not the count.

So: withhold `signature_risk` when no dependents were found AND the file is not on disk. Send the whole change in one call and the caller is visible again, at which point the answer is earned.

## Reference

`UPSTREAM-ISSUES-VERIFIED.md` issue 8.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`signature_risk` is now withheld when no caller was visible to check it against — no dependents found and the file not on disk.

The first cut returned `not_applicable` for that whole case, following the sketch in the audit. Running the suite showed why that is wrong: three stdio integration tests cover an agent validating a layout it is about to write, which is the tool's PRIMARY flow — the instructions say to call it before the write, so "not on disk" is the normal state, not an anomaly. Suppressing the blast radius there degrades the common case to fix a narrow one. The audit's own analysis says as much: *"The sharper edge is `signature_risk`, not `total`."* The fix was narrowed to the affirmative.

`dependents` and `status` are untouched in every case. Only the empty list that claims "checked, every caller matches" is withheld, falling back to absent, which the type doc and the server instructions now both explain.

Four sabotages bite: removing the guard, inverting it to disk-only (so a caller supplied by the changeset stops counting), widening it to suppress every signature check (7 failures — the proof it is not over-broad), and deleting the instructions claim.

Supervisor suite 475 passed. One incidental tidy: `runImpact` had a local copy of the zeroed-dependents shape that `result/impact-states.ts` already exports as `NOT_APPLICABLE_IMPACT`; it now uses the factory.
<!-- SECTION:FINAL_SUMMARY:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A file not on disk, with a doc contract and no dependents found, omits signature_risk instead of returning an empty list
- [x] #2 The same file ON disk with no callers earns the empty list, and with a breaking caller still names that caller, both asserted as controls
- [x] #3 A multi-file call where the changeset itself supplies the caller answers in full, including a populated signature_risk
- [x] #4 dependents and status are unchanged in every case, so the primary before-the-write flow keeps its blast radius
- [x] #5 A buffer declaring no doc block still omits signature_risk, so absence does not become a signal that something was withheld
- [x] #6 The server instructions state that an absent signature_risk is not every-caller-matches, pinned by a test
- [x] #7 Sabotage-verified in both directions: removing the guard, and widening it to suppress everything
<!-- AC:END -->
