---
id: TASK-21
title: >-
  Malformed YAML passes silently — no YAMLSyntaxError check exists, so broken
  schema/*.yml clears the write gate
status: To Do
assignee: []
created_date: '2026-07-31 14:10'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
dependencies: []
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

## Acceptance criteria

- [ ] Malformed YAML reports a `YAMLSyntaxError` offense instead of nothing
- [ ] Verified for BOTH a translation file and a `schema/*.yml`, since the latter has no other checks at all
- [ ] Valid YAML still produces no offense (no false positives), including the multi-document and empty-file cases
- [ ] `must_fix_before_write: true` for malformed YAML through the supervisor
- [ ] The offense carries a usable position (line/column of the parse failure), not 0:0, so an agent can act on it
- [ ] Factory configs regenerated and committed
- [ ] check-common, check-node, LSP and CLI suites pass; the new error is confirmed to appear in `pos-cli check` output
- [ ] The GraphQL question above is either resolved or split into its own task
<!-- SECTION:DESCRIPTION:END -->
