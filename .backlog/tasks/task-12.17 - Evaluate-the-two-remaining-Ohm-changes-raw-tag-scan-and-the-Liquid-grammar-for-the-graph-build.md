---
id: TASK-12.17
title: >-
  Evaluate the two remaining Ohm changes: raw-tag scan, and the Liquid grammar
  for the graph build
status: To Do
assignee: []
created_date: '2026-07-30 00:23'
labels:
  - performance
  - liquid-html-parser
  - platformos-graph
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-12.14 took only the two CST-identical lookahead guards from the reviewed patch (`patch/liquid-html-ohm-guards.patch`, verifier at `patch/verify-ohm-guards.js`). Two further changes were measured and deliberately deferred, each for a different reason.

**1. Raw-tag body scan.** `HtmlRawTagImpl<name>` scans `<script>`/`<style>`/`<svg>` bodies with `AnyExceptPlus<(TagStart<name> | TagEnd<name>)>`, attempting `TagStart<name> = "<" name AttrList ">"` — a full attribute-list parse — at every character inside the block. The patch replaces it with a lexical two-character lookahead (`rawTagText<name>`).

Measured on our corpora it added only **+0.06x** over the guards (1.61x → 1.67x on 1392 files), because our projects are liquid-logic-dense rather than script/style-heavy. The reviewer measured 3.8x on an SVG icon partial and 4.1x on a page with an inline script, so the win is real but concentrated in files we have few of.

It is also the one change that is NOT CST-preserving: `rawTagText` replaces an `AnyExceptPlus` application, and in lexical context whitespace inside the body becomes iteration children rather than being skipped. Before taking it, check the `liquidRawTagImpl` / `HtmlRawTagImpl` visitor in `stage-1-cst.ts` (the mapping reads `body: 9`) — if it consumes `.sourceString` it is safe, if it walks children positionally it is not. Gate on the same evidence as 12.14: sha1 CST fingerprints, offense parity including ranges on three real projects, and the prettier-plugin-liquid suite, which formats these blocks.

**2. `buildAppGraph` using the `Liquid` grammar instead of `LiquidHTML`.** Every edge the graph needs (`render`, `include`, `function`, `graphql`, `background`, layout, asset) is a liquid tag, and the `Liquid` grammar parses HTML-bearing files fine — markup falls into `TextNode`. Measured: **12.26 s vs 14.22 s** on 1392 files (1.16x over guards alone), and the reviewer measured 2.7x on their corpus.

The blocker is not performance but semantics: under `Liquid` the corpus had **0 parse failures versus 6 under `LiquidHTML`**. Those 6 files currently contribute NO edges (their parse fails, so traversal finds nothing); with the `Liquid` grammar they would parse and contribute edges, changing `dependentsOf` answers and therefore blast radius. That is arguably a bug fix — a file with malformed HTML still has real render edges — but it IS a behaviour change and must be verified deliberately, not slipped in as a perf tweak.

Also worth checking before switching: whether the graph extracts anything from HTML attributes (asset references in `<script src>`, `<img src>`, `<link href>`). If it does, the `Liquid` grammar would silently lose those edges — the opposite failure from the one above.

**Also from this work:** `patch/verify-ohm-guards.js` is a ready-made CST-identity + timing harness that exits non-zero on divergence. Consider adopting it (or its fingerprint approach) as a committed guard so a future grammar change cannot silently move source intervals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Raw-tag change: the `HtmlRawTagImpl` CST visitor is inspected and a decision recorded on whether the shape change is safe, BEFORE any measurement is used to justify shipping
- [ ] #2 Raw-tag change: if taken, sha1 CST fingerprints, offense parity with ranges on three real projects, and the prettier-plugin-liquid suite all pass; if not taken, the reason is recorded
- [ ] #3 Liquid-grammar switch: it is established whether the graph extracts any edges from HTML attributes (script/img/link), since those would be lost
- [ ] #4 Liquid-grammar switch: the 6 currently-unparseable files are examined and the resulting change in `dependentsOf` is characterised as a fix or a regression, with evidence
- [ ] #5 Liquid-grammar switch: if taken, graph dependents are compared before/after on a real project and the diff explained file by file — not just 'tests pass'
- [ ] #6 A decision is recorded on adopting `patch/verify-ohm-guards.js` as a committed CST-identity guard in CI
<!-- AC:END -->
