---
id: TASK-43
title: >-
  The linter parses YAML 1.2 and the platform parses YAML 1.1 — one mismatch,
  three defects
status: Done
assignee: []
created_date: '2026-08-02 18:14'
updated_date: '2026-08-02 22:10'
labels:
  - check-common
  - false-block
  - yaml
  - eval-round5
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND5.md
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
modified_files:
  - packages/platformos-check-common/src/yaml/line-breaks.ts
  - packages/platformos-check-common/src/yaml/line-breaks.spec.ts
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.spec.ts
  - packages/platformos-check-common/src/yaml/psych-key-identity.ts
  - packages/platformos-check-common/scripts/verify-yaml-key-identity.mjs
  - packages/platformos-check-common/src/checks/duplicate-yaml-key/index.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The root cause

`check-common` parses YAML with npm `yaml`, which implements **YAML 1.2**. The platform parses with Ruby **Psych/libyaml**, which implements **YAML 1.1**. Nobody wrote that sentence down, and round 5 found three defects falling out of it in three different directions.

Patching the three symptoms leaves the next piece of YAML reasoning to inherit the same mismatch.

## The three defects

**R5-01 — lone `\r` is a FALSE BLOCK (HIGH).** npm `yaml` does not treat a lone CR as a line break; libyaml does. `a: 1\rb: 2\n` — a single stray CR in an otherwise normal LF file, i.e. a paste artefact — is read as one long line and reported `YAMLSyntaxError: Nested mappings are not allowed in compact mappings`, which BLOCKS. `--dry-run` accepts it in all four YAML types (20/20 probes).

Measured here: `parseDocument` returns `BLOCK_AS_IMPLICIT_KEY` for that input, and **`version: '1.1'` does not fix it** — the version option does not change line-break lexing. Psych parses the same bytes as `{"a"=>1, "b"=>2}`.

Note the irony: `utils/position.ts` was rewritten in TASK-35 *specifically* so a lone `\r` counts as a line terminator. The position layer models these files; the parse layer refuses them, in the same package.

**R5-04 — `1:` and `1.0:` reported as duplicates (LOW, false positive).** `identityOf` in `duplicate-keys.ts` returns `` `${typeof value} ${String(value)}` ``. In JS both are `number` and `String()` yields `"1"`. Ruby keeps two keys — `Integer(1)` and `Float(1.0)`, measured size 2. Nothing is discarded, so the advisory is wrong and invites deleting working code.

**R5-05 — `yes:` / `true:` silence rests on WRONG REASONING (LOW, missed detection).** `duplicate-keys.ts` documents these as deliberately not-a-duplicate because "YAML 1.2 resolves `yes` to a string and `true` to a boolean". That is true of the npm parser and false of the platform: Psych resolves `yes` to boolean `true`, so `{true=>"b"}`, size 1. A value IS silently discarded and the check stays quiet — while documenting that the silence is correct.

## Measured Psych behaviour (local, Psych 5.3.1)

Round 5 found two mismatches; measuring the neighbourhood found **more**, which is the argument against fixing case-by-case:

| keys | Ruby size | note |
|---|---|---|
| `yes:` / `true:` | **1** | collide — missed today |
| `TRUE:` / `true:` | **1** | collide — missed today, NOT in the round-5 report |
| `014:` / `12:` | **1** | YAML 1.1 octal — missed today, NOT in the report |
| `null:` / `~:` | **1** | collide — missed today, NOT in the report |
| `1:` / `1.0:` | 2 | distinct — FALSE POSITIVE today |
| `1:30:` / `90:` | 2 | 1.1 sexagesimal makes `1:30` = 5400 |
| `+1:` / `1:` | 1 | collide — correctly reported today |
| `0x10:` / `16:` | 1 | collide — correctly reported today |
| `1:` / `"1":` | 2 | distinct — correctly silent today |
| `on:` / `off:` | 2 | both booleans, different values |
| `y:` / `n:` | 2 | strings in Psych, despite the 1.1 spec |

`y`/`n` being strings is the reason this must be MEASURED rather than derived from the YAML 1.1 spec — Psych does not implement the spec's full boolean set.

## Approach

The identity rules must come from Ruby, not from reading the spec or the npm parser's behaviour. Ruby is not guaranteed in CI, so follow the established generator pattern (`verify-filter-arity`, `verify-undocumented-filters`): a script runs Psych over a corpus, commits an oracle, and a hermetic spec asserts the implementation agrees with it.

`key.source` exposes the raw scalar text, so `1` vs `1.0` is recoverable without changing the global parse.

## Explicitly NOT in scope here

Switching `toYAMLNode` to `version: '1.1'` globally. It would make scalar resolution match the platform, but it changes what EVERY YAML check sees — a translation key literally named `yes` would become boolean `true`. That is a separate decision with its own blast radius and needs its own measurement.

## Oracles

