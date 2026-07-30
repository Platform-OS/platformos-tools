---
id: TASK-12.18
title: >-
  Monomorphize the parameterized tag rules — the {% liquid %} statement re-parse
  is 43% of parse time
status: To Do
assignee: []
created_date: '2026-07-30 15:50'
labels:
  - performance
  - liquid-html-parser
  - root-cause
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-12.14's lookahead guards fixed the outer pass and cannot help here. The remaining cost is the INNER re-parse of `{% liquid %}` bodies, which is the dominant path in real platformOS code.

MEASURED on pos-module-mcp/app (44 files, 58 KB), all matches asserted successful:

```
full pipeline (toLiquidHtmlAST):   1.69 s
outer LiquidHTML match only:       0.41 s   (24%)
inner LiquidStatement re-parse:    0.72 s   (43%)
inner rate  52 KB/s   vs   outer rate  143 KB/s
{% liquid %} bodies = 65% of all bytes
```

And it is not a niche path: **1194 of the 1392 files** in the corpus contain `{% liquid %}` blocks. Because the guards only touch the 24% outer pass, their measured 1.26–1.50x is a ceiling artefact — the inner path is the larger remaining prize in the parser.

CAUSE (same mechanism as TASK-12.14, different remedy). `{% liquid %}` is a two-stage construct: the body is captured raw as `tagMarkup`, then `stage-1-cst.ts`'s `liquidTagLiquidMarkup` re-parses it with the `LiquidStatement` grammar. Each statement enters an alternation that fans out into ~35 `liquidTagRule<name, markup>` plus ~14 `liquidTagOpenRule<name, markup>` applications. Those are PARAMETERIZED, so `Apply.prototype.substituteParams` never returns `this` — every application allocates a fresh `Apply` and rebuilds its memo-key string, and never hits the memo table. External instrumentation reported ~1706 such applications at a 0% hit rate over 2.4 KB, i.e. ~30 doomed parameterized applications per statement.

A character-level guard is useless here: statements begin with a letter (`assign`, `function`, `render`, …), not `{`.

REMEDY — monomorphization: replace the parameterized rules with generated per-tag rules whose name is a literal, e.g.

```
liquidTagAssign = "assign" ~identifierCharacter space* liquidTagAssignMarkup &liquidStatementEnd
```

`args.length` becomes 0, so `substituteParams` returns `this`, `_memoKey` is cached, and the allocation plus string-building per application disappears.

SCOPE is larger than it first looks, which is why this is a generator step rather than a hand edit:
- ~35 tag rules x the statement grammars — `LiquidStatement`, `StrictLiquidStatement` and `WithPlaceholderLiquidStatement` — plus the non-statement path, which shares `liquidTagRule`/`liquidTagOpenRule`.
- Generate once and let the variants inherit; extending the existing `build/shims.js` prebuild (which already generates `grammar/liquid-html.ohm.js`) is preferable to adding a second generator.
- The generated rules must keep the CST ctorNames and arities the `stage-1-cst.ts` mappings expect (`LiquidMappings`, `LiquidStatement`, `liquidTagOpenForm: 0`, …). This is the real risk: unlike the arity-0 guards, monomorphization rewrites the rules that produce CST nodes.

TWO MEASUREMENT TRAPS, both of which produced a wrong answer during this investigation:
1. Extracted `{% liquid %}` bodies must be TRIMMED before matching. Production feeds `tagMarkup.sourceString`, already past the grammar's `space*`; an untrimmed body fails at position 3.
2. A failed `match()` is FAST. My first run reported the inner re-parse as 1% of the pipeline — every one of the 45 matches had failed. Any timing here must assert `succeeded()` first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Inner-vs-outer split re-measured before and after, with every match asserted successful, on a corpus dominated by {% liquid %} blocks
- [ ] #2 Rules are generated (extending build/shims.js), not hand-written, so the ~35 tags x 3 statement grammars cannot drift apart
- [ ] #3 CST ctorNames and arities consumed by stage-1-cst.ts mappings are unchanged — verified by sha1 CST fingerprints over the 1392-file corpus, not by tests alone
- [ ] #4 Offense output byte-identical on three real projects including ranges; parser, check-common, language-server-common and prettier-plugin-liquid suites pass unchanged
- [ ] #5 Parameterized-application count and memo hit rate are re-measured to confirm the mechanism was actually removed, rather than inferring it from timings
- [ ] #6 Full-pipeline parse rate (KB/s) recorded before/after, plus the resulting graph-build and cold validate_code numbers
<!-- AC:END -->
