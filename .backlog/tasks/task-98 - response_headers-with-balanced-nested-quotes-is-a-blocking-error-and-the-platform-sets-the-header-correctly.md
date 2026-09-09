---
id: TASK-98
title: >-
  response_headers with balanced nested quotes is a blocking error, and the
  platform sets the header correctly
status: In Progress
assignee: []
created_date: '2026-08-26 15:56'
updated_date: '2026-08-26 16:43'
labels:
  - check-common
  - false-block
  - measured
  - blocking-check
dependencies:
  - TASK-96
references:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/tolerated-tag-markup.ts
  - >-
    packages/platformos-check-common/src/checks/unconventional-tag-syntax/index.ts
  - supervisor-tests/auto-eval/suites/13-cli-parity.mjs
  - supervisor-tests/auto-eval/lib/runtime.mjs
priority: medium
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

```liquid
{% response_headers '{ "Content-Security-Policy" : "frame-ancestors 'none'" }' %}
```

`InvalidTagSyntax` reports this under `LiquidHTMLSyntaxError` — `Severity.ERROR`, in the supervisor's `BLOCKING_CHECKS` — so an agent is told not to write the file. Measured on a live instance, **the platform sets the header correctly, quotes intact**:

```
baseline (no tag)                       content-security-policy: (absent)
{% response_headers '{"CSP":"a"}' %}    header set to "a"
the buffer above                        content-security-policy: frame-ancestors 'none'
```

One occurrence in a 2,768-file production application, in `app/views/layouts/application.html.liquid` — a file every page loads. So the entire layout of that application is currently unwritable by an agent.

## The shape boundary, measured

Nesting is not the discriminator; **balance** is.

| argument | result |
|---|---|
| `'{ "CSP" : "frame-ancestors 'none'" }'` — balanced nested pair | HTTP 200, header set correctly |
| `'{ "X-Ae" : "a 'b' c" }'` — balanced, non-CSP header | HTTP 200, header set to `a 'b' c` |
| `'{"X-Ae": "va'lue"}'` — unbalanced apostrophe | **HTTP 501**, header not set |

platformOS redefines `QuotedFragment` to be escape-aware (`app/lib/liquid/quoted_string_escapes.rb`), which is why a balanced inner pair survives. An unbalanced apostrophe still breaks the argument and must keep blocking.

## How to measure it — do NOT use a proxy

This construct was previously retracted as "the argument does not survive parsing", measured through `{% assign s = <literal> %}`. **That is a different parsing path** — `assign` has its own value parser, a `Base` tag matches `QuotedFragment`. `assign` truncates the literal to 27 characters; the tag does not. The retraction was wrong and has been reverted.

The correct instrument, and it needs no deploy: `/api/app_builder/liquid_exec` **carries a real controller**, so `response_headers` actually sets the HTTP header on the liquid_exec response. Read `res.headers`, and diff against a no-tag baseline so a header the instance always sends is not credited to the tag. `lib/runtime.mjs`'s `probe()` discards both the status and the headers, which is why this went unseen.

## Scope note

Admitting this to the tolerated allowlist (`liquid-html-syntax-error/checks/tolerated-tag-markup.ts`) requires a balanced-quote predicate, which is the whole risk of this task: too loose and an unbalanced argument becomes a false approval on a security header. The allowlist mechanism and its blocking counterpart already exist — see `UnconventionalTagSyntax` and TASK-96 — so this is one shape added to an established seam, not new machinery.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The corpus construct `{% response_headers '{ "Content-Security-Policy" : "frame-ancestors 'none'" }' %}` no longer sets must_fix_before_write, asserted end to end
- [x] #2 It still produces a diagnostic, so the unconventional spelling is advised against rather than silently accepted
- [x] #3 An UNBALANCED nested quote (`'{"X-Ae": "va'lue"}'`) still blocks, asserted in the same test file so the balance boundary cannot drift
- [x] #4 Balance is tested at more than one arity: zero nested pairs, one pair, and two pairs, each with its measured platform outcome recorded
- [x] #5 An escaped quote inside the argument, if platformOS supports one, is measured and its verdict pinned — or recorded as unmeasured and left blocking
- [x] #6 The measurement reads the actual HTTP response header and diffs against a no-tag baseline, so a header the instance always sends is never credited to the tag
- [x] #7 The buffer round-trips through prettier unchanged
- [x] #8 Deliberately reverting the change makes the new tests fail (sabotage-verified), recorded in the task notes
- [x] #9 `pos-cli check` over the 2,768-file corpus reports no offense it did not report before, other than the intended severity change on this construct
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plan, corrected by measurement

**Branch:** `fix/tolerable-tag-syntax-is-not-a-blocking-error` (stacked on TASK-96; both target files were created there and are ABSENT on master).

### The filed premise was wrong

The description says admitting this "requires a balanced-quote predicate". Measured: **no quote-counting predicate is safe.** `'{ "X-Ae" : "a' 'b" }'` has an EVEN number of quotes and fails with HTTP 501, so a parity rule admits a construct the platform refuses — a false approval on a security header, which is precisely this task's stated risk.

### What the platform actually does, read from source

`app/lib/liquid/quoted_string_escapes.rb` redefines:

```ruby
QuotedString   = /"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'/
QuotedFragment = /#{QuotedString}|(?:[^\s,\|'"]|#{QuotedString})+/o
```

So an unescaped delimiter TERMINATES the literal, and `QuotedFragment+` stops at whitespace, comma or pipe. `Base::SYNTAX` takes the first such run as the value; anything after it becomes attributes and is silently dropped. `Liquid::Expression.parse` then strips only the OUTER delimiter pair and unescapes the delimiter and backslash — a `\"` inside a `'…'` literal survives into the JSON parse.

