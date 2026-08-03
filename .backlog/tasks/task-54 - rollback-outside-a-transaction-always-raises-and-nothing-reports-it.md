---
id: TASK-54
title: '{% rollback %} outside a transaction always raises, and nothing reports it'
status: To Do
assignee: []
created_date: '2026-08-03 13:46'
labels:
  - check-common
  - missed-detection
  - eval-final
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidTagSyntax.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Found while doing TASK-48, which fixed the false block on `{% rollback %}`. That fix was correct and this is the other half of the picture, deliberately left out of scope there.

Measured against `/api/app_builder/liquid_exec`:

```liquid
{% rollback %}                                        parses, then RAISES
                                                      "rollback performed outside of transaction"

{% transaction %}{% rollback %}{% endtransaction %}   parses, WORKS
                                                      raises ActiveRecord::Rollback, which IS the rollback
```

So `{% rollback %}` with no enclosing `{% transaction %}` **always** fails at render time. It is not input-dependent and not a heuristic: the enclosing block is a static property of the file.

Nothing reports it today. TASK-48's fix exempts `rollback` from `InvalidTagSyntax`, which is right — the syntax is valid — but that leaves the semantic error unreported.

## Severity

Missed detection, the lowest band, which is why this is LOW. It is worth doing because the failure is deterministic and cheap to detect, unlike most runtime errors this repo deliberately leaves alone.

## Approach constraints

**This is not a syntax question**, so `liquid-html-syntax-error` is the wrong home — that check reports things the parser could not parse, and this parses fine. It needs its own check, or a home with the other ancestor-dependent rules if one exists. Check first: `unclosed-html-element` already reasons about ancestors and may have a reusable shape.

**Blocking is a separate decision, and the default is NO.** `blocksWrite` requires severity `error` AND membership of `BLOCKING_CHECKS`. Membership needs the file to be genuinely broken — and a page containing a stray `{% rollback %}` DOES raise, so it arguably clears the bar. Measure the HTTP response before deciding: a raise that returns 500 is a different case from one the platform swallows. Do not add it to `BLOCKING_CHECKS` without that measurement.

**Watch the ancestor walk.** `{% rollback %}` may sit inside a partial that is only ever rendered from within a transaction in the caller. That makes a whole-file ancestor check a potential FALSE POSITIVE on a legitimate partial — the same shape as the `hash_assign` on a never-assigned variable decision, which stays silent for exactly this reason. Settle whether a partial can inherit a caller's transaction before reporting across file boundaries; if it can, the check must only fire when it can see the whole picture.

## Falsifier

A `{% rollback %}` with no enclosing `{% transaction %}` that renders without raising — for example inside a partial rendered from a transaction in its caller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A {% rollback %} with no enclosing {% transaction %} in the same file is reported
- [ ] #2 A {% rollback %} inside {% transaction %} stays silent — the control
- [ ] #3 The partial case is settled by measurement: whether a partial rendered from inside a caller's transaction inherits it, and the check does not fire where it cannot tell
- [ ] #4 Whether it blocks is decided from a measured HTTP response, not from the fact that it raises
- [ ] #5 If it changes what the MCP server reports, transport/instructions.ts is updated in the same change
<!-- AC:END -->
