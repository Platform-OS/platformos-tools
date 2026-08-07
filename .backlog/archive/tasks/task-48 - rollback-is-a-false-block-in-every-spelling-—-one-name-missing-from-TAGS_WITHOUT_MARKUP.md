---
id: TASK-48
title: >-
  {% rollback %} is a false block in every spelling — one name missing from
  TAGS_WITHOUT_MARKUP
status: Done
assignee: []
created_date: '2026-08-03 11:13'
updated_date: '2026-08-03 13:51'
labels:
  - liquid-html-parser
  - false-block
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/liquid-html-parser/src/grammar.ts
modified_files:
  - packages/liquid-html-parser/src/grammar.ts
  - packages/liquid-html-parser/src/grammar.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidTagSyntax.spec.ts
  - docs/platformos-gotchas.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`{% rollback %}` is refused by the write gate. The converter accepts it, bare and inside a `{% transaction %}` block. A false block is unappealable, and the diagnostic is self-refuting:

```
LiquidHTMLSyntaxError: Invalid syntax for tag 'rollback' Expected syntax: rollback
```

It says the expected syntax is exactly what was written.

## Cause, and the exact bound

The grammar rule is `liquidTagRollback = liquidTagRule<"rollback", empty>`, so the AST markup is `""` — a string, but legitimately empty. `InvalidTagSyntax` uses "markup is a string" as its tolerant-fallback signal and exempts an allowlist:

```ts
// packages/liquid-html-parser/src/grammar.ts:50
export const TAGS_WITHOUT_MARKUP = ['else', 'break', 'continue', 'comment', 'raw', 'doc', 'try'];
```

The grammar has **exactly five** tags whose markup rule is `empty` — `try` (254), `rollback` (310), `break` (365), `continue` (366), `else` (367). Four are on the allowlist. `rollback` is the only one missing, and no other tag can be in this state.

## Independently re-verified

Every spelling blocks: `{% rollback %}`, `{%rollback%}`, `{%- rollback -%}`, and inside a transaction. Controls `{% try %}x{% endtry %}` and `{% break %}` both pass, which is what localises the defect to the missing name rather than to the fallback logic.

## Note on scope — do not fold this in

`{% transaction t %}x{% endtransaction %}` also blocks (*"Expected syntax: transaction timeout: 5"*) while `{% transaction %}` and `{% transaction timeout: 5 %}` pass. That is a positional-argument shape and belongs to the argument-value class, not here. It is unsettled — it needs a converter adjudication before anyone changes it.

## Why the check, not the grammar

The grammar is correct: `rollback` genuinely takes no markup. Fixing this in the grammar would be treating a symptom. `TAGS_WITHOUT_MARKUP` is the parser's own declaration of which tags legitimately have empty markup, and it is shared by `InvalidTagSyntax` and `UnknownTag` — it is the right place, and it is exported from `liquid-html-parser`, so `check-common` needs no change.

## Falsifier

A dry run that rejects `{% rollback %}`, or a `rollback` node whose markup is not a string.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 {% rollback %} produces no diagnostic, in every spelling including {%rollback%}, {%- rollback -%}, inside {% liquid %} and inside a transaction block
- [x] #2 The four tags already on the allowlist still produce no diagnostic — controls, so a wider change is visible
- [x] #3 A tag that genuinely HAS malformed markup still reports — the suppression must not widen into a real defect
- [x] #4 The allowlist is asserted against the grammar's own set of empty-markup tags, so a future empty-markup tag cannot be silently omitted the same way
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Fixed the defect CLASS, not the instance

`TAGS_WITHOUT_MARKUP` was the one hand-maintained outlier in `grammar.ts` — `BLOCKS`, `RAW_TAGS` and `VOID_ELEMENTS` are all derived from the grammar by introspection. That is exactly why it drifted. It is now derived too, so the next `liquidTagRule<"x", empty>` is exempt the moment it is written and this cannot recur.

The derivation yields exactly `break, continue, else, rollback, try` — independently confirming the eval's "exactly five, four on the list" bound, and agreeing across all three grammar modes.

The raw-content group (`comment`, `raw`, `doc`) stays EXPLICIT. Those are declared through `liquidRawTag` and `liquidDoc`, so no single derivation covers both groups, and it is deliberately not spliced from `RAW_TAGS`: that would couple a list gating a BLOCKING check to one maintained for a different purpose, so a change there would silently change what this exempts.

