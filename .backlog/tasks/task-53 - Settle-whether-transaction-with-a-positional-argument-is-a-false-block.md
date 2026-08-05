---
id: TASK-53
title: 'Settle whether {% transaction %} with a positional argument is a false block'
status: To Do
assignee: []
created_date: '2026-08-03 11:15'
updated_date: '2026-08-04 12:48'
labels:
  - liquid-html-parser
  - unsettled
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
priority: medium
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why this is a task and not a finding

Found while verifying the final eval round, and **not settled** — it needs an oracle nobody has run against it yet. Filing it so it is not lost, and so nobody "fixes" it on the strength of the observation alone.

## The observation

```
{% transaction t %}x{% endtransaction %}         BLOCKS
  LiquidHTMLSyntaxError: Invalid syntax for tag 'transaction' Expected syntax: transaction timeout: 5

{% transaction %}x{% endtransaction %}           allows
{% transaction timeout: 5 %}x{% endtransaction %} allows
```

So the tag accepts no-argument and named-argument forms, and refuses a bare positional one.

## Why it is NOT covered by TASK-47

TASK-47 lists `transaction` among the tags whose **named-argument values** refuse a filter. This is a different shape: a positional argument with no filter involved at all. Conflating the two is exactly the "two separate facts that are easy to conflate" error a previous round made with range bounds versus `for … in` sources.

## What has to happen before any code changes

`pos-cli deploy --dry-run` on `{% transaction t %}…{% endtransaction %}`, paired with the two accepted forms as controls, repeated — because the eval's own §6.4 records a dry-run harness that scored "the probe did not finish" as "the converter rejected it", and three rows flipped on re-probe.

Then read the platformOS documentation for `transaction`, because "the converter accepts it" and "it means something useful" are different questions, and a positional argument the converter tolerates but ignores is not worth widening the grammar for.

Two possible outcomes, both fine:
- the converter rejects it → the current block is CORRECT, and this task closes by recording the measurement so the next person does not re-open it;
- the converter accepts it → a false block, and the fix is a grammar change with the usual five layers.

## Do not

Widen the grammar on the strength of "it looks inconsistent with the other tags". Grammar symmetry has been the wrong guide every single time it has been used in this codebase — the filter rule follows each Ruby tag's own markup parsing, not a pattern.

## Falsifier

Either dry-run outcome settles it; there is no ambiguity once measured.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The converter's verdict on {% transaction t %} is measured with repeats and with the two accepted forms as paired controls
- [ ] #2 The documented meaning of a positional argument to transaction is established, or its absence recorded
- [ ] #3 If it is a false block, it is fixed with all five grammar layers and round-trip verified through the formatter
- [ ] #4 If the block is correct, the measurement is recorded as a fixture asserting the block, so the observation cannot be re-reported as a defect
<!-- AC:END -->
