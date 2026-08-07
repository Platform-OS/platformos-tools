---
id: TASK-12.14
title: Cut CST node density in the Liquid grammar (~2 nodes per byte)
status: Done
assignee: []
created_date: '2026-07-29 23:22'
updated_date: '2026-07-30 00:22'
labels:
  - performance
  - liquid-html-parser
  - root-cause
dependencies: []
modified_files:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Liquid parser runs at **20–35 KB/s**. Ohm manages 1–5 MB/s on a sane grammar, so this is ~100x off — a structural problem, not a constant to shave. Everything expensive in this repo (the 36–49 s graph build, the 10.9 s cold lint, the LSP's latency) is downstream of it.

MEASURED CAUSE. The grammar applies rules per CHARACTER:

```
TextNode           = AnyExceptPlus<openControl>
AnyExceptPlus<lit> = (~ lit any)+
```

`TextNode` is capitalized, i.e. SYNTACTIC in Ohm, so each character costs a rule application, a memo-table entry, a CST node, AND implicit space-skipping. The CPU profile matches exactly: `isSyntactic` 7.0%, `toMemoKey` 4.6%, `memoize` 4.1%, `maybeSkipSpacesBefore` 2.4%, with 83.5% of a 36 s build inside ohm-js.

Two measurements pin it, and one of them narrows the fix:
- **1.98 CST nodes per byte**, and this is CONSTANT across the corpus — 1.99 for a file that is 89% tag interiors, 2.03 for one that is 30%. So the explosion is grammar-wide, NOT confined to raw text. Fixing only the text rule cannot give the 10–20x that a raw-text-dominated grammar would; tag-interior rules (`anyExcept`-style character rules in expressions/strings/identifiers) explode identically.
- **Scaling is linear** (25/20/26/26 KB/s at 1x/2x/4x/8x), so this is constant-factor blowup, not backtracking or a memoization miss.
- **`grammar.match()` is only 28% of parse time; the semantics walk (CST → AST) is 72%.** Node count therefore drives BOTH halves, which is what makes reducing it the high-leverage move — but it also means a prescan that merely keeps raw text out of `match()` leaves most of the cost in place.

APPROACH (each step measured before the next):
1. Make the text rule lexical and greedy so a text run is one node, not one per character (`#((~openControl any)+)`). Cheapest probe of the diagnosis; expect a large win on markup-heavy files and roughly none on tag-heavy ones.
2. Audit the per-character rules inside tag interiors (expressions, strings, identifiers) and give them the same treatment — this is where the remaining density lives.
3. Only then consider a delimiter prescan that hands Ohm just tag interiors.

RISK — this is the deepest shared package. Changing a rule from syntactic to lexical changes implicit space handling, which can move source intervals and therefore OFFENSE POSITIONS. The 289 parser tests, 1055 check-common tests and whole-project offense parity on real projects are the gate; position drift is a silent, user-visible regression.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CST nodes per byte measured before and after on the same corpus, and the parse-rate change recorded in KB/s
- [x] #2 Offense output is byte-identical on at least three real projects (pos-module-mcp, dna-idea, poetry-blog), including ranges — position drift is the specific risk
- [x] #3 liquid-html-parser (289), check-common (1055), check-node, supervisor, and language-server-common (474) suites all pass unchanged
- [x] #4 match() vs semantics split re-measured after the change, so it is clear which half improved
- [x] #5 Any rule changed from syntactic to lexical is justified in a comment explaining the whitespace implication
- [x] #6 Graph build time and cold lint time on pos-module-mcp re-measured, since both are dominated by this parser
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed two single-character lookahead guards. My own diagnosis in the description was WRONG about the mechanism and is corrected here; external review supplied the right one.

ACTUAL CAUSE — not per-character text scanning. `TextNode = AnyExceptPlus<openControl>` is a greedy run, so raw text was never the problem. The cause is that **parameterized rule applications never hit Ohm's memo table**: `Apply.prototype.substituteParams` returns `this` only when `args.length === 0`, so every parameterized application allocates a fresh `Apply` and rebuilds its memo-key string on each evaluation. `liquidNode` was an unguarded 8-way alternation fanning out into ~35 `liquidTagRule<name, markup>` + ~14 `liquidTagOpenRule<name, markup>` applications at every candidate position, reached from three hot places (`Node` iteration, `Attr`, `attr{Single,Double}QuotedValue`). Reported instrumentation on a 2.2 KB template: 9835 `liquidTagRule` applications at a **0% memo hit rate**, ~32% of parse CPU in GC — consistent with `toMemoKey` 4.6% / `memoize` 4.1% / `Apply.toString` 2.6% in my own profile.

FIX — `~(~"{")` before the `liquidNode` alternation and `~(~"<")` before `HtmlNode`, using the `~(~x)` double-negation idiom already present in `argumentSeparatorOptionalComma`. Arity 0, so `LiquidMappings.liquidNode: 0` still indexes the alternation and the CST shape is untouched. Verified every path into `liquidNode` begins with a literal `"{%"`/`"{{"` (`liquidTagRule`, `liquidTagOpenRule`, `liquidTagClose`, `liquidDrop`, `liquidInlineComment`, `commentBlockStart`, `liquidDocStart`), so the guard cannot exclude a valid parse.

MEASURED (AC#1/#4/#6) — the ratio depends heavily on WHAT is measured, which is the main lesson here:

| measurement | before | after | ratio |
|---|---|---|---|
| `grammar.match()` only, 1392-file corpus | 22.92 s | 14.22 s | 1.61x |
| full parse (match + CST + AST), 44 files | 1.64 s (35 KB/s) | 0.75 s (**77 KB/s**) | **2.2x** |
| in-process graph build | 35868 ms | **20690 ms** | 1.73x |
| cold first `validate_code` (with TASK-12.13) | 13.4 s | **8.7–9.8 s** | ~1.5x |
| warm call | 0.9 s | 0.9 s | unchanged |

Note the full parse improved MORE than `match()` alone (2.2x vs 1.61x) even though **nodes/byte is unchanged at 1.98** — the doomed allocations were inflating GC across the semantics phase too. So `match()`-only benchmarks (including the reviewer's fixture table and the supplied verifier) understate the real win. Markup-heavy projects gain more on match (dna-idea 1.99x) than logic-dense ones (1.22x on pos-module-mcp/app).

CORRECTNESS (AC#2/#3/#5) — CST fingerprints (ctorName + source intervals + node count, sha1) byte-identical across 1392 + 68 + 44 real files with identical parse outcomes (same 6 pre-existing failures), via the reviewer's `verify-ohm-guards.js`. Offense output byte-identical on pos-module-mcp (3), dna-idea (67) and poetry-blog (300) INCLUDING ranges — the position-drift risk did not materialise, as expected for arity-0 guards. Suites: liquid-html-parser 289, check-common 1055, LSP 474, check-node 115, supervisor 92, graph 109, prettier-plugin-liquid 137. Monorepo type-check + format clean. Each guard carries a comment explaining the memo-table mechanism and the arity-0 requirement.

DELIBERATELY NOT TAKEN — the two further changes in the supplied patch; see the follow-up task. The raw-tag scan bought only +0.06x on our corpus (1.61x → 1.67x) while it DOES change CST shape, and switching the graph to the `Liquid` grammar changes which files parse at all (6 failures → 0), i.e. it changes graph edges.

METHOD NOTE for whoever measures next: one apparent "regression" during this work (thousands of new offenses on pos-module-mcp) was a harness bug — the project is nested at `Work/pos-module-mcp/pos-module-mcp`, so linting the parent is a different root. And worker-build timings taken while the machine's 5-minute load average was 4.8–5.8 showed no improvement at all; the in-process measurement is the load-insensitive one.
<!-- SECTION:FINAL_SUMMARY:END -->
