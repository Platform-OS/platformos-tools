---
id: TASK-55
title: >-
  Warn on plain YAML scalars that resolve differently in 1.1 and 1.2, so
  ambiguity is authored out rather than reconciled
status: To Do
assignee: []
created_date: '2026-08-03 16:39'
labels:
  - check-common
  - yaml
  - advisory
  - design
dependencies: []
references:
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - packages/platformos-check-common/src/yaml/psych-key-identity.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

The linter parses YAML 1.2 and the platform parses 1.1 (Psych). TASK-43, TASK-50 and TASK-51 each reconciled a specific consequence of that. This is the complementary move: report the ambiguity at the source, so an author can remove it.

The idea came from a review suggestion. Its framing needs one correction, recorded so nobody re-litigates it: this does **not** remove the "one key or two" bug class *by construction*. Existing files still have to be analysed correctly, and authors will not retrofit quotes across a repository. It complements the measured oracle; it does not replace it.

## What it must NOT be

**Not blocking.** `blocksWrite` requires severity `error` AND membership of `BLOCKING_CHECKS`, and membership requires the file to be genuinely broken. An ambiguous plain scalar deploys and renders exactly as its author will observe it — it is the "visibly risky, still a working file" class, alongside `ReservedVariableName` and `TranslationKeyExists`. Severity WARNING, and it must never join `BLOCKING_CHECKS`.

**Not a parse-mode change.** Switching the global parse to `version: '1.1'` was measured and is NOT the fix:

| token | 1.2 (today) | 1.1 | Psych |
|---|---|---|---|
| `yes` `no` `on` `off` | string ✗ | boolean ✓ | boolean |
| `014` | 14 ✗ | 12 ✓ | 12 |
| `y` `Y` `n` `N` | string ✓ | boolean ✗ | string |
| `TrUe` | string ✗ | string ✗ | boolean |
| `1e3` | 1000 ✗ | 1000 ✗ | `"1e3"` |
| `1:30` | `"1:30"` ✗ | 90 ✗ | 5400 |

It fixes five tokens and breaks four — `y`/`n` are correct at 1.2 and wrong at 1.1. Net 11 mismatches to 9. Also measured: `schema: 'yaml-1.1'` and `compat: 'yaml-1.1'` add NOTHING over `version: '1.1'` — all three configurations are byte-identical, because `version` already selects the schema. And no option touches the LEXER, so none of them fix the two false blocks TASK-43/50 addressed.

`1:30` is the case proving no option can work: both parsers produce a number and disagree about which (90 vs 5400).

## The set to report, measured against Ruby

Plain (unquoted) scalars only — a quoted scalar is a String on both sides, and note that npm's `source` EXCLUDES the delimiters, so the discriminator is the scalar's `type`, not its text.

- the six boolean words in ANY casing: `true` `false` `yes` `no` `on` `off`, so `TrUe` and `yEs` count
- `y` `Y` `n` `N` — ambiguous in the other direction: npm 1.1 says boolean, Psych says String
- leading-zero integers (`014`) — 1.1 octal
- `0X`-prefixed hex — Psych leaves uppercase `0X10` a String, npm reads 16
- scientific notation without a dot (`1e3`) — String to Psych, 1000 to npm
- `.inf` / `.nan` in any casing, with optional sign
- sexagesimals (`1:30`)
- bare timestamps (`2026-01-01`) — Ruby's safe loader refuses to build a Date, so which object the platform holds depends on a loader this repo has not established

`src/yaml/psych-key-identity.ts` already carries all of these with their measured Psych resolution; the check should not restate the facts, it should read them or share the patterns with `duplicate-keys.ts`.

## Watch the noise

A translations file legitimately containing keys like `no:`, `on:` or `y:` would light up. Measure the report count over a real project before settling severity and wording — a warning nobody can act on trains authors to ignore warnings. If the count is high, consider scoping to KEYS only, where the duplicate-key consequence actually bites, rather than every value.

## Falsifier

A plain scalar on the list that npm and Psych are measured to resolve identically.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every plain scalar on the measured list is reported, in any casing where Psych is case-insensitive
- [ ] #2 A QUOTED spelling of the same text is silent — the control, decided by the scalar's type rather than its source text
- [ ] #3 Severity is WARNING and the check is absent from BLOCKING_CHECKS, asserted
- [ ] #4 The patterns are shared with duplicate-keys.ts rather than restated, so the two cannot drift
- [ ] #5 The report count is measured over a real project and recorded, so the noise cost is a number rather than a guess
- [ ] #6 If it changes what the MCP server reports, transport/instructions.ts is updated in the same change
<!-- AC:END -->
