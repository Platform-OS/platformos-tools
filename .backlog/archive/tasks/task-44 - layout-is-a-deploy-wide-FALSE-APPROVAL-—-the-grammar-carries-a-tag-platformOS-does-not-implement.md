---
id: TASK-44
title: >-
  {% layout %} is a deploy-wide FALSE APPROVAL — the grammar carries a tag
  platformOS does not implement
status: Done
assignee: []
created_date: '2026-08-02 18:14'
updated_date: '2026-08-03 18:16'
labels:
  - liquid-html-parser
  - false-approval
  - eval-round5
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND5.md
  - packages/liquid-html-parser/grammar/liquid-html.ohm
modified_files:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - packages/liquid-html-parser/src/types.ts
  - packages/liquid-html-parser/src/stage-1-cst.ts
  - packages/liquid-html-parser/src/stage-2-ast.ts
  - packages/liquid-html-parser/src/grammar.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/UnknownTag.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/UnknownTag.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/index.spec.ts
  - packages/platformos-language-server-common/src/TypeSystem.ts
  - >-
    packages/platformos-language-server-common/src/completions/providers/ObjectCompletionProvider.spec.ts
  - >-
    packages/platformos-language-server-common/src/hover/providers/LiquidObjectHoverProvider.spec.ts
  - packages/prettier-plugin-liquid/src/printer/print/liquid.ts
  - packages/prettier-plugin-liquid/src/test/liquid-tag-layout/fixed.liquid
  - packages/prettier-plugin-liquid/src/test/liquid-tag-layout/index.spec.ts
  - docs/platformos-gotchas.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`app/views/pages/x.liquid` containing `{% layout 'application' %}` returns `status: ok`, `must_fix_before_write: false`, zero diagnostics. The deploy converter REJECTS it — and a converter rejection fails the **whole changeset**, not just that file. An agent told "write this" takes every other file in the deploy down with it.

`layout` is a Shopify inheritance platformOS does not implement. The grammar has a dedicated rule for it, so the parser accepts it and no check objects.

## Confirmed twice, by two different oracles

Round 5 used `pos-cli deploy --dry-run`: `Content syntax is invalid (Liquid syntax error: Unknown tag 'layout')`.

Independently re-measured here with `liquid_exec`:

```
{% layout 'application' %}hello      -> Liquid syntax error: Unknown tag 'layout'
{% layout 'application' %}           -> Liquid syntax error: Unknown tag 'layout'
{% layout %}hello                    -> Liquid syntax error: Unknown tag 'layout'
{% comment %}control{% endcomment %} -> rendered: OK          (control)
```

Both oracles agree, and the control renders, so the probe is sound.

## Bounded

Round 5 swept the entire tag vocabulary — all 46 names the grammar carries, 38 of which the server accepts — dry-running each individually. **`layout` is the only one.** The exposure is exactly one tag, not a class of them, which makes this cheap to fix and cheap to verify.

## Where it lives

`grammar/liquid-html.ohm`:
- line 82 — `| liquidTagLayout` in the tag alternation
- lines 205-206 — `liquidTagLayout = liquidTagRule<"layout", liquidTagLayoutMarkup>` and its markup rule

Note the grammar exists in TWO files that must not diverge: `liquid-html.ohm` and `liquid-html.ohm.js` (the same text wrapped for bundling — identical line counts today).

## Design question to settle explicitly

Removing the rule makes `{% layout %}` an unknown tag, which `UnknownTag`/`LiquidHTMLSyntaxError` would then report — a BLOCK, matching the converter. That is the desired outcome, but confirm which check fires and that its message names the real problem: an author who wrote `{% layout %}` needs to be told platformOS has no layout tag, not merely that parsing failed.

Also confirm nothing else depends on `liquidTagLayout` — the AST node type, the LSP, prettier-plugin-liquid formatting, and the `MissingContentForLayout` check all touch layout concepts. `{{ content_for_layout }}` (the OBJECT form) renders fine and is unrelated; `{% content_for_layout %}` is already an unknown tag.

## Falsifier

A platformOS instance that accepts `{% layout %}`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A page containing {% layout 'x' %} is reported and BLOCKS, matching what the converter does
- [x] #2 The message tells the author platformOS has no layout tag, rather than only that parsing failed
- [x] #3 Both grammar files are updated together and asserted not to diverge
- [x] #4 Nothing else regresses: prettier-plugin-liquid formatting, the LSP, and MissingContentForLayout are checked rather than assumed unaffected
- [x] #5 The tag-vocabulary sweep is recorded so 'layout is the only one' is a measured fact in the repo rather than a figure from an external report
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`{% layout %}` removed from the grammar, so it is now an unknown tag and BLOCKS —
matching the converter. Five layers moved together, because removing only the
grammar rule leaves the tag "known":

