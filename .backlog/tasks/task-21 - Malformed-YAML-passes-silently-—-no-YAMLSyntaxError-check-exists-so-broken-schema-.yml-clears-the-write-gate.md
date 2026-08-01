---
id: TASK-21
title: >-
  Malformed YAML passes silently — no YAMLSyntaxError check exists, so broken
  schema/*.yml clears the write gate
status: To Do
assignee: []
created_date: '2026-07-31 14:10'
updated_date: '2026-08-01 20:11'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
  - mcp-supervisor
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
modified_files:
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-node/configs/recommended.yml
  - packages/platformos-check-node/configs/all.yml
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Reported by the evaluating agent, and reproduced independently against the built `check-node` before the report arrived:

```
translation, VALID yaml       => []
translation, MALFORMED yaml   => []      <- silently clean
schema yml, MALFORMED         => []      <- silently clean
```

Inputs used: `en:\n  hello: [unclosed\n   bad: : :\n` and `name: thing\nfields: [ unclosed\n`. Both are unparseable YAML. Both produce ZERO offenses, so `validate_code` returns `status: ok`, `must_fix_before_write: false`.

## Root cause

`checkYAMLFile` in `packages/platformos-check-common/src/index.ts` (~line 327):

```ts
async function checkYAMLFile(check: YAMLCheck, file: YAMLSourceCode): Promise<void> {
  if (check.onCodePathStart) await check.onCodePathStart(file);
  if (file.ast instanceof Error) return;      // <- parse error swallowed
  ...
}
```

That early return is not itself the bug — every type has the equivalent line. The bug is that YAML has no check that REPORTS the parse failure, while the other types do:

| type | syntax check | malformed input |
|---|---|---|
| LiquidHtml | `LiquidHTMLSyntaxError` | reported |
| JSON | `JSONSyntaxError` / `ValidJSON` | reported |
| **YAML** | **none exists** | **silent** |

The only two checks declaring `type: SourceCodeType.YAML` are `MatchingTranslations` and `ValidHTMLTranslation` — both translation-CONTENT checks. So `app/schema/*.yml`, custom model types, profile types and transactable types get NO structural validation whatsoever.

## Why this is worse than a missing warning

It is the false-approval class (cf. TASK-13, TASK-18, TASK-20), and this one clears the write gate:

- broken JSON BLOCKS the write — `ValidJSON` is in `BLOCKING_CHECKS`
- broken YAML returns `must_fix_before_write: false`

An agent writing a corrupt `schema/*.yml` is told to proceed, and a broken schema file is a deploy-breaker rather than a cosmetic defect.

It also makes the tool description inaccurate: `validate_code` advertises "Liquid/GraphQL/YAML" when YAML gets translation checks only.

## Fix

Add a `YAMLSyntaxError` check in check-common, mirroring `JSONSyntaxError` exactly — same shape, same severity, reporting the captured `Error` from `toYAMLAST`. No new mechanism is required; the gap is that this one file was never written.

Then:

1. register it in `src/checks/index.ts` -> `allChecks` and in `recommended`
2. rebuild check-node so the generated factory configs (`configs/all.yml`, `recommended.yml`) pick it up — see check-node's CLAUDE.md
3. add `YAMLSyntaxError` to `BLOCKING_CHECKS` in `packages/platformos-mcp-supervisor/src/result/blocking.ts` (a file that does not parse cannot work, which is the set's membership rule)
4. correct the `validate_code` DESCRIPTION if YAML coverage stays narrower than the prose implies

## Blast radius — decide before implementing

This is check-common, so it lands in the CLI and the language server too, not just the supervisor. Every project containing a malformed YAML file starts seeing a NEW error in `pos-cli check` and in the editor. That is correct behaviour, but it is a visible change for existing users and may fail CI somewhere that is currently green.

## Adjacent, UNVERIFIED — check before assuming

`toGraphQLAST` never fails: it wraps the source string without parsing (`{ type: 'Document', content: source }`). So `.graphql` files may have the same silent-syntax-error gap. `GraphQLCheck` validates operations against the schema and may or may not surface a pure syntax error first. This was NOT tested — verify it rather than assuming either way, and split it into its own task if it is a real gap.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Malformed YAML reports a `YAMLSyntaxError` offense instead of nothing
- [ ] #2 Verified for BOTH a translation file and a `schema/*.yml`, since the latter has no other checks at all
- [ ] #3 Valid YAML still produces no offense (no false positives), including the multi-document and empty-file cases
- [ ] #4 `must_fix_before_write: true` for malformed YAML through the supervisor
- [ ] #5 The offense carries a usable position (line/column of the parse failure), not 0:0, so an agent can act on it
- [ ] #6 Factory configs regenerated and committed
- [ ] #7 check-common, check-node, LSP and CLI suites pass; the new error is confirmed to appear in `pos-cli check` output
- [ ] #8 The GraphQL question above is either resolved or split into its own task
<!-- SECTION:DESCRIPTION:END -->

- [ ] #9 The check reports SYNTAX only. Explicitly NOT in scope: unknown property types, duplicate property names, or any schema-shape validation — measured, the deploy converter accepts all of those
- [ ] #10 Verified for all FOUR YAML file types, not just schema: CustomModelType (app/schema, custom_model_types, model_schemas), TransactableType, InstanceProfileType, and Translation
- [ ] #11 `toYAMLNode` preserves the parse failure's POSITION, not only its message — AC#5 cannot be met without this, and recovering the position by parsing the message string is forbidden by non-goal #2
- [ ] #12 Adding it to BLOCKING_CHECKS requires a fixture in blocking-emission.spec.ts; the exhaustiveness guard there fails otherwise, which is the intended workflow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ROUND 3 (2026-08-01) re-measured this and it is worse and narrower than recorded — both of which change the fix.

SEVERITY IS HIGHER THAN 'deploy-breaker'. O1c settles it: `pos-cli deploy --dry-run` REJECTS invalid YAML with `Body contains invalid YAML: did not find expected '-' indicator at line 3`, and a converter rejection fails the WHOLE CHANGESET, not just the offending file. So a silently-approved broken .yml takes every other file in the deploy down with it. That is the strongest membership argument in BLOCKING_CHECKS' own rule.

SCOPE IS NARROWER, which makes the fix much smaller. Rounds 1 and 2 recorded this as 'model/translation YAML is not validated', which implies a schema validator. Probed separately against the converter:

| Defect in model YAML | validate_code | deploy converter |
|---|---|---|
| invalid YAML SYNTAX | ok | REJECTED |
| unknown property `type:` | ok | accepted |
| duplicate property name | ok | accepted |

The converter does not care about schema semantics. The ENTIRE cost of this gap is syntax. Do not build a model-schema validator.

SCOPE CORRECTION TO ROUND 3 ITSELF — it is FOUR file types, not three. Round 3 reported schema / transactable_types / user_profile_types, excluding translations on the grounds that translations already have checks targeting them. They do, but both are CONTENT checks and neither reports a parse failure: `valid-html-translation/index.ts:22` early-returns unless the path contains `/translations/`, and `matching-translations/index.ts:74` bails explicitly on `ast instanceof Error`. Measured through the real pipeline with verified-invalid YAML (bad indent, unclosed flow, tab indent):

```
app/schema/g.yml              ok  block=false errs=0
app/transactable_types/z.yml  ok  block=false errs=0
app/user_profile_types/z.yml  ok  block=false errs=0
app/model_schemas/m.yml       ok  block=false errs=0
app/translations/en.yml       ok  block=false errs=0   <- reported as covered; is not
```

Every member of YAML_FILE_TYPES (path-utils.ts:135) is uncovered for syntax.

CONCRETE BLOCKER FOR AC#5 (usable position), which round 3's 'the parse result already exists' understates. The message survives; the position does not. `yaml/parse.ts:38` is

    throw new YAMLConvertError(doc.errors[0].message);

and `doc.errors[0]` carries `pos: [47, 48]` and `linePos: [{line:5,col:1},{line:5,col:2}]`, both discarded. A check written against the Error as it stands reports 1:1 for every file. Recovering the position by regexing the message is exactly what non-goal #2 forbids. So this is TWO small changes, not one: carry the position through `YAMLConvertError` first, then write the check.

STILL UNRESOLVED, carried from AC#8: `toGraphQLAST` never fails — it wraps the source without parsing. Round 3 did not test whether a pure `.graphql` syntax error is caught by `GraphQLCheck` before schema validation. Verify rather than assume; split into its own task if it is a real gap.
<!-- SECTION:NOTES:END -->
