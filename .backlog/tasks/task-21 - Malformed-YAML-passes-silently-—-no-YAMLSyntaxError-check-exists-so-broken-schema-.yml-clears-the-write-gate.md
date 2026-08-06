---
id: TASK-21
title: >-
  Malformed YAML passes silently — no YAMLSyntaxError check exists, so broken
  schema/*.yml clears the write gate
status: Done
assignee: []
created_date: '2026-07-31 14:10'
updated_date: '2026-08-01 22:00'
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
- [x] #1 Malformed YAML reports a `YAMLSyntaxError` offense instead of nothing
- [x] #2 Verified for BOTH a translation file and a `schema/*.yml`, since the latter has no other checks at all
- [x] #3 Valid YAML still produces no offense (no false positives), including the multi-document and empty-file cases
- [x] #4 `must_fix_before_write: true` for malformed YAML through the supervisor
- [x] #5 The offense carries a usable position (line/column of the parse failure), not 0:0, so an agent can act on it
- [x] #6 Factory configs regenerated and committed
- [x] #7 check-common, check-node, LSP and CLI suites pass; the new error is confirmed to appear in `pos-cli check` output
- [x] #8 The GraphQL question above is either resolved or split into its own task
<!-- SECTION:DESCRIPTION:END -->

- [x] #9 The check reports SYNTAX only. Explicitly NOT in scope: unknown property types, duplicate property names, or any schema-shape validation — measured, the deploy converter accepts all of those
- [x] #10 Verified for all FOUR YAML file types, not just schema: CustomModelType (app/schema, custom_model_types, model_schemas), TransactableType, InstanceProfileType, and Translation
- [x] #11 `toYAMLNode` preserves the parse failure's POSITION, not only its message — AC#5 cannot be met without this, and recovering the position by parsing the message string is forbidden by non-goal #2
- [x] #12 Adding it to BLOCKING_CHECKS requires a fixture in blocking-emission.spec.ts; the exhaustiveness guard there fails otherwise, which is the intended workflow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two changes, in the order the notes predicted.

1. `yaml/parse.ts` — the parse failure now carries WHERE it happened. `YAMLConvertError` holds a `readonly failures: YAMLParseFailure[]` (message, offset, length) instead of a bare message string. `parseDocument` is called with `prettyErrors: false`, which keeps the parser's message as its own sentence: with the default the library appends ` at line N, column M:` plus a source snippet, and the only route back to a clean message would have been a regex over English. Offsets are clamped to the source, because `yaml` points one PAST the last character for an unterminated construct.

2. `checks/yaml-syntax-error/` — new check, `SourceCodeType.YAML`, `Severity.ERROR`, recommended. Reports from `onCodePathStart`, which is the seam `JSONSyntaxError` uses and the only hook `checkYAMLFile` runs BEFORE it returns on an unparseable document. Reports EVERY failure the parser recovered from, not just the first. Falls back to a whole-file range for a non-`YAMLConvertError` failure (a document that parsed but could not be mapped to the shared node model) so that case is never silent either.

Registered in `checks/index.ts`; factory configs regenerated via `yarn generate-factory-configs` (both `all.yml` and `recommended.yml` gained the entry). Added to `BLOCKING_CHECKS` with the measured justification, plus its fixture in `blocking-emission.spec.ts` — the exhaustiveness guard demanded it, exactly as AC#12 anticipated.

Agent-facing text corrected: the tool description now says "Liquid, GraphQL and YAML", and the server instructions replace `YAML SYNTAX IS NOT VALIDATED` with what is now true AND what still is not (schema SHAPE is unchecked, because the converter accepts unknown property types and duplicate names).

THE ONE DECISION THAT COULD HAVE SHIPPED A FALSE BLOCK, found by testing an assumption rather than trusting it. `parseDocument` raises `MULTIPLE_DOCS` on a multi-document file — and multi-document YAML is VALID YAML. The parser is objecting to being asked for a single document, not to the file; it still returns a fully parsed first document (`{"name":"a"}`). Reporting it would have put a blocking refusal on every such file for a reason no author could act on except by restructuring valid input.

`toYAMLNode` therefore drops that error specifically, and if nothing else remains it does not throw at all. The cost is stated rather than hidden: documents after the first are not parsed, so a syntax error inside one is invisible. That is a property of the parser, not of the filter — measured, `yaml` reports MULTIPLE_DOCS INSTEAD OF a syntax error in document two, never alongside it — so the filter loses no diagnostic that was ever available. Both halves are pinned.

I had written this case into the spec as 'stays silent, obviously' before running it. It did not. That is the second assumption this task falsified.

TWO OTHER ASSUMPTIONS FALSIFIED, both mine, both caught by asserting exact values instead of 'reports something':

- The offense position. I predicted the failure would point at the offending token (4:2); it points at the start of the line (4:0). Expectations corrected to measured.
- `app/views/pages/notes.yml` was written as a case proving the check ignores non-YAML directories. It does not — check-common's `check()` harness types any `.yml` as a YAML source regardless of path; directory filtering lives in check-node/`isSupportedSourceFile`, a different layer. The test was removed rather than adjusted, because it was asserting the wrong layer's behaviour. Real routing is covered by the supervisor's emission fixture.

AC#8 RESOLVED — NOT A GAP, so no follow-up task. The carried concern was that `toGraphQLAST` never fails (it wraps the source without parsing), so `.graphql` syntax errors might be silent the way YAML's were. Probed through the real pipeline:

```
unclosed brace        error  block=true  GraphQLCheck: Syntax Error: Expected Name, found <EOF>.
stray token           error  block=true  GraphQLCheck: Syntax Error: Expected Name, found "@".
empty selection set   error  block=true  GraphQLCheck: Syntax Error: Expected Name, found "}".
not graphql at all    error  block=true  GraphQLCheck: Syntax Error: Unexpected Name "this".
```

`GraphQLCheck` parses the document itself as part of validating it against the schema, so the syntax error surfaces there and blocks. The lazy `toGraphQLAST` is harmless because nothing depends on it to detect this.

VERIFICATION. Before: all five YAML directory families returned `status: ok`, `block=false`, `errs=0` on genuinely invalid YAML. After, through the real supervisor pipeline:

```
app/schema/g.yml              error  block=true  errs=1
app/transactable_types/z.yml  error  block=true  errs=1
app/user_profile_types/z.yml  error  block=true  errs=1
app/translations/en.yml       error  block=true  errs=1
app/model_schemas/m.yml       error  block=true  errs=1
```

CLI confirmed separately (AC#7) — `platformos-check` on a temp project emits `YAMLSyntaxError` with `start: {line: 4, character: 0}`, a real position rather than 0:0.

SABOTAGE-VERIFIED twice: reverting the position to 0/0 fails 5 tests across the parse and check specs; removing the MULTIPLE_DOCS filter fails 4. Suites: check-common 84 files / 1142 tests green, full monorepo green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
YAML was the only source type with no syntax check. The parse failure was computed by `toYAMLAST` and stored on `file.ast`, and nothing ever read it — so a malformed `.yml` produced no diagnostic in any of the four admitted YAML file types, while `pos-cli deploy --dry-run` rejected the same file and failed the WHOLE changeset with it.

Closed with two small changes: the parse layer now carries the failure's position (offsets the `yaml` package already computed and the old code discarded), and a new `YAMLSyntaxError` check reports them. Registered, configs regenerated, added to `BLOCKING_CHECKS`, and the agent-facing text corrected in both directions — it now claims YAML, and it now says explicitly that schema SHAPE is still unchecked, because the converter accepts unknown property types and duplicate names.

Scoped to syntax deliberately: semantic defects were probed against the converter and it accepts them, so a schema model would block nothing real.

Three assumptions were falsified while building it, each by asserting an exact value rather than "reports something" — the offense position, which layer filters file paths, and most importantly that a multi-document file parses cleanly. It does not: `parseDocument` raises `MULTIPLE_DOCS`, and reporting that would have put a false block on every multi-document file. That error is now filtered, with the trade-off pinned from both sides.
<!-- SECTION:FINAL_SUMMARY:END -->