Ruby Psych for key identity and parse acceptance; `pos-cli deploy --dry-run` for whether a file deploys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A lone CR no longer blocks: the four YAML types accept a stray \r and a classic-Mac file, matching --dry-run, with diagnostic offsets still correct
- [x] #2 Key identity for duplicate detection is derived from MEASURED Psych behaviour, not from the YAML spec or the npm parser
- [x] #3 The measurement is a repeatable generator producing a committed oracle, since Ruby cannot be assumed in CI
- [x] #4 1: and 1.0: are no longer reported; yes:/true:, TRUE:/true:, 014:/12: and null:/~: ARE reported
- [x] #5 The wrong reasoning in duplicate-keys.ts is corrected, not just the behaviour — the comment currently states a false premise confidently
- [x] #6 The 1.2-vs-1.1 mismatch is written down where the parse happens, so future YAML work does not re-derive it
- [x] #7 No new false block: the round-4/5 silence corpora and the duplicate-key spec pass, and every newly-reported shape is settled against Psych
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What shipped

### AC#1 — the lone-CR false block

`yaml/line-breaks.ts` normalizes every LONE `\r` to `\n` before `parseDocument`, leaving `\r\n` alone.

The substitution is **one byte for one byte**, which is the whole reason it is allowed: every offset in the document is unchanged, so diagnostics computed against the ORIGINAL source still point at the right characters. `utils/position.ts` already treats a lone `\r` as a line terminator (TASK-35), so line/character numbers stay consistent too. Nothing downstream needs to know.

`parseDocument(source, { version: '1.1' })` was tried first and **does not fix this** — measured. The version option changes scalar RESOLUTION, not the lexer's notion of a line break. There is no option that does.

Verified post-merge against the built package, with a control:

```
stray CR       a: 1\rb: 2\n        -> OK
classic mac    a: 1\rb: 2\rc: 3\r  -> OK
control        a: [1, 2\n          -> still errors
```

The control matters: a normalization wide enough to swallow real syntax errors would satisfy the first two lines on its own.

### AC#2/#3 — identity measured, not derived

`scripts/verify-yaml-key-identity.mjs` spawns Ruby, resolves **61 key tokens** through Psych, and commits `src/yaml/psych-key-identity.ts` (`{ klass, value }` per token). The hermetic spec asserts the TypeScript implementation agrees with that oracle, so CI never needs Ruby — the established `verify-filter-arity` / `verify-undocumented-filters` pattern.

The generator itself had a bug worth recording: the Ruby snippet was built with `#{'#{tok}'}`, so the interpolation was consumed by the wrong language and **all 61 tokens resolved to the literal string `#{tok}`**. It produced a plausible, wholly fictitious oracle. Fixed by string concatenation instead of interpolation. A generator that can silently produce a uniform answer is a generator that needs a shape assertion.

### AC#4 — verified post-merge against the built package

| keys | reported | expected |
|---|---|---|
| `yes:` / `true:` | 1 | 1 |
| `TRUE:` / `true:` | 1 | 1 |
| `014:` / `12:` | 1 | 1 |
| `null:` / `~:` | 1 | 1 |
| `1:` / `1.0:` | **0** | 0 (was a false positive) |
| `+1:` / `1:` | 1 | 1 |
| `0x10:` / `16:` | 1 | 1 |
| `1:` / `"1":` | 0 | 0 |
| `y:` / `n:` | 0 | 0 (Psych makes these strings) |

`1:30:` / `5400:` is the ONE known incompleteness — YAML 1.1 sexagesimal. It is not silently absent: the spec pins the missed set to exactly `['1:30 + 5400']`, so if the set ever grows, a test fails.

### AC#5 — the reasoning, not just the behaviour

`duplicate-keys.ts` previously documented `yes:`/`true:` as deliberately-not-a-duplicate because "YAML 1.2 resolves `yes` to a string". True of npm `yaml`, false of the platform. That comment is replaced with the measured Psych behaviour and a pointer to the oracle.

`identityOf` now:
- parses at `version: '1.1'`,
- keys off `pair.key.source` (raw scalar text) so `1` and `1.0` stay distinct,
- carries an `UNCOMPARABLE` list of token shapes whose Psych identity is not reproducible from the npm parser's value, which are skipped rather than guessed — that is where soundness comes from,
- guards the merge key on **source** `<<`, not on value, because at version 1.1 the merge key's value comes back `undefined` (found by test, not by reading).

### AC#6 — written down where the parse happens

The 1.2-vs-1.1 sentence now leads the file comment in `line-breaks.ts` and is restated in `duplicate-keys.ts`, so the next piece of YAML work does not re-derive it.

### AC#7 — no new false block

The spec runs a **3540-ordered-pair soundness sweep** over the oracle corpus and asserts ZERO false positives — a duplicate reported where Psych keeps two keys is a false advisory that invites deleting working code, so it is the property that gets the exhaustive treatment. Completeness is pinned separately and exactly.

## Sabotage / vacuity

One parse-guard test was found **vacuous**: the "broken YAML is ignored" fixture contained nothing to report, so deleting the guard failed nothing. Rewritten with a real duplicate present plus a control proving the duplicate is findable when the file parses.

## Verification

Full suite green after a clean rebuild: **323 test files / 3192 tests, exit 0**; `yarn build` 0 errors; `format:check` clean. AC#1 and AC#4 re-probed against the built `dist` after the merge, as recorded above.

## Deliberately still out of scope

Switching `toYAMLNode` to `version: '1.1'` globally. It would change what EVERY YAML check sees — a translation key literally named `yes` would become boolean `true`. Separate decision, separate blast radius, needs its own measurement.
<!-- SECTION:NOTES:END -->
