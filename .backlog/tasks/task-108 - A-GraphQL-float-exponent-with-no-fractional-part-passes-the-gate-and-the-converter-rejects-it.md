---
id: TASK-108
title: >-
  A GraphQL float exponent with no fractional part passes the gate and the
  converter rejects it
status: To Do
assignee: []
created_date: '2026-09-07 06:46'
labels:
  - platformos-common
  - false-approval
  - measured
  - upstream
dependencies: []
priority: low
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while surveying TASK-105; split out because it is a different mechanism and the only finding in that survey with a genuinely upstream cause.

`query q($n: Float = 1e3)` parses here and is refused by the deploy:

```
graphql/zz_g_exp.graphql: Query string Query parse error:
  syntax error, unexpected IDENTIFIER ("e3"), expecting RPAREN or VAR_SIGN at [1, 29]
```

Measured against `pos-cli deploy --dry-run` on a live instance and reproduced locally against `graphql-c_parser` 1.1.3, the parser the platform actually runs.

`1e3`, `1E3`, `1e+3` and `1e-3` are all rejected. `1.0e3` and `1.0E+3` parse fine — the C lexer requires a fractional part before the exponent.

**This one is upstream.** `FloatValue : IntegerPart ExponentPart` is in the GraphQL spec, so `1e3` is valid GraphQL and `graphql-c_parser` is wrong to refuse it. Worth reporting to graphql-ruby. But the platform behaves this way today, so our gate still has to match it or we keep approving code that cannot deploy.

Deliberately NOT folded into TASK-105: that task fixes two families with one rule each, and this needs a third rule (walk `FloatValue` nodes for `/^[-+]?\d+[eE]/`) justified by a different argument. Low because the input is rare — a float default written in exponent notation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `FloatValue` written with an exponent and no fractional part is reported, wherever it appears in a `.graphql` document
- [ ] #2 CONTROL: `1.0e3`, `1.0E+3`, `1.5`, `-1.5` and `0.0` are still accepted — the platform takes all of them
- [ ] #3 The behaviour is re-measured against `graphql-c_parser` 1.1.3 rather than the pure-Ruby graphql parser, which answers differently
- [ ] #4 An issue is opened upstream against graphql-ruby, and this task links it
<!-- AC:END -->
