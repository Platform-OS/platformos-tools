---
id: TASK-96
title: >-
  Three tag-markup spellings in real deployed code are blocking errors although
  the platform handles them correctly
status: In Progress
assignee: []
created_date: '2026-08-26 13:49'
updated_date: '2026-08-26 14:41'
labels:
  - check-common
  - false-block
  - measured
  - blocking-check
  - liquid-html-parser
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidTagSyntax.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/index.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
  - packages/platformos-check-node/scripts/generate-factory-configs.js
  - supervisor-tests/auto-eval/results/ROUND-2026-08-26/FINDINGS.md
  - >-
    supervisor-tests/auto-eval/reports/a-stray-colon-makes-a-private-cache-global.md
  - >-
    supervisor-tests/auto-eval/reports/what-does-the-syntax-annotation-promise.md
documentation:
  - supervisor-tests/auto-eval/suites/18-value-collapse.mjs
  - supervisor-tests/auto-eval/suites/13-cli-parity.mjs
priority: high
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

`InvalidTagSyntax` fires whenever a known tag's strict grammar rule fails, because the tolerant parser then keeps the markup as a raw **string**. It reports under `LiquidHTMLSyntaxError`, which is `Severity.ERROR` and a member of `BLOCKING_CHECKS`, so the supervisor returns `must_fix_before_write: true` and an agent cannot write the file at all. `pos-cli check` and the language server report the same error.

Three spellings reached by that path occur in real deployed code and the platform handles each **correctly**. Measured over a 2,768-file production application (`supervisor-tests/auto-eval/substrate-large`):

| spelling | files | occurrences |
|---|---|---|
| `{% capture 'name' %}` — quoted target | 23 | 43 |
| `{% case x: %}` — trailing colon | 4 | — |
| `{% parse_json o %%}` — trailing `%` | 1 | — |

Each was rendered on a live instance (`fk-docs.ps-01-platformos.com`) and produces the intended result:

```
{% assign g = 1 %}{% case g: %}{% when 1 %}ONE{% endcase %}   -> ONE          (correct branch)
{% capture 'cs' %}HI{% endcapture %}{{ cs }}                  -> HI
{% parse_json d o %%}{"k":2}{% endparse_json %}{{ d }}        -> {"k":2}
```

`capture` with a quoted name is the single most frequently blocked construct found in real code, so this is the largest measured false-block surface in the toolchain.

## Why these are safe and other spellings are NOT

The platform's tags do not validate markup against a fixed shape. `Liquify::Tags::BaseTagMethods#parse_main_value` (`base_tag_methods.rb:35`) uses an **unanchored** `markup =~ syntax`, so it takes the first value-shaped token it finds and treats the rest as attributes. For the three spellings above the token it finds happens to be the right one. For others it is not, and the result is silently wrong rather than merely tolerated. Two such cases are measured and MUST keep blocking:

- `{% cache: k %}` and `{% cache expire: 30 %}` — the key collapses to a constant (`":"`, `"expire:"`), and `cache_tag.rb:54` composes the full cache key with no user or session component. Two distinct keys then share one entry instance-wide, so one user's rendered fragment is served to another. Measured: two blocks with distinct keys rendered one body, and a later request with an unrelated key returned the earlier request's content.
- `{% log: x %}` — records the literal `":"` instead of the author's message.

This is why a blanket demotion of `InvalidTagSyntax`, or a demotion keyed on the tag name, or a rule such as "tolerate a leading separator", are all wrong: each would unblock a silent defect. `{% capture %}` with empty markup also **raises** on the platform, so demoting the `capture` tag as a whole would approve a fatal error.

The safe direction is therefore: keep blocking by default, and demote only specific spellings measured to behave correctly. An unmeasured spelling must stay blocking by construction.

## Why not widen the grammar instead

These constructs survive `prettier-plugin-liquid` today **because** their markup stays a raw string and the printer emits raw strings verbatim. Making them parse means the printer must learn to print them, or the author's code is silently rewritten on the next format — the data-loss trap in CLAUDE.md's "Changing the grammar". Widening also removes the diagnostic entirely, and these spellings are still worth advising against; they work by accident, not by design.

## Notes for whoever picks this up