### The predicate

Not syntactic. **Extract the value the platform will receive, and require that it parses as a JSON object.** That is exactly the condition `ResponseHeadersParser` needs, and it is the reason the platform 501s when it fails.

### Differential result, 26 argument shapes

The model was validated against the live instance, comparing BOTH the accept/reject verdict and the resulting header value:

```
false approvals: 0    false blocks: 0    value mismatches: 0
```

Three earlier candidate models were discarded, each by a measured counterexample: quote parity (admits `"a' 'b"`, which fails), full-consumption (admits `"{'k':'v'}"`, which is not JSON), and unescape-everything (rejects `"say \"hi\""`, which works).

### Work

1. Generalise the allowlist in `tolerated-tag-markup.ts` from `RegExp` to a predicate function, wrapping the three existing regexes unchanged.
2. New sibling module modelling the platform's extraction (`QuotedFragment+` scan, outer-delimiter strip, delimiter unescape). It mirrors a specific platform implementation, so it is its own module with the source reference on it.
3. Admit `response_headers` when the extracted value parses as a JSON object.
4. Fixtures from the differential: valid/invalid at zero, one and two nested pairs; the unbalanced apostrophe; the escaped-quote case; a dropped-tail case; non-object JSON (`[1,2]`, a bare string); single-quoted JSON keys.
5. Sabotage each direction, asserting the mutation applied.
6. Corpus diff. Expected: `LiquidHTMLSyntaxError` 88 -> 87 and `UnconventionalTagSyntax` 34 -> 35, one occurrence, in `app/views/layouts/application.html.liquid`.

### Known imperfection, deliberately not fixed here

For an argument that is NOT valid JSON the verdict is correct (blocking) but the message still reads `Invalid syntax for tag 'response_headers' Expected syntax: …`, which describes the wrong problem. Rewording it needs a dedicated detector and is out of scope.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented on `fix/tolerable-tag-syntax-is-not-a-blocking-error`

### Built

- `base-tag-value.ts` (new) — models what a `Base`-derived tag receives: the first `QuotedFragment+` run, outer delimiters stripped, delimiter and backslash unescaped. Mirrors `quoted_string_escapes.rb` + `base_tag_methods.rb`, cited on the module.
- `tolerated-tag-markup.ts` — allowlist generalised from `RegExp` to a predicate function; the three existing regexes wrapped unchanged. `response_headers` admitted when the extracted value parses as a JSON **object**.

### Corpus diff

```
total 13065 -> 13065      files 1950 -> 1950      (unchanged)
LiquidHTMLSyntaxError   122 -> 87      (-35, was -34 after TASK-96)
UnconventionalTagSyntax   0 -> 35      (+35, was +34)
response_headers now warned in: layouts/application.html.liquid
```

Exactly the one occurrence the task named, in the layout every page loads.

### Sabotage — 15 mutations, all bite

S1/S2 predicate always true/false, S3 blocking check stops deferring, S4-S9 the six capture/case/parse_json boundaries, S10 header predicate always true, S11 drops the object guard, S12 drops the array guard, S13 skips value extraction, S14 extraction keeps the dropped tail, S15 extraction stops unescaping. Baseline 45/45.

S15 initially did NOT bite — no fixture reached the unescape branch, because the case that needed it (`'{"k":"say \\"hi\\""}'`) turns out to be PARSED by the grammar and so never has raw markup. Two fixtures with an escaped delimiter beside an unescaped one were added, both measured; the branch is load-bearing (without it `{ "X-Ae" : "a \\'b" }` fails JSON.parse and a working construct blocks).

The array guard was checked the same way rather than assumed: `'[{"k":"a 'b' c"}]'` IS raw markup, extracts to a valid JSON array, and the platform 501s — so the guard is reachable and pinned.

### Verification

Full monorepo 357 files / 4,553 tests; `type-check`, `build`, `format:check` clean. Prettier round-trip over all eight nested-quote buffers across prettier 2 and 3: **0 mangled, 0 crashed** (all whitespace-only reflow). End-to-end gate coverage added in `tolerated-tag-syntax-gate.spec.ts` for both directions.

## Three PRE-EXISTING false approvals found, NOT fixed here

The grammar PARSES these, so no check ever sees them and this change cannot reach them. Each is refused by the platform:

| argument | our verdict | platform |
|---|---|---|
| `"{'X-Ae':'plain'}"` | silent | HTTP 501 |
| `'[1,2]'` | silent | HTTP 501 |
| `'not json'` | silent | HTTP 501 |

A well-formed quoted string that is not a JSON object is approved and 501s at runtime. Pinned as `KNOWN_UNCHECKED_BY_ANY_CHECK` in the spec so the gap is visible rather than implicit, per the repo's existing idiom. Worth its own task — the same `baseTagValue` + JSON-object test would answer it, but it needs a check that runs on PARSED markup, which is a different seam from the allowlist.

## Harness defect fixed along the way

The sabotage script crashed mid-run and left the working tree SABOTAGED, because its self-check ran outside a `finally` and its "mutation applied" assertion was wrong for a replacement that CONTAINS the old text (prepending an early return). Rewritten: verify the file content changed rather than that the old text is gone, and restore in `finally` with a final assertion that the tree matches the backup. It also correctly reported two stale patterns instead of silently passing — the guard added in TASK-96 doing its job.
<!-- SECTION:NOTES:END -->
