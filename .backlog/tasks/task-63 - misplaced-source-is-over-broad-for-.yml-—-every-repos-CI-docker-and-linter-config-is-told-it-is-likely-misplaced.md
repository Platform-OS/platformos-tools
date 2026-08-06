---
id: TASK-63
title: >-
  misplaced-source is over-broad for .yml — every repo's CI, docker and linter
  config is told it is likely misplaced
status: To Do
assignee: []
created_date: '2026-08-05 20:03'
labels:
  - classification
  - check-node
  - agent-ergonomics
  - measured
dependencies: []
priority: medium
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
check-node's `lintBuffers` splits an out-of-app path two ways:

    if (!file) notChecked(sourceCodeTypeOf(uri) === undefined
      ? 'not-a-platformos-file'   // nothing parses it — routine
      : 'misplaced-source')       // "almost always a mistake"

`misplaced-source`'s own docblock says "Almost always a mistake: the platform will never load the file, so a partial, page or query here is dead code." That is true for `.liquid` and mostly true for `.graphql`. It is NOT true for `.yml`, and `.yml` is in the same branch because the only question asked is "does a parser accept the extension".

MEASURED, in the merged tree: `.platformos-check.yml` at the project root reaches `misplaced-source`, so the supervisor tells the author of THIS TOOLCHAIN'S OWN CONFIG FILE that it is "a platformOS source file outside every subtree the platform deploys ... Move it under one of those directories". The same applies to `docker-compose.yml`, `.github/workflows/ci.yml`, `config/database.yml` — anything `.yml` outside `app/`.

It is the mildest failure class: never a block (`not_applicable` sets `must_fix_before_write: false`), just confidently wrong advice. But wrong advice from a write gate is what gets a write gate ignored.

WHY IT WAS NOT FIXED IN TASK-60: the fix is a decision about which extensions carry a platformOS signal, made at the point where classification happens (check-node, or `platformos-common` if the fact belongs with the other extension tables). The supervisor is the wrong layer — it deliberately does NOT re-derive classification, and bolting a `.yml` exception onto `fileApplicability` would be the half-fix that addresses the example and not the class. Pinned as current behaviour in `adapter-input.spec.ts` ("admits the check config itself, leaving the verdict to the lint") so this has a test to flip rather than a behaviour to discover.

CANDIDATE RULE, unmeasured: a `.yml` is a platformOS source only by virtue of its DIRECTORY (`translations/`, `schema/`, `transactable_types/`, …) or of being one of the two fixed-path singletons (`app/config.yml`, `app/user.yml`). The extension alone carries nothing. So the useful question for a `.yml` is whether its path TAIL matches a type's directory grammar: `translations/en.yml` (missing its `app/` prefix — a real and common mistake) is misplaced; `docker-compose.yml` is not a platformOS file at all. `.liquid`/`.graphql` keep the current extension-only rule, since a stray one of those really is almost always a mistake.

Note this cuts both ways and the trade must be stated, not assumed: collapsing all stray `.yml` into `not-a-platformos-file` would silence the genuinely-useful "you forgot the `app/` prefix" case, which is why the tail-match rule is the candidate rather than the simpler collapse.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A rule is chosen with the trade-off written down: which extensions are misplaced-by-extension, and how a `.yml` is judged, including what the chosen rule LOSES
- [ ] #2 `translations/en.yml` at the project root (the forgotten-`app/`-prefix case) still reports `misplaced-source` — this is the control that stops the fix from being a blanket silencing
- [ ] #3 `.platformos-check.yml`, `docker-compose.yml` and `.github/workflows/ci.yml` report `not-a-platformos-file`, asserted as exact statuses in check-node's own spec
- [ ] #4 `scripts/helper.liquid` still reports `misplaced-source` — unchanged, and asserted so the `.liquid` rule is not collateral damage
- [ ] #5 The `misplaced-source` docblock in check-node's `LintBufferStatus` stops claiming "almost always a mistake" for a class where it is not, whichever rule lands
- [ ] #6 The supervisor pin in `adapter-input.spec.ts` for `.platformos-check.yml` is flipped, and `stdio-smoke.spec.ts` gains the `not-a-platformos-file` case end to end
<!-- AC:END -->
