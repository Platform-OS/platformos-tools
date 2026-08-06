---
id: TASK-50
title: >-
  A multi-line quoted YAML scalar is a false block when its continuation is not
  indented deeper than its key
status: Done
assignee: []
created_date: '2026-08-03 11:14'
updated_date: '2026-08-03 14:26'
labels:
  - check-common
  - false-block
  - yaml
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-check-common/src/yaml/parse.ts
modified_files:
  - packages/platformos-check-common/src/yaml/flow-scalar-continuations.ts
  - packages/platformos-check-common/src/yaml/flow-scalar-continuations.spec.ts
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - docs/platformos-gotchas.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Same YAML 1.1-vs-1.2 family as TASK-43, **different mechanism**, and not addressed by the line-break normalisation that task shipped.

npm `yaml` (1.2) requires a flow scalar's continuation line to be indented *more* than its parent key. Psych/libyaml accepts equal or lesser indentation, including column 0. So a translator continuing a long string on the next line, aligned under the key, is a `YAMLSyntaxError` — which BLOCKS — on a file the converter accepts.

The realistic shape is the aligned one. This is not an exotic file.

## Independently re-verified — the indentation ladder plus a control

```yaml
en:
  k: "Hello
  world"
```

| fixture | supervisor | Psych 5.3.1 |
|---|---|---|
| continuation aligned with the key | BLOCKS `Missing closing "quote` | `{"en" => {"k" => "Hello world"}}` |
| continuation at column 0 | BLOCKS | accepted |
| continuation indented DEEPER | ok | accepted |
| **unquoted** multi-line value | BLOCKS | **raises `Psych::SyntaxError`** |

The eval reports `pos-cli deploy --dry-run` ACCEPTED 3/3 for the aligned form.

**That last row is the control and it is what makes this non-vacuous.** An unquoted multi-line value is rejected by Psych too, and the supervisor rejects it — so the check is not simply broken for multi-line values, and a fix must not make it so. Both quote styles are affected (`"…"` and `'…'`); indentation is the discriminator.

Fires in both applicable YAML locations (`app/schema/**`, `app/translations/**`).

## Approach constraints

TASK-43 established that the `version: '1.1'` option does **not** change lexing, only scalar resolution — do not expect it to help here either; measure before assuming.

TASK-43's normalisation is safe specifically because it is **one byte for one byte**, so every diagnostic offset stays valid. Any transformation here must clear the same bar or diagnostics start pointing at the wrong characters. If a source rewrite cannot be offset-preserving, it is the wrong approach — suppressing the specific error class, or reconciling against a second parse, may be better. Decide by measurement.

Read `yaml/line-breaks.ts` and `yaml/parse.ts` first: the dialect mismatch is already documented there and this belongs in the same place, not in a new parallel module.

## Falsifier

A dry run that rejects the aligned buffer, or a Psych load that raises on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An aligned multi-line quoted scalar produces no diagnostic, in both quote styles, in every applicable YAML location
- [x] #2 A continuation at column 0 also produces no diagnostic, matching Psych
- [x] #3 An UNQUOTED multi-line value STILL blocks — the control, because Psych rejects it too and a fix that swallowed it would trade a false block for a false approval
- [x] #4 Other genuinely invalid YAML still blocks: unterminated quote on a single line, bad indentation, tab indentation, unclosed flow sequence, compact nested mapping
- [x] #5 Diagnostic offsets and line/character positions remain correct in the affected files, asserted rather than assumed
- [x] #6 The 1.2-vs-1.1 reasoning for this mechanism is written down where the parse happens, alongside the line-break note, not in a new module
- [x] #7 The indentation ladder is a fixture, so the discriminator is repeatable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Every obvious approach was measured dead before writing anything

| approach | result |
|---|---|
| `version: '1.1'` / `strict: false` | **no effect**, all four combinations. TASK-43 established this for line breaks; this is a different mechanism and was measured separately rather than assumed to match |
| filter the error code | **unsound.** `MISSING_CHAR` is reported for this AND for a genuinely unterminated quote, an unquoted multi-line value, and bad block indentation. Suppressing it buys false approvals on a BLOCKING check |
| reuse the library's CST | **nothing to reuse.** `yaml`'s own `Lexer` has already resolved it the wrong way — it emits `"Hello` as a complete scalar token and `world"` as the next |
| re-indent the continuation | fixes the parse and **shifts every offset** after it, so diagnostics point at the wrong characters |

