---
id: TASK-97
title: >-
  An angle-bracketed URI in text is parsed as an HTML element, so a shipped file
  is a blocking error
status: To Do
assignee: []
created_date: '2026-08-26 13:49'
updated_date: '2026-08-26 13:59'
labels:
  - liquid-html-parser
  - grammar
  - false-block
  - measured
  - blocking-check
dependencies: []
references:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/index.ts
  - supervisor-tests/auto-eval/results/ROUND-2026-08-26/FINDINGS.md
  - supervisor-tests/auto-eval/suites/13-cli-parity.mjs
priority: medium
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

A URI written in angle brackets inside body text is refused as a syntax error, and the platform renders it correctly.

```liquid
{% capture m %}see <https://example.com/a|Name>{% endcapture %}OK[{{ m }}]
```

`LiquidHTMLSyntaxError` fires; the supervisor returns `must_fix_before_write: true`, so an agent cannot write the file. On a live instance the same buffer renders `OK[see &lt;https://example.com/a|Name&gt;]` — the brackets are escaped and printed, which is the intended result. Confirmed by O1c: `pos-cli deploy --dry-run` accepts it with its control accepted.

This is the Slack-link idiom (`<url|label>`). It occurs in one file of a 2,768-file production application, `app/api_calls/send_slack_message.liquid`, and it blocks that entire file.

## Why this is a different problem from the tag-markup false blocks

The other measured false blocks come from a tag's strict markup rule failing, so the markup is kept as a raw string and `InvalidTagSyntax` reports it. This one does not go through that path at all: `<https://…>` is consumed by the **HTML element** layer, which sees an opening tag whose name is `https:` and never finds a close. The mechanism, the fix and the risk are unrelated, which is why it is tracked separately.

## Bound the blast radius before changing anything

Loosening what counts as an HTML element name is the obvious fix and the dangerous one — it risks turning genuinely malformed HTML into silence, which trades a false block for a missed detection. Measure before narrowing:

- Which strings after `<` are currently treated as an element name, and which of those the platform actually parses as HTML.
- Whether a real unclosed element (`<div>` with no `</div>`) still reports after the change. That case must not go quiet.
- Whether the construct behaves the same outside `capture` — in plain page body text, in an `{% if %}` branch, and inside an HTML attribute value — since the reproduction above only establishes the `capture` position.
- Whether the printer round-trips the buffer unchanged both before and after. It survives formatting today because the surrounding text is emitted verbatim; confirm that still holds.

A scheme-like prefix followed by `//` is a plausible discriminator (an HTML element name cannot contain `:` followed by `//`), but it is a hypothesis to measure rather than a design to implement on sight.

## Evidence

- Round `ROUND-2026-08-26`, finding `S13-FB-angle-uri-in-capture`, severity FALSE_BLOCK, confirmed by O1c.
- Reproduction and control are in `supervisor-tests/auto-eval/suites/13-cli-parity.mjs`, in the `REDUCED` table. That row declares `expectSameOutput: false`, because its control deliberately removes the brackets and therefore renders different text — do not treat the output difference as evidence of misbehaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `{% capture m %}see <https://example.com/a|Name>{% endcapture %}` is accepted and does not set must_fix_before_write
- [ ] #2 The same construct is measured in at least three positions beyond capture (plain body text, inside a conditional branch, inside an HTML attribute value) and each measured-accepted position is covered by a fixture
- [ ] #3 A genuinely unclosed HTML element still reports, asserted in the same test file so the loosening cannot silently swallow it
- [ ] #4 A malformed construct that is NOT a scheme-like URI still reports, so the change admits the measured shape rather than everything after a `<`
- [ ] #5 The buffer round-trips through prettier unchanged
- [ ] #6 Deliberately reverting the change makes the new tests fail (sabotage-verified), recorded in the task notes
- [ ] #7 `pos-cli check` over the 2,768-file corpus reports no offense it did not report before, other than the intended change on this construct
- [ ] #8 The measurement that bounds the change is recorded in the task notes, including any position where the platform does NOT accept the construct
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Bounding measurement (2026-08-26) — carried out, and it CHANGES the fix

Every position rendered on `fk-docs.ps-01-platformos.com` via `/api/app_builder/liquid_exec`, one construct per request:

| position | platform |
|---|---|
| `{% capture m %}see <https://…|Name>{% endcapture %}` | renders (brackets escaped) |
| plain body text | renders |
| inside an `{% if %}` branch | renders |
| inside an HTML attribute value | renders |
| **`<div>` with no close (control)** | **renders** |
| **`<notaurl|Name>` — no scheme (control)** | **renders** |

**The platform validates no HTML whatsoever.** Liquid passes markup through as text, so the two controls render exactly like the URI case. Two consequences for this task:

1. **Platform parity gives NO guidance on where to draw the line.** "The platform accepts it" is true of every malformed HTML string, so it cannot be the discriminator — using it would justify deleting HTML checking entirely.
2. **AC #3 and AC #4 are not parity requirements, they are OUR value-add.** An unclosed `<div>` is a real defect in the author's HTML and worth reporting even though the platform renders it. `<notaurl|Name>` renders too, so a fix keyed on "does it render" would admit it as well.

So the change must be keyed on the SHAPE (a scheme-like prefix followed by `//`, which no HTML element name can contain), narrowly, and explicitly NOT on platform acceptance. This is a judgement about where our strictness belongs, not a parity fix — decide it before writing grammar.

This also means the task is **not ready to implement as filed**: the original description offered the scheme-prefix idea as a hypothesis to measure, and the measurement has now removed the parity justification for it while leaving the shape argument standing.
<!-- SECTION:NOTES:END -->
