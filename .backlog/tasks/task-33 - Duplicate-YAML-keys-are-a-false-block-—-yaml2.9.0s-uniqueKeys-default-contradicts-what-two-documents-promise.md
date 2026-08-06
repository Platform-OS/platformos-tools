---
id: TASK-33
title: >-
  Duplicate YAML keys are a false block — yaml@2.9.0's uniqueKeys default
  contradicts what two documents promise
status: Done
assignee: []
created_date: '2026-08-02 07:08'
updated_date: '2026-08-02 09:07'
labels:
  - mcp-supervisor
  - check-common
  - false-block
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/checks/yaml-syntax-error/index.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

A YAML buffer with a repeated key (`a: 1` then `a: 2`, top-level or nested) is refused by `validate_code` with `YAMLSyntaxError: Map keys must be unique` and `must_fix_before_write: true`, in all four admitted YAML file types (schema, translations, transactable_types, user_profile_types). 8 of 8 probes blocked.

`pos-cli deploy ps --dry-run` ACCEPTS all three duplicate-key shapes. So this is a false block: the supervisor refuses a write the platform would take. Found by the round-4 evaluation and confirmed independently in this repo.

## Why it is a false block and not a defensible strictness choice

The repo says twice, in prose, that this behaviour is absent. Both statements are backed by correct measurement against the converter:

1. `packages/platformos-check-common/src/checks/yaml-syntax-error/index.ts:24-28` says SYNTAX ONLY, DELIBERATELY, and names duplicate property names as something the converter accepts.
2. `packages/platformos-mcp-supervisor/src/transport/instructions.ts:89-91` tells the agent that an unknown property or a duplicated name is not reported, because the platform accepts both.

An agent that reads the server instructions is told duplicates are fine, then gets a hard refusal.

## Cause (verified)

`packages/platformos-check-common/src/yaml/parse.ts:62` calls parseDocument with `{ prettyErrors: false }`. yaml@2.9.0 defaults `uniqueKeys: true`, so a repeated key lands in `doc.errors` as `DUPLICATE_KEY`. Line 76 filters only `MULTIPLE_DOCS`, so `DUPLICATE_KEY` survives into `YAMLConvertError`, `YAMLSyntaxError` reports it, and `blocking.ts` refuses the write.

Confirmed directly: with `{prettyErrors:false}` the parser returns `DUPLICATE_KEY: Map keys must be unique`; adding `uniqueKeys:false` returns no errors.

`uniqueKeys` appears nowhere in the repository, and no spec mentions duplicate keys. The promise made in both documents was never tested.

## Scope note

The fix is one parser option, but shipping the option alone repeats the mistake that produced the bug: a measured decision recorded only in prose, with nothing that fails when the code stops honouring it. The silence must be pinned by tests in the same change. Generalising that guard shape to the other blocking checks is separate work (TASK-34).

## Falsifier

A `--dry-run` that REJECTS a duplicate-key YAML file. Then the block is correct and both documents are wrong instead, and the finding inverts rather than disappears. Re-check before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A YAML buffer with duplicate keys (top-level and nested) in all four admitted YAML file types returns status ok and must_fix_before_write false
- [x] #2 The parser option is documented at the call site with the same rigour as the adjacent MULTIPLE_DOCS filter: what was measured against the converter, and what suppressing it costs
- [x] #3 Genuine YAML syntax errors still block in all four file types, proving the check did not become decorative
- [x] #4 A test asserts the exact claim both documents make: duplicate property names and unknown schema properties produce NO diagnostic, so the prose in yaml-syntax-error/index.ts and instructions.ts can no longer drift from the code
- [x] #5 The .yaml spelling is covered alongside .yml, since isSupportedSourceFile accepts both and only .yml has ever been probed
- [x] #6 Test assertions follow the repo whole-value rule: the full offense array, not a length or membership check
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED 2026-08-02.

