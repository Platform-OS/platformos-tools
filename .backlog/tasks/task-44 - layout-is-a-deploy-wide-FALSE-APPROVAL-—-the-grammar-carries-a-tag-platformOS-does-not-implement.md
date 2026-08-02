---
id: TASK-44
title: >-
  {% layout %} is a deploy-wide FALSE APPROVAL — the grammar carries a tag
  platformOS does not implement
status: To Do
assignee: []
created_date: '2026-08-02 18:14'
labels:
  - liquid-html-parser
  - false-approval
  - eval-round5
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND5.md
  - packages/liquid-html-parser/grammar/liquid-html.ohm
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
- [ ] #1 A page containing {% layout 'x' %} is reported and BLOCKS, matching what the converter does
- [ ] #2 The message tells the author platformOS has no layout tag, rather than only that parsing failed
- [ ] #3 Both grammar files are updated together and asserted not to diverge
- [ ] #4 Nothing else regresses: prettier-plugin-liquid formatting, the LSP, and MissingContentForLayout are checked rather than assumed unaffected
- [ ] #5 The tag-vocabulary sweep is recorded so 'layout is the only one' is a measured fact in the repo rather than a figure from an external report
<!-- AC:END -->
