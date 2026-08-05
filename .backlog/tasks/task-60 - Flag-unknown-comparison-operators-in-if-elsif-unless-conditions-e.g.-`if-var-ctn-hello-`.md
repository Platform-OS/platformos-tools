---
id: TASK-60
title: >-
  Flag unknown comparison operators in if/elsif/unless conditions (e.g. `if var
  ctn "hello"`)
status: Done
assignee: []
created_date: '2026-08-05 19:08'
updated_date: '2026-08-05 22:15'
labels:
  - linter
  - bug
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.spec.ts
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - >-
    ~/projects/desksnearme vendored liquid gem: lib/liquid/condition.rb
    (interpret_condition raise), lib/liquid/tags/if.rb (lax_parse)
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`{% if var ctn "hello" %}x{% endif %}` is invalid Liquid — `ctn` is not an operator — yet neither the editor (LSP diagnostics) nor `platformos-check` reports anything. The code deploys cleanly and then fails **at render time**: the platformOS Liquid fork's lax parser accepts any `[=!<>a-z_]+` word as an operator (`If#lax_parse`, if.rb), and `Condition#interpret_condition` raises `Liquid::ArgumentError: Unknown operator ctn` when it is not in the operator table (condition.rb:186 in the vendored gem in ~/projects/desksnearme). A guaranteed production error is exactly what the linter exists to catch before deploy.

## Root cause (two layers; only the second is the bug)

1. **Parser — by design, do not change.** The Ohm grammar's `comparator` rule accepts only `== != >= <= > < contains`. With an unknown word, the strict `if`-markup rule cannot consume the full markup, so tolerant mode falls back to `liquidTagBaseCase` and produces a `LiquidTag`/`LiquidBranch` whose `markup` is a **raw string** — no parse error. That is the tolerant-mode contract (`packages/liquid-html-parser/grammar/liquid-html.ohm`, rules `liquidTagOpenConditionalMarkup` / `comparator` around lines 369–381).

2. **Linter — the gap.** `LiquidHTMLSyntaxError` → `detectInvalidConditionalNode` (`packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.ts`) is the sub-check responsible for conditional tags whose markup fell back to string, but the `value UNKNOWN-WORD value` shape is deliberately let through:
   - the token heuristics never cover it: `checkInvalidStartingToken` passes (starts with a variable), `checkTrailingTokensAfterComparison` requires a valid comparison triple first, and `checkLaxParsingIssues` fires only when a *literal* is followed by junk — and even then an explicit `hasUnknownOperator` bypass (line ~125) skips reporting when the junk looks like an unknown operator;
   - three tests **pin the silence**: "should not report an offense for unknown operators…" (`InvalidConditionalNode.spec.ts:282, 296, 311`), with the rationale "(Liquid catches these)". The rationale is inverted — Liquid "catches" them by raising at render time, which is the failure mode a linter must prevent. These tests date to the original fork-init commit and were never a platformOS decision.

## Current behavior (verified 2026-08-05, end-to-end through LiquidHTMLSyntaxError)

| Source | Offenses today | Runtime result |
|---|---|---|
| `{% if var ctn "hello" %}` | 0 | render-time `Unknown operator ctn` |
| `{% unless var ctn "hello" %}` | 0 | same |
| `{% elsif var ctn "y" %}` | 0 | same |
| `{% liquid if var ctn "hello" %}` (statement form) | 0 | same |
| `{% if a b %}` | 0 | render-time `Unknown operator b` (lax parses `b` as the operator) |
| `{% assign a = var ctn "b" %}` | 1 — "Syntax is not supported" | already caught by `detectInvalidAssignFallback` |

The assign row shows conditionals are the outlier — the fallback-markup pattern already reports elsewhere.

## Desired behavior

When a conditional tag/branch's markup fell back to a string and tokenization shows a value token followed by a word that is neither a comparison operator (`==, !=, >, <, >=, <=, contains`) nor a logical operator (`and, or`), report a `LiquidHTMLSyntaxError` ERROR offense that names the unknown operator and lists the valid ones. Near-misses should offer a suggestion to the closest valid operator, mirroring the existing misspelled-logical-operator handling (`adn` → `and`, InvalidConditionalNode.spec.ts:332).