## What was done instead

The parser's **own error positions** drive a ONE-BYTE-FOR-ONE-BYTE substitution — the line break becomes a space — and the result is accepted only if it then parses cleanly.

Soundness is structural rather than heuristic: the question is never "does this look like the 1.1 shape" but "is the platform's reading of these bytes a valid document". A genuinely unterminated quote has no line break after the error to substitute; a file with a real error never reaches a clean parse.

Byte preservation means every offset in the reconciled document is still an offset into the caller's original source — the same bar `line-breaks.ts` clears, and the reason re-indenting was rejected.

Only ever attempted after the 1.2 parse has already failed, so a healthy file pays nothing. Bounded by the number of line breaks in the file.

## Two things the task did not specify, both found by measurement

**Value fidelity.** The substitution alone leaves the continuation's indentation inside the scalar, so the value comes back `"Hello   world"` where YAML folds to `"Hello world"`. Repaired by re-parsing the ORIGINAL span standalone, which folds correctly because a top-level flow scalar has no parent indentation to be measured against. Verified against Ruby Psych on five shapes, the deciding one being `"trailing  \n  x"` -> `"trailing x"` — both drop the trailing whitespace and fold to one space. Shipping the unfolded value would have put a value in the AST the platform does not have: harmless today, and exactly the confident false premise that produces the next defect.

**`findDuplicateKeys` was still blind.** It parses SEPARATELY from `toYAMLNode` because it needs 1.1 scalar resolution for key identity, so fixing the false block alone left it silently missing duplicates in every file with this shape — a coverage gap the fix would have shipped with. Now reconciled too, using the same function with its own options, which is why `options` is a parameter.

## A design detail worth reviewing

Reconciliation deliberately TOLERATES a mixed error set while it works. `en:\n  k: "Hello\n  world"\n  j: 2\n` reports a `BAD_INDENT` alongside the `MISSING_CHAR` until the substitution is made, and bailing on any non-`MISSING_CHAR` code was itself a false block on a valid file — caught by a fixture, not by reasoning.

It costs no soundness because acceptance is decided by the FINAL parse being clean, never by an intermediate state. Pinned by a test where a tab-indent error sits alongside a valid continuation and still reports.

## Verification

- Full suite **327 files / 3248 tests, exit 0** (+1 file, +20 tests); `yarn build` clean; `format:check` clean.
- YAML specs 40/40: the indentation ladder at all FOUR rungs — deeper, aligned, shallower, column 0 — where the eval had only reported aligned and column 0. "Shallower" had never been probed and behaves the same way.
- 7 must-still-fail controls (unterminated quote, unterminated at EOF, unquoted multi-line, tab indent, unclosed flow sequence, compact nested mapping, sequence item without indicator) plus the mixed real-error case.
- All four admitted YAML types end to end: the aligned form accepted, the unterminated form still blocked.
- Offsets asserted by SLICING the original source at the reported range, so the assertion proves the offset rather than trusting line arithmetic. The duplicate's reported position shifts by exactly the two scalar lines above it.
- **Three sabotages, all bite**: dropping the clean-parse requirement fails 5; skipping the value repair fails 4; removing the error-code gate fails 8.

## Process note

Undoing the second sabotage I ran `git checkout` on `parse.ts`, which carried uncommitted work — it reverted to HEAD and destroyed this task's changes to that file. Rebuilt them, re-verified 40/40, and re-ran that sabotage with a file backup. Nothing was lost but a cycle. Sabotage restores use file copies only from here.

## Docs

Gotchas §2 gained "A quoted string may be continued at ANY indentation, including column 0", as a sibling of the lone-`\r` note since both fall out of the same 1.1-vs-1.2 split. It carries the two traps for anyone writing tooling: the error code is not diagnostic, and joining lines gives the wrong value because folding drops the continuation's leading whitespace.
<!-- SECTION:NOTES:END -->
