---
id: TASK-49
title: >-
  The formatter rewrites a hash_assign bracket target into dot access, which the
  converter rejects — silent data loss plus a standing false approval
status: Done
assignee: []
created_date: '2026-08-03 11:14'
updated_date: '2026-08-03 12:47'
labels:
  - prettier-plugin-liquid
  - check-common
  - false-approval
  - data-loss
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/prettier-plugin-liquid/src/printer/printer-liquid-html.ts
modified_files:
  - packages/prettier-plugin-liquid/src/printer/printer-liquid-html.ts
  - packages/prettier-plugin-liquid/src/test/liquid-tag-hash-assign/index.liquid
  - packages/prettier-plugin-liquid/src/test/liquid-tag-hash-assign/fixed.liquid
  - >-
    packages/prettier-plugin-liquid/src/test/liquid-tag-hash-assign/index.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidHashAssignTargetSyntax.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidHashAssignTargetSyntax.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/index.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - docs/platformos-gotchas.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why — this is two defects sharing one root, and the pair is worse than either

The platform accepts only the **bracket** form of a `hash_assign` assignment target. `pos-cli deploy --dry-run` rejects the dot form:

```
Liquid syntax error: Syntax Error in 'hash_assign' - Valid syntax: hash_assign hash[key] = value
```

A converter rejection fails the **whole changeset**, not one file.

**Defect 1 — the formatter converts valid code into rejected code, silently.** `prettier-plugin-liquid` regenerates source from the AST; its `VariableLookup` printer prefers dot access for any string lookup matching its identifier test, and it does not know that a `hash_assign` target is a position where brackets are load-bearing. So a file that validates clean, is written, and is formatted on save becomes undeployable with **no error at any layer**. That is the failure mode the methodology ranks above a false block: a false block is loud and recoverable, this is not.

**Defect 2 — the dot form written by hand is APPROVED.** `{% hash_assign h.k = 1 %}` returns `status: ok, must_fix_before_write: false`. `InvalidHashAssignTarget` models "Hash with a key, Array with a numeric index" — the container/subscript **type** relationship — and does not model which target **syntax** the platform accepts. So the supervisor also has a standing false approval with a whole-changeset blast radius, independent of the formatter.

Fixing only the printer leaves defect 2. Fixing only the check leaves the formatter producing a file the check then correctly blocks — better, but still data loss on the author's source.

## Independently re-verified — the formatter, both prettier majors, identical output

```
{% hash_assign h['k'] = 1 %}       ->  {% hash_assign h.k = 1 %}       REWRITTEN
{% hash_assign h['a']['b'] = 1 %}  ->  {% hash_assign h.a.b = 1 %}     REWRITTEN, every level
{% hash_assign h['k-1'] = 1 %}     ->  unchanged                        (non-identifier key)
{% hash_assign a[0] = 1 %}         ->  unchanged                        (numeric index)
```

The rewrite fires when the key matches the printer's identifier test (`/^\D/` and `/^[a-z0-9_]+\??$/i`) — the ordinary case.

## Independently re-verified — the check

```
{% assign h = '{}' | parse_json %}{% hash_assign h.k = 1 %}     ok, block=false   <- FALSE APPROVAL
{% assign h = '{}' | parse_json %}{% hash_assign h['k'] = 1 %}  ok, block=false   <- correct
{% assign a = '1,2' | split: ',' %}{% hash_assign a.k = 1 %}    BLOCKS, but for the WRONG reason
```

That third row matters: it blocks with *"Cannot use hash_assign on 'a' with a string key, because it is an Array"* — it read `.k` as a string key and happened to land on a block. A fix must not rely on that accident.

## Bound

The eval swept all 46 grammar tag names through the formatter: `hash_assign` is the **only** tag whose approved form is mangled. 112 approved cases through both prettier majors produced exactly one MANGLED verdict, zero crashes and zero non-idempotent results.

## Responsibility separation — where each half belongs

- The printer bug is `prettier-plugin-liquid`'s. It must preserve brackets inside a `hash_assign` target regardless of the key's shape, because the position — not the key — is what makes brackets required.
- The syntax rule is `check-common`'s. Whether it belongs in `InvalidHashAssignTarget` or a sibling check is an implementation decision, but note that `InvalidHashAssignTarget` is in `BLOCKING_CHECKS` and blocking membership requires severity `error` AND membership; a deploy-wide rejection clears the highest bar in the membership rule.
- The supervisor needs **no change** and must stay a thin layer.

Check `AugmentedPlatformOSDocset` and the existing `hash_assign` machinery before adding anything — the type inference already exists and this is a syntax question, so it may not belong in the same code path at all.

## Falsifier

A prettier build whose `VariableLookup` printer preserves brackets inside `HashAssignMarkup`, or a converter that accepts `hash_assign h.k = 1`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A hash_assign bracket target survives formatting byte-for-byte under both prettier 2.x and 3.x, at every nesting level
- [x] #2 Numeric indices and non-identifier keys still format unchanged — controls, so the fix is not a blanket disabling of dot access
- [x] #3 Dot access is still printed where it is CORRECT (ordinary variable lookups, {{ }} output, other tags) — the printer change must be scoped to the position, not global
- [x] #4 A hand-written {% hash_assign h.k = 1 %} is reported and BLOCKS, because the converter rejects it and takes the whole changeset
- [x] #5 The Array-with-string-key case still blocks, and its message is not the accidental one that reads .k as a string key
- [x] #6 The bracket form is still approved — the control proving the new rule did not swallow the valid syntax
- [x] #7 Round-trip is asserted as a fixture: format the approved corpus and diff, so a future printer change cannot silently reintroduce data loss
- [x] #8 If the syntax rule lands in check-common, transport/instructions.ts is updated in the same change and the language server is not regressed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## It is worse than the eval established, and the rule is positional