Out of scope, but note for a possible follow-up: `{% if var == %}` also produces 0 offenses today; lax Liquid evaluates it as `var == nil` (no runtime error, but almost certainly unintended) — flagging it is a separate severity decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% if var ctn "hello" %}` yields exactly one LiquidHTMLSyntaxError offense with Severity.ERROR whose message names `ctn` and lists the valid comparison operators, highlighting the condition markup
- [x] #2 The same offense is reported for `unless` tags, `elsif` branches (LiquidBranch markup), and conditional statements inside `{% liquid %}` blocks
- [x] #3 Adjacent value tokens with no operator between them (e.g. `{% if a b %}`) are reported, since lax Liquid treats the second value as an operator and raises at render time
- [x] #4 Unknown operators inside compound conditions (e.g. `{% if x and a ctn b %}`, `{% unless 'test' some > thing %}`) are reported
- [x] #5 A near-miss operator (e.g. `ctn`, `cotains`) offers a fix/suggestion replacing it with the closest valid operator, consistent with the existing misspelled logical-operator handling
- [x] #6 No offense for valid conditions: all seven comparison operators, and/or chains, truthy single-value conditions (variables and literals), and the pinned pipe-filter case `{% if wat | something == something %}` stays unchanged
- [x] #7 The three pinned tests 'should not report an offense for unknown operators…' (InvalidConditionalNode.spec.ts:282/296/311) are inverted to assert the exact expected offense arrays (whole-value assertions per repo test guidelines), and the `hasUnknownOperator` bypass in checkLaxParsingIssues is removed or repurposed
- [x] #8 Full `platformos-check-common` test suite passes
- [x] #9 LiquidHTMLSyntaxError check documentation in the platformos-documentation repo gains an unknown-operator example (doc page; overview/config/nav only if wording changes require it)
- [x] #10 Non-word junk in comparison-operator position after a variable (e.g. `mentioned_ids ||nonoperator profile_id`, `a && b`) is reported as 'Anything after … will be ignored' with the and/or hint when the junk contains && or ||, matching the runtime's silent truncation; literal-led junk keeps the existing 'stops at truthy value' message
- [x] #11 Filter pipes in conditions are reported (`{% if wat | something == something %}`, `owners | contains x` in compound conditions) with a 'Filters are not supported in conditions' hint and a truncation fix matching runtime behavior; the former pinned pipe test is inverted
- [x] #12 Structural condition errors are reported: a condition after and/or starting with an operator (`a and == b`), a comparison missing its right-hand side (`var ==`, `a contains`), and a condition ending with a logical operator (`a and`) — none offer an autofix
- [x] #13 Arbitrary special-character junk in operator position is reported generically (charfuzz-verified); `café == "x"` (grammar-rejected, runtime-valid) stays silent
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: rewrite the three pinned "should not report unknown operators" tests as "should report" with exact messages; add coverage for if/unless/elsif, {% liquid %} statement form, adjacent values (`a b`), `=` typo, and near-miss fixes (ctn/cotains → contains, nad → and). Run to confirm red.
2. Fix: add checkUnknownComparisonOperator to InvalidConditionalNode.ts — state machine over tokens; a value-token followed by a bare word matching lax Liquid's operator charset (/^[=!<>a-z_]/) in comparison-operator position is reported as Unknown operator; near-miss suggestion via edit distance (≤2, < candidate length, unique min) then unique-subsequence fallback (ctn ⊆ contains). Runs after checkInvalidStartingToken, before checkTrailingTokensAfterComparison. Remove now-dead hasUnknownOperator bypass in checkLaxParsingIssues. Token gains index for operator-only fix replacement; ExpressionIssue.fix becomes optional.
3. Verify: full platformos-check-common suite; confirm runtime semantics preserved for cases lax Liquid silently ignores (trailing junk keeps existing messages).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-05 on branch fix-syntax-detection. New checkUnknownComparisonOperator in InvalidConditionalNode.ts: a state machine walks the token list consuming valid units (value, value-comparison-value, logical separators); a value token followed by a bare word matching lax Liquid's operator charset (/^[=!<>a-z_]/) is reported as `Unknown operator '<word>'. Valid operators are: ==, !=, >, <, >=, <=, contains`. It deliberately returns null after a complete comparison so trailing junk keeps the existing 'Anything after … will be ignored' message (runtime silently ignores that shape rather than raising). Near-miss autofix: Levenshtein distance <= 2 (and < candidate length) with unique minimum, prefix tie-break (`=` ties with ==/!=/>=/<= at distance 1; only == starts with =), then unique-subsequence fallback for abbreviations (ctn ⊆ contains). Candidates include and/or, so `nad`/`adn` fix to `and`. The hasUnknownOperator bypass in checkLaxParsingIssues was removed; ExpressionIssue.fix is now optional (no fix offered when no confident suggestion, e.g. `{% if a b %}`). Token gained an index field for operator-only replacement. Tests: three pinned tests inverted, five new tests (misspelled-operator fixes, unless/elsif, liquid statement blocks, adjacent values). Full monorepo suite green: 3039 tests / 308 files. AC #9 (docs repo example) intentionally left open — platformos-documentation is a separate repo.

Follow-up gap found by user 2026-08-05: `unless profile_id == event.actor.id or mentioned_ids ||nonoperator profile_id` was still silent. The junk token starts with `|`, outside the lax operator charset, so the runtime finds NO operator and silently truncates the condition at `mentioned_ids` (QuotedFragment excludes `|`, liquid.rb:41 in the fork — filters are NOT supported in conditions in either parse mode). checkUnknownComparisonOperator only flagged word-charset tokens, and checkLaxParsingIssues only fires for literal-led junk. Extended the operator-position branch: non-word junk after a variable now reports 'Conditional is invalid. Anything after <valid prefix> will be ignored' (+ and/or hint when junk contains &&/||), with a truncation fix that preserves runtime semantics. A lone `|` (pipe-filter attempt, pinned test) stays silent — noted as possible follow-up since the runtime ignores filters in conditions too. Also covers variable-led `a && b`, complementing the pinned literal-led JS-operator tests. AC #10 added and verified; all suites green.

Round 3 (2026-08-05, after user pushback on the pipe carve-out): removed the lone-`|` exemption and inverted the pinned pipe test — filters in conditions are runtime-ignored, so they now report with a 'Filters are not supported in conditions' hint (user case: `if members contains mentioned_id or owners | contains mentioned_id`). Renamed the machine to checkConditionStructure and closed the structural gaps: condition-after-logical starting with an operator (`a and == b` — runtime raises Unknown operator), comparison missing RHS (`var ==` evaluates as == nil; `a contains` errors), trailing logical (`a and` — runtime SyntaxError). No autofix for structural errors (intent unguessable); junk-truncation fixes kept where they mirror runtime semantics. Charfuzz sweep confirms ANY special character in operator position reports (the `|` literal only selects the hint sentence, detection is generic) and `café == "x"` correctly stays silent — grammar rejects it but the byte-permissive Ruby runtime accepts it, which is WHY blanket 'string markup ⇒ error' would false-positive; the check must mediate grammar vs runtime. Remaining gaps filed as subtasks: TASK-60.1 (when-branch junk), TASK-60.2 (for-tag `inn`), TASK-60.3 (grammar over/under-acceptance: `{% if and b %}` parses, log junk parses, unicode identifiers). Monorepo suite green: 3045 tests / 308 files, build + type-check clean.

CORRECTION to the round-3 note: the claim that `café == "x"` is grammar-rejected was wrong — Ohm's `letter` is Unicode-aware and the markup parses as a normal Comparison (that is why it produced 0 offenses in the charfuzz sweep, not because the check mediated). Verified and pinned with a test in TASK-60.3. The general point stands via the other direction: the grammar over-accepted `{% if and b %}` (runtime raises) and log positional args (runtime silently drops) — both fixed at the grammar level in TASK-60.3. All three subtasks (60.1 when-branch junk, 60.2 for-tag in-keyword, 60.3 grammar over-acceptance) implemented and Done on 2026-08-05; monorepo suite green at 3059 tests / 310 files. Only AC #9 (docs-repo example) remains open on this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Conditional syntax errors that previously deployed silently and broke at render time are now reported by LiquidHTMLSyntaxError, with autofixes where intent is unambiguous.

**Linter (platformos-check-common, liquid-html-syntax-error):** checkConditionStructure in InvalidConditionalNode.ts walks condition tokens and reports: unknown comparison operators (`var ctn "hello"` → names the operator, lists valid ones, autofixes near-misses like ctn/cotains→contains, `=`→`==`, nad→and via edit-distance + prefix tie-break + subsequence match); adjacent values (`a b`); junk the runtime silently truncates (`mentioned_ids ||junk x`, `a && b`, filter pipes `owners | contains x` — with targeted hints); conditions starting with an operator (`and b`, `a and == b`); comparisons missing their right-hand side (`var ==`, `a contains`); trailing logical operators (`a and`). Truncation autofixes mirror exactly what the runtime executes; structural errors get no autofix. The fork-era "(Liquid catches these)" pinned tests and the hasUnknownOperator bypass encoded the inverted rationale and were removed/inverted. Subtask checks added: InvalidWhenMarkup.ts (when-branch junk, raw-markup walk since tokens strip commas) and InvalidLoopIn.ts (misspelled/missing `in` in for/tablerow, gating the other loop checks).

**Parser (liquid-html-parser):** `~logicalOperator` lookahead on conditional markup (leading and/or now falls back and reports); log tag arguments restricted to named (runtime silently drops positional ones — confirmed against the Ruby impl and real-world insites_pipeline code that loses log labels this way). Unicode identifiers verified already working (Ohm letter is Unicode-aware) and pinned with a test.

**Coverage:** every reported and every deliberately-silent shape is pinned by tests — 30+ new/inverted cases across InvalidConditionalNode/InvalidWhenMarkup/InvalidLoopIn/InvalidTagSyntax specs and parser stage-1/stage-2 specs, all with exact-message assertions; behavior verified against the vendored Ruby fork (if.rb lax_parse, condition.rb interpret_condition, case.rb WhenSyntax, for.rb Syntax, log_tag.rb/base_tag_methods.rb). Comments trimmed to ownership handoffs and runtime-contract one-liners. Docs: unknown-operator, incomplete-condition, pipe/&&, for-in and when examples added to the LiquidHTMLSyntaxError page in platformos-documentation (uncommitted there). Full monorepo suite green: 3060 tests / 310 files. All three subtasks Done.
<!-- SECTION:FINAL_SUMMARY:END -->