1. `grammar/liquid-html.ohm` — dropped `| liquidTagLayout` from the tag alternation
   and both `liquidTagLayout` / `liquidTagLayoutMarkup` rules. Replaced with a
   comment recording WHY the tag is absent (three oracles) so it is not re-added.
2. `src/types.ts` — removed `NamedTags.layout`. **This is the load-bearing one.**
   `UnknownTag` builds `GRAMMAR_KNOWN_TAGS` from `Object.values(NamedTags)`, so with
   the enum member still present the tag would parse as unknown and then be
   suppressed as known — a silent no-op fix. Sabotage confirms: restoring the member
   fails 6 tests.
3. `src/stage-1-cst.ts` / `src/stage-2-ast.ts` — removed `ConcreteLiquidTagLayout`,
   its CST mapping, `LiquidTagLayout`, and `case NamedTags.layout` in `toNamedLiquidTag`.
4. `prettier-plugin-liquid/print/liquid.ts` — removed the `NamedTags.layout` printer
   case. The tag now falls through to raw-string markup, which the printer emits
   verbatim, so the author's source survives formatting.
5. `UnknownTag.ts` — added `PLATFORMOS_ALTERNATIVE`, a measured remedy table.

## AC#2 — the message

`Unknown tag 'layout'` alone is accurate and useless: it reads as a typo, when the
truth is a missing feature. Message is now:

> Unknown tag 'layout'. platformOS has no layout tag — it selects a layout from the
> page frontmatter instead, e.g. `layout: application`.

The remedy half is measured too, not guessed: the real marketplace app uses
`layout:` frontmatter 11 times and the tag 0 times across 113 Liquid files. Both
halves of an entry must be measured before a name is added — a wrong remedy is
worse than no remedy. Sabotage: deleting the hint fails exactly 1 test, and a
control asserts the hint does NOT attach to other unknown tags.

## AC#3 — the premise is FALSE, and that is the finding

The AC says "both grammar files are updated together and asserted not to diverge".
There is only ONE grammar file under version control. `grammar/liquid-html.ohm.js`
is **gitignored and generated** by `build/shims.js` on `prebuild:ts`. Divergence is
impossible by construction; a test asserting non-divergence would assert that the
build ran. This is the SAME false premise as TASK-45's AC#6 — the external report
inferred two sources of truth from two files on disk. Recorded here so a third round
does not re-file it.

## AC#4 — regressions checked, and one deliberate removal

- `MissingContentForLayout` — fires and stays silent correctly (unrelated: it is
  about `{{ content_for_layout }}`, the OBJECT form, which renders fine).
- prettier — the `liquid-tag-layout` fixture is KEPT, as a data-loss guard: it now
  asserts quote normalisation stops (no AST to normalise from) while whitespace
  normalisation continues, i.e. the author's markup is preserved verbatim.
- LSP — **two features intentionally removed**, not regressions: hover on `none`
  inside `{% layout none %}`, and completing `{% layout non…%}` → `none`. Both
  existed to help an author write a tag that fails the entire deploy. Their absence
  is ASSERTED rather than the tests deleted. `TypeSystem.ts` also carried a dead
  `else if (node.name === 'layout')` branch introducing `none` as a keyword —
  removed. Note it compared a **string**, which is why a `NamedTags.layout` grep did
  not find it; the enum is not a reliable way to find layout handling.
  Frontmatter completion — the correct authoring path — is untouched.

## AC#5 — sweep recorded, with its blind spot

`eval/tag-vocabulary-sweep.mjs` runs the whole grammar vocabulary against
`liquid_exec` and keys on the `Unknown tag 'x'` message, so a bad fixture cannot
produce a false "missing". It documents that `elsif` / `when` / `catch` are FALSE
POSITIVES of the method — a sub-tag outside its parent genuinely is unknown to
Ruby's registry — each re-tested in context and rendering.

## A BETTER ORACLE, found while verifying this

`desksnearme-release-candidate/config/initializers/liquid_view.rb` is the only
non-test file calling `register_tag`: 33 lines listing platformOS's tag additions
(built-ins come from the gem). `layout` is absent — a third independent
confirmation, from the platform's own source.

It is strictly better than any probe because it answers **both** directions.
Diffing it against our vocabulary found 8 registered tags we FALSELY BLOCK
(`context_rc`, `execute_query`, `function_rc`, `query_graph`, `render_form`,
`return_rc`, `sign_in_rc`, `try_rc`) — filed as TASK-56 (High), the opposite
direction from this task. `theme_render_rc` IS in our grammar while the other seven
`_rc` variants are not, which looks accidental rather than considered.

Recorded in the sweep script header and `docs/platformos-gotchas.md` §6.

## Verification

Full monorepo: 309 files / 3167 tests, all passing. Build clean, `format:check`
clean. Both sabotages bite.
<!-- SECTION:NOTES:END -->
