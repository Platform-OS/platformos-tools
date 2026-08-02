---
id: TASK-43
title: >-
  The linter parses YAML 1.2 and the platform parses YAML 1.1 — one mismatch,
  three defects
status: To Do
assignee: []
created_date: '2026-08-02 18:14'
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
- [ ] #1 A lone CR no longer blocks: the four YAML types accept a stray \r and a classic-Mac file, matching --dry-run, with diagnostic offsets still correct
- [ ] #2 Key identity for duplicate detection is derived from MEASURED Psych behaviour, not from the YAML spec or the npm parser
- [ ] #3 The measurement is a repeatable generator producing a committed oracle, since Ruby cannot be assumed in CI
- [ ] #4 1: and 1.0: are no longer reported; yes:/true:, TRUE:/true:, 014:/12: and null:/~: ARE reported
- [ ] #5 The wrong reasoning in duplicate-keys.ts is corrected, not just the behaviour — the comment currently states a false premise confidently
- [ ] #6 The 1.2-vs-1.1 mismatch is written down where the parse happens, so future YAML work does not re-derive it
- [ ] #7 No new false block: the round-4/5 silence corpora and the duplicate-key spec pass, and every newly-reported shape is settled against Psych
<!-- AC:END -->