THE ONE-LINE FIX WAS NOT THE WHOLE FIX, and the probe that proved it is the most useful thing in this task. With `uniqueKeys: false` applied and nothing else, a duplicate key in `fr.yml` produced a NEW false report:

  MatchingTranslations  fr.yml  "The translation for 'hello' is missing"

`fr.yml` contains `hello`. Twice.

CAUSE: THIS REPO HAS TWO YAML READERS AND THEY DISAGREED. Translations do not load through `yaml/parse.ts` at all — they load through `js-yaml`, which ALSO rejects duplicate keys by default, and every caller wraps `load` in a `try`/`catch` that reads a throw as "this file has no translations". So a duplicated key did not merely go unreported there; it silently emptied the entire locale, and every key in it was then announced as missing. Shipping the parser flag alone would have converted a false BLOCK into a false ERROR on a different file, which is harder to trace and no less wrong.

WHAT LANDED: every YAML reader in the monorepo now resolves a repeated key the way the platform does — accepted, last value wins.

  yaml/parse.ts                  uniqueKeys: false            (the linter's AST)
  TranslationProvider.ts         4 sites                      (translation loading)
  context-utils.ts               2 sites                      (default translations)
  schema-table.ts                1 site                       (model table extraction)
  RouteTable.ts                  1 site                       (page frontmatter)
  DocumentsLocator.ts            1 site                       (theme_search_paths)
  graph/traverse.ts              1 site                       (graph frontmatter/schema)

Ten js-yaml call sites behind ONE documented constant, `PLATFORM_YAML_LOAD_OPTIONS` in platformos-common. The four beyond translations were the same defect waiting for a different trigger: a duplicated key cost a schema its table (so it stopped joining to the GraphQL operations targeting it), a page its route, a project its search paths, and a file its graph edges — each silently, each on a file this change now correctly reports as clean.

MEASURED, NOT ASSUMED: `json: true` is exactly as narrow as documented. Differential over 26 constructs — plain and quoted scalars, anchors and aliases, explicit tags, block scalars, flow collections, timestamps, octal and hex, `.inf`/`.nan`, comment-only and empty documents — ZERO output differences. Only duplicate handling changes.

CHECKED AND DELIBERATELY NOT CHANGED: `ValidFrontmatter` also calls `parseDocument` with library defaults, but it never reads `doc.errors`, and the parser keeps BOTH pairs whether or not `uniqueKeys` is set (verified: `errors=1 items=a:1,a:2` vs `errors=0 items=a:1,a:2`). Its behaviour is identical either way, so the option would be noise.

SABOTAGE-VERIFIED, each half independently, each reverted after measuring:
  - revert `uniqueKeys: false`  -> 6 check-common failures + 2 supervisor gate failures
  - revert `json: true`         -> exactly the 2 translation failures
Every silence assertion is paired with a control that must still fire, because "nothing was reported" is also what a check that stopped working looks like. The controls: a genuine syntax error in a file that ALSO has a duplicate key, and a genuinely missing translation between two locales that both repeat keys.

ON THE PREMISE. I did NOT re-run `--dry-run` myself — that deploys to a live instance. The claim rests on three independent prior measurements that agree: the round-4 evaluation's O1c (three duplicate shapes deployed individually, all accepted), and the two measurements recorded in this repo when `YAMLSyntaxError` was written (the check docstring and the server instructions). The falsifier is unchanged and cheap: one `--dry-run` that REJECTS a duplicate-key file inverts this task rather than closing it.

VERIFIED: 316 test files / 3 089 tests pass, type-check 0 errors, prettier clean.

NOT DONE, and worth a decision rather than a silent omission: a duplicated key is accepted by the platform but still loses a value. In a translations file that is silent data loss an author probably wants to know about. It is NOT a deployability question, so it must never touch `must_fix_before_write`, and adding it as a non-blocking advisory would contradict the sentence in `instructions.ts` that this task just made true. If it is wanted, it is a new check with its own severity decision, not a change here.
<!-- SECTION:NOTES:END -->