Two things settled with a second oracle before writing any code.

**Parse-time, not just deploy-time.** The eval had this as a converter rejection. `liquid_exec` gives the identical message — `Liquid::SyntaxError: Syntax Error in 'hash_assign' - Valid syntax: hash_assign hash[key] = value` — so the template cannot be RENDERED either. Deploy-fatal *and* render-fatal, with the bracket form rendering `1` as its control.

**Only the LAST subscript must be a bracket.** 12 target shapes measured, each reading the value back so "accepted" means the assignment actually happened rather than merely that it parsed:

| accepted | rejected |
|---|---|
| `h['k']`, `h["k"]`, `h[k]`, `h[0]`, `h['k-1']`, `h['a']['b']`, **`h.a['b']`** | `h.k`, `h.a.b`, **`h['a'].b`** |

`h.a['b']` works and `h['a'].b` does not, so "no dots in a target" would have been a false block on working code — on a check that BLOCKS, which is the most expensive mistake available. The rule had to be measured; grammar symmetry would have given the wrong answer again.

## Where each half landed, and why

**Printer** — `prettier-plugin-liquid` no longer applies its "prefer direct access" normalisation inside a `hash_assign` target. Scoped to the POSITION, not the tag: `{% hash_assign h['k'] = h['j'] %}` keeps the target's brackets and still normalises the value to `h.j`.

`path.getParentNode()` rather than the augmented `node.parentNode`, because `ParentNode` by construction only covers nodes that can HAVE children and a `HashAssignMarkup` is not one. Using the print-time parent is the right API rather than a cast around a deliberately narrow type.

**Check** — a new `detectInvalidHashAssignTargetSyntax` sub-detector in `liquid-html-syntax-error`, joining its 13 siblings. That placement is the point: it rides the already-blocking `LiquidHTMLSyntaxError`, so there is no new `BLOCKING_CHECKS` entry, no new factory config, and no second code path.

**NOT in `InvalidHashAssignTarget`.** That check answers a TYPE question and necessarily stays silent when it cannot infer one — a render argument, a module value, a variable assigned in another file. This defect does not depend on the type: `{% hash_assign mystery.k = 1 %}` cannot be parsed whatever the variable holds. Verified it now fires there; inside the type check it would have been silent exactly when the author most needs it.

**Supervisor unchanged**, as required — it stays a thin layer and picks the diagnostic up for free.

## The decision that needs a reviewer's eye

Each lookup's ORIGINAL notation is deliberately not preserved, so `h.a['b']` normalises to `h['a']['b']` and an invalid `h.k` becomes `h['k']`.

The gentler alternative needs a dot-vs-bracket signal on the node, and the only one available is that `dotLookup` builds a `String` with no `single` field while `LiquidString.single` is declared `boolean`, **not optional**. That difference is a pre-existing type violation rather than a contract: nothing stops the parser from filling `single` in as a tidy-up, and this printer would then silently start emitting dots in targets and reintroduce the syntax error. Always-brackets depends on nothing fragile.

The detector reads notation from **source positions** instead — load-bearing, documented, and used by every check in the package. The last delimiter in the gap before a lookup decides it, which is what tells `][` (bracket chain) from `].` (bracket then dot) apart.

## AC#5 — both checks fire on `a.k`, kept deliberately

For `{% assign a = '1,2' | split: ',' %}{% hash_assign a.k = 1 %}` both `LiquidHTMLSyntaxError` (notation) and `InvalidHashAssignTarget` (Array + string key) report. Not suppressed: each message is accurate about its own concern, and the author gets both facts in one pass instead of fixing the syntax, re-validating, and then meeting the type error. The misleading-as-sole-message problem the AC describes is gone, because the real cause is now reported alongside.

## Verification

- Full suite **326 files / 3212 tests, exit 0**; `yarn build` clean; `format:check` clean.
- 13/13 end-to-end supervisor probes match the measured runtime, including whitespace variants — `h [ 'k' ]` accepted, `h . k` rejected — and the unknown-container case.
- Detector spec 5/5. **Three sabotages, all bite**: inverted notation test -> all 5 fail; report-any-dot -> ONLY the silence control fails, which is the false-block direction; detector unwired -> 3 fail.
- Round-trip fixture `liquid-tag-hash-assign` formats `index.liquid` LIVE rather than comparing against the committed `fixed.liquid`, so it fails both on a printer regression and on a bad expectation — `fixed.liquid` was generated by the formatter and on its own could only prove stability. Removing the printer guard fails 2 of its 3 tests. It also asserts a non-vacuous count (9 targets) so the fixture cannot quietly lose its tags.
- The scoping control: dot access is still preferred in `{{ }}`, `assign`, `if` and `echo`.
- **LSP not regressed.** No language-server file touched, and no parser code changed this pass, so `VariableShapeExtractor` — which does read `hash_assign` targets — sees an identical AST. It gains the new diagnostic.

## Negative result worth keeping

The eval swept 46 tag NAMES through the formatter, but the `{% export %}` corruption found in TASK-47 lived inside a tag body, so that sweep had a gap. Swept 14 further lookup positions here (`assign`, `parse_json`, `session`, `export`, `capture`, `increment`, `for … in`, `function`/`graphql` arguments, `cache`, `log`, `redirect_to`, `response_status`, and a `hash_assign` VALUE): **no other reshaping hazard**. Every change is a read, where `h['k']` and `h.k` are genuinely interchangeable.
<!-- SECTION:NOTES:END -->
