---
id: TASK-50
title: >-
  A multi-line quoted YAML scalar is a false block when its continuation is not
  indented deeper than its key
status: To Do
assignee: []
created_date: '2026-08-03 11:14'
labels:
  - check-common
  - false-block
  - yaml
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-check-common/src/yaml/parse.ts
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
- [ ] #1 An aligned multi-line quoted scalar produces no diagnostic, in both quote styles, in every applicable YAML location
- [ ] #2 A continuation at column 0 also produces no diagnostic, matching Psych
- [ ] #3 An UNQUOTED multi-line value STILL blocks — the control, because Psych rejects it too and a fix that swallowed it would trade a false block for a false approval
- [ ] #4 Other genuinely invalid YAML still blocks: unterminated quote on a single line, bad indentation, tab indentation, unclosed flow sequence, compact nested mapping
- [ ] #5 Diagnostic offsets and line/character positions remain correct in the affected files, asserted rather than assumed
- [ ] #6 The 1.2-vs-1.1 reasoning for this mechanism is written down where the parse happens, alongside the line-break note, not in a new module
- [ ] #7 The indentation ladder is a fixture, so the discriminator is repeatable
<!-- AC:END -->