## Two implementation traps, both hit

**`Object.keys` returned an EMPTY list.** Ohm chains grammars through the prototype, so `StrictLiquidHTML.rules` has only two own keys and inherits the rest. `for..in` is required. An empty list here is silently catastrophic — `InvalidTagSyntax` would refuse `{% else %}`, `{% break %}`, `{% continue %}` and `{% try %}` on every use, and `UnknownTag` builds its known-tag vocabulary from the same list. That is why the spec pins the exact names rather than asserting the list is non-empty.

**Avoided `constructor.name`**, which minification would mangle in the webpack-bundled VS Code extension. Duck-typed on the Ohm node shape instead — an `Apply` carries `ruleName`, a `Terminal` carries `obj` — which is also why the three existing constants avoid it.

## Measurement corrected my own expectation

I predicted `{% rollback something %}` would be refused by the platform, which would have made this exemption a false-block-for-false-approval trade. It is not. Measured: the platform **IGNORES** stray markup on these tags. `{% rollback something %}` raises `ActiveRecord::Rollback` exactly like the clean form — the rollback happens — and `{% break something %}`, `{% continue junk %}`, `{% else junk %}` all render. So not blocking it is correct, and `rollback` now behaves exactly like its four already-exempt siblings.

## The eval framed this as a converter question; it is not

`liquid_exec` PARSES `{% rollback %}` in every spelling. The raises are SEMANTIC: "rollback performed outside of transaction" on its own, `ActiveRecord::Rollback` inside a transaction — which is the tag working. A `{% no_such_tag_xyz %}` control confirms the probe does surface real syntax errors (`Liquid syntax error: Unknown tag`).

Worth recording for the next person: `ActiveRecord::Rollback` surfacing from `liquid_exec` is SUCCESS. Scoring any raise as a failure marks the working case broken.

## One consequence accepted and documented

`markup()` in stage 2 returns `''` for every tag on this list, so stray text is dropped from the AST and the printer reduces `{% rollback something %}` to `{% rollback %}`. This is NOT the TASK-49 data-loss class: the dropped text is provably inert (measured above), so nothing the platform reads is lost, and `break`/`continue`/`else` have always behaved this way. The alternative — keeping `rollback` off the list — reinstates an unappealable false block on a valid tag, which is strictly worse. Recorded in the source so a future reader does not read it as a hole.

## Confirmed unaffected

- **`UnknownTag` vocabulary**: `rollback` was already in `NamedTags`, so `GRAMMAR_KNOWN_TAGS` already contained it. Adding it here is a no-op for that check.
- **AST**: `{% rollback %}` markup was already `''` because the grammar rule is `empty`, so the node is unchanged — verified, and identical in shape to `break` and `try`.
- **LSP**: no language-server file touched, vocabulary unchanged, AST unchanged.

## Verification

- Full suite **326 files / 3228 tests, exit 0** (+16, matching the tests added); `yarn build` clean; `format:check` clean.
- `grammar.spec.ts` 6/6 — derivation pinned BY NAME, agreement across strict/tolerant/placeholder, plus a vacuity control asserting tags that DO take markup are absent.
- `InvalidTagSyntax.spec.ts` 53/53, including 12 no-markup spellings and the counter-intuitive stray-markup case.
- 16/16 end-to-end supervisor probes, including four "genuinely malformed still reports" controls (`{% assign x "v" %}`, `{% render %}`, unknown tag).
- **Two sabotages, both bite**: the `Object.keys` mistake fails 8 tests; dropping the `empty` filter so every named tag is exempt fails 12, including the vacuity control.

## Docs

Gotchas gained §8, "Tags that take no markup — and one that raises anyway", covering the ignored-stray-markup behaviour and the `rollback`-outside-a-transaction trap.

Also merged a DUPLICATE `hash_assign` bracket subsection in §1. The older copy claimed the rule was "enforced by the converter rather than the runtime", which the TASK-49 measurement disproves — it is a parse error, so both. Kept the accurate version and folded in the two points only the old one made.

## Follow-up filed

TASK-54: `{% rollback %}` outside a transaction always raises and nothing reports it. Deliberately out of scope here — this task fixed the syntax false block; that is the semantic half, and it needs the partial-inherits-caller's-transaction question settled before it can report safely.
<!-- SECTION:NOTES:END -->