- `Problem` carries no per-offense severity: severity comes from the check's `meta.severity`. A finding cannot be demoted without moving it to its own check code.
- Adding a check requires registering it in `src/checks/index.ts` **and** regenerating the factory configs (`node packages/platformos-check-node/scripts/generate-factory-configs.js`), or `all.yml` / `recommended.yml` will not list it.
- Blocking is not severity: `blocksWrite` requires `severity: error` **and** membership of `BLOCKING_CHECKS`, so a new check is non-blocking by default.
- If the set of findings the MCP server reports changes, `transport/instructions.ts` must be updated in the same change; its claims are pinned by `validate-code.spec.ts`.
- Regression fixtures for the measured spellings, and the runtime oracles, live in `supervisor-tests/auto-eval/suites/18-value-collapse.mjs` and `suites/13-cli-parity.mjs`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The three measured spellings (`{% capture 'name' %}`, `{% case x: %}`, `{% parse_json o %%}`) no longer set must_fix_before_write, asserted end to end against the supervisor
- [x] #2 Each of the three still produces a diagnostic, so the construct is advised against rather than silently accepted
- [x] #3 `{% cache: k %}`, `{% cache expire: 30 %}` and `{% log: x %}` still block, asserted in the same test file as the demoted spellings so the split cannot drift apart unnoticed
- [x] #4 `{% capture %}` with empty markup still blocks, since the platform raises on it
- [x] #5 A spelling that reaches the same code path but is not on the measured-safe list still blocks, so the default is fail-safe and a future spelling is not admitted by omission
- [x] #6 Every affected buffer round-trips through prettier unchanged, including the demoted spellings
- [x] #7 Deliberately reverting the change makes the new tests fail (sabotage-verified), recorded in the task notes
- [x] #8 `pos-cli check` over the 2,768-file corpus reports no offense that it did not report before, other than the intended severity change on the three spellings
- [x] #9 If a new check code is introduced it is registered and the factory configs are regenerated, so `all.yml` and `recommended.yml` list it
- [x] #10 Any change to what the MCP server reports is reflected in transport/instructions.ts in this same change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approved plan

**Branch:** `fix/tolerable-tag-syntax-is-not-a-blocking-error`

### Shape

One predicate, two checks, so they are mutually exclusive by construction and cannot both fire or both go silent.

1. `checks/liquid-html-syntax-error/checks/InvalidTagSyntax.ts` — add one exported predicate answering "is this tag markup a spelling measured to behave correctly on the platform?", covering exactly:
   - `capture` whose markup is a quoted valid identifier
   - `case` whose markup is a value followed by a trailing colon
   - `parse_json` whose markup is a value followed by a trailing `%`
   `detectInvalidTagSyntax` returns `undefined` for those, so `LiquidHTMLSyntaxError` (Severity.ERROR, in BLOCKING_CHECKS) stays silent on them.

2. New check definition at `Severity.WARNING`, absent from `BLOCKING_CHECKS`, reporting exactly what the predicate admits. Non-blocking by default per `blocksWrite` — no change to `blocking.ts` needed.

3. Register in `checks/index.ts` and regenerate factory configs (`node packages/platformos-check-node/scripts/generate-factory-configs.js`) so `all.yml` / `recommended.yml` list it. Add the check's docs page.

Precedent: the TASK-83 per-shape `ValidFrontmatter` split.

### Why not the alternatives

- **Not a grammar widening.** These spellings survive prettier today *because* their markup stays a raw string and the printer emits raw strings verbatim; making them parse means the printer must learn to print them or the author's file is silently rewritten (CLAUDE.md "Changing the grammar", layer 4). Widening also removes the diagnostic, and these work by accident rather than design.
- **Not a blanket or per-tag demotion.** Empty `{% capture %}` raises on the platform, and `{% cache: k %}` / `{% cache expire: 30 %}` / `{% log: x %}` are silently wrong. Default must stay blocking; only measured-safe spellings are demoted.

### Order of work

1. Corpus baseline BEFORE any change: `pos-cli check` over the 2,768-file application, offense totals and the `LiquidHTMLSyntaxError` count recorded, so AC #8 is measured rather than asserted.
2. Predicate + its unit tests, including the negative spellings.
3. New check definition + tests; the blocking spellings asserted in the SAME file as the demoted ones so the split cannot drift apart.
4. End-to-end supervisor assertions for `must_fix_before_write`.
5. Prettier round-trip over every affected buffer.
6. Sabotage each direction and record what failed.
7. Corpus diff against the step-1 baseline.
8. Registration + factory configs + docs; `transport/instructions.ts` only if the reported set changes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented on `fix/tolerable-tag-syntax-is-not-a-blocking-error`

27 insertions across 5 existing files, plus three new files. No grammar or printer change.

### Shape as built

