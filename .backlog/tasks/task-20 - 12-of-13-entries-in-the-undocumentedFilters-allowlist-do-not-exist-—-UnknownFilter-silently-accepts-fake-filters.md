---
id: TASK-20
title: >-
  12 of 13 entries in the undocumentedFilters allowlist do not exist —
  UnknownFilter silently accepts fake filters
status: To Do
assignee: []
created_date: '2026-07-31 12:26'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
dependencies: []
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

## Acceptance criteria

- [ ] The 12 verified-nonexistent filters are removed; `h` is retained
- [ ] `UnknownFilter` now flags `push` and the other 11
- [ ] `h` and genuinely documented filters are still accepted (no over-correction)
- [ ] The surviving list documents how it was verified and how to re-verify
- [ ] No test depended on the removed entries (checked: the `weight` hits in the LSP completion specs are a filter PARAMETER named `weight`, unrelated)
- [ ] check-common, LSP and CLI suites all still pass
<!-- SECTION:DESCRIPTION:END -->
