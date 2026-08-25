---
id: TASK-83.4
title: >-
  Report frontmatter YAML syntax errors — a tab or an unclosed flow rejects the
  deploy and nothing says so
status: Done
assignee: []
created_date: '2026-08-22 16:32'
updated_date: '2026-08-22 17:52'
labels:
  - platformos-check
  - mcp-supervisor
  - frontmatter
  - correctness
dependencies: []
parent_task_id: TASK-83
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Malformed YAML inside a frontmatter block is reported by nothing and rejects the whole changeset.

```liquid
---
slug: probe
	layout: application        ← tab indentation
---
```
Deploy: **REJECTED** — `Body contains invalid YAML: found a tab character that violates indentation at line 2`.
`validate_code`: one unrelated warning about the layout name; nothing about the tab.

```liquid
---
slug: probe
layout: [unclosed
---
```
Deploy: **REJECTED** — `Body contains invalid YAML: did not find expected ',' or ']' at line 3`.
`validate_code`: `{"status":"ok","must_fix_before_write":false}`.

The machinery exists and works — the same YAML in a standalone `.yml` file reports `YAMLSyntaxError` and blocks — but `YAMLSyntaxError` declares `type: SourceCodeType.YAML`, and check-common runs a check only against files of its own type, so a `.liquid` file never reaches it.

`ValidFrontmatter` already parses the block with `parseDocument` from `yaml` and discards `doc.errors`.

## Note on dialects

The linter reads YAML 1.2 (npm `yaml`); the platform reads YAML 1.1 (Ruby Psych). Both reject a tab, so this case agrees — but the expectation must be derived from what the parser actually reports rather than from a hand-written message, and any case where the two dialects disagree belongs in a test that says so.

This settles the tab-indentation question left open in `UPSTREAM-ISSUES-VERIFIED.md`.

## Shape

Surface the parse errors the existing `parseDocument` call already produces, under a new Liquid-typed code, at `error`, in `BLOCKING_CHECKS`. Positions must be mapped back through the frontmatter body offset so the range lands on the offending line in the `.liquid` file.

Depends on TASK-83.1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A tab-indented frontmatter block reports, with the range on the offending line of the .liquid file, and `validate_code` returns `must_fix_before_write: true`
- [x] #2 An unclosed flow sequence in frontmatter reports and blocks
- [x] #3 A well-formed frontmatter block reports nothing from this check, paired with a malformed one in the same test
- [x] #4 A file with no frontmatter block at all, and a file whose body merely contains `---`, report nothing
- [x] #5 When the block is unparseable, the field-level rules do not also fire on it, so one mistake produces one diagnostic
- [x] #6 The reported message and position are derived from the parser's own error rather than hand-written
- [x] #7 The new code has EMITS and STAYS_SILENT fixtures in validate-code.spec.ts, and removing it from BLOCKING_CHECKS makes a test fail (sabotage-verified)
- [x] #8 A changeset accompanies the change
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`InvalidFrontmatterSyntax` reports YAML in a frontmatter block that does not parse — error, blocking. This settles the tab-indentation question the audit left open: the converter rejects it and the linter said nothing.

The block was already being parsed; its `errors` were discarded. `YAMLSyntaxError` could not cover it because it declares `SourceCodeType.YAML` and the engine runs a check only against files of its own type.

**One mistake, one diagnostic.** The field-level rules now read through a new `wellFormedFrontmatterBlock` and stand down when the block does not parse — `parseDocument` recovers and returns a partial map, so they would otherwise report on whichever half survived. A control in the same test proves they still fire once it does.

Messages come from our parser rather than being written to match the platform's: the linter reads YAML 1.2 (npm `yaml`), the platform reads YAML 1.1 (Psych). Both refuse a tab and an unclosed flow collection, but they are not the same parser, so the tests pin the RANGE and the count rather than the wording.

Three sabotages bite: never collecting the errors, letting the field rules read the raw block again, and making the check report nothing.

Also corrected here: `YAMLSyntaxError`'s docblock recorded that "the converter accepts unknown property types", which a real deploy disproves. The syntax-only scoping stands, but on "no shape check exists yet" rather than on platform permissiveness. TASK-84 tracks the gap.
<!-- SECTION:FINAL_SUMMARY:END -->