- `liquid-html-syntax-error/checks/tolerated-tag-markup.ts` (new) — the shared allowlist predicate, keyed on `(tag name, markup shape)`.
- `InvalidTagSyntax.ts` — returns early when the predicate matches, so `LiquidHTMLSyntaxError` goes silent on exactly that set.
- `unconventional-tag-syntax/` (new) — `Severity.WARNING`, absent from `BLOCKING_CHECKS`, reports exactly what the predicate admits. `blocking.ts` needed no change.
- Registered in `checks/index.ts`; `all.yml` / `recommended.yml` regenerated at severity 1. The generator `require`s the BUILT package, so check-common must be built first — run against source it silently produces no change.

### The allowlist was corrected by measurement, not reasoning

Three of the first draft's regexes were wrong. Boundaries measured on the instance:

| spelling | platform | first draft | final |
|---|---|---|---|
| `case g :` (spaced colon) | renders correctly | blocked | admitted |
| `case g::` (double colon) | renders correctly | blocked | admitted |
| `capture 'a-b'` | captures into `a-b` | blocked | admitted |
| `capture 'cs' extra` | captures into `cs` | blocked | **still blocked** — which token is the target is ambiguous; 0 corpus occurrences |
| `capture '123'` | **inconclusive** — the probe read `{{ 123 }}`, a numeric literal, not a variable read | blocked | **still blocked** — unmeasured, so not admitted |

### Corpus diff (AC #8), same tree before and after

```
total offenses           13065 -> 13065     unchanged
files with offenses       1950 ->  1950     unchanged
LiquidHTMLSyntaxError      122 ->    88     -34
UnconventionalTagSyntax      0 ->    34     +34
24 of 26 other check codes unchanged
```

-34 matches the enumeration exactly (32 capture + 1 case + 1 parse_json), so the delta is fully attributable. NOTE: a first hand-rolled baseline returned 0 offenses — `pos-cli check run -f json` needs the project dir as an argument and fails silently without it. Use `lib/poscli-check.mjs`.

### Sabotage (AC #7) — 9 mutations, all bite

Predicate always TRUE / always FALSE / blocking check stops deferring: 11 tests fail each. The six boundary mutations (capture admits a space, a digit-leading name, a trailing token; case drops the name requirement, admits a trailing token; parse_json drops the name requirement) each fail exactly the one test that pins them.

An earlier run reported two mutations as "not biting" when the mutation had never applied — a Python raw string searched for `['\"]` while the file holds `['"]`. The harness now asserts the mutation landed before trusting the result.

### AC #6 nuance, recorded rather than glossed

No buffer is MANGLED, but none is byte-identical either: prettier reformats Liquid generally (reflow / whitespace-control markers), and it normalises `{% parse_json d %%}` to `{% parse_json d % %}`. Verified inert — both spellings parse to markup `"d %"`. Measured for all nine demoted spellings across prettier 2 and 3: each is still tolerated after formatting, so **a save can never turn a warning into a blocked write**. The post-format spelling is pinned as its own fixture.

The printer is provably untouched by this change: `prettier-plugin-liquid` depends on `liquid-html-parser` only, never on `platformos-check-common`.

### AC #10

No change needed, verified rather than assumed. `instructions.ts` derives its coverage line from `allChecks.length` and `validate-code.spec.ts` compares against the same derived value, so adding a check moves both together. Nothing in the SILENCES section claims anything about tag syntax, and a non-blocking warning is already covered by the existing prose that `errors[]` being non-empty does not imply a block.

### Verification

Full monorepo: 357 test files / 4,535 tests pass; `type-check`, `build` and `format:check` all clean. New tests: 29 in `unconventional-tag-syntax/index.spec.ts`, 25 in `tolerated-tag-syntax-gate.spec.ts` (real lint through the real gate, no mocks), 1 added to `blocking.spec.ts`.

### FOLLOW-UP — upstream docs page does not exist yet

`meta.docs.url` points at `documentation.platformos.com/.../checks/unconventional-tag-syntax`. All 53 existing checks carry a URL in this pattern and the pages are authored upstream, so including it follows the repo convention — but this one 404s until someone publishes it, and `see_also` will carry the dead link to agents meanwhile. Either publish the page or drop the field before release.

### Unrelated finding, recorded so it is not lost

`RollbackOutsideTransaction` already exists and works correctly: a **page** with a bare `{% rollback %}` is reported; a **partial** deliberately is not, because `RollbackTag` checks `AfterCommitEverywhere.in_transaction?` at runtime and the caller decides. The eval's `S13-FN-rollback-outside-transaction` finding probes a partial, so it measures a designed silence — a fixture artifact of the harness, not a gap in the checks. Belongs to the eval, not to this task.
<!-- SECTION:NOTES:END -->
