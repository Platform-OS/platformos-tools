---
id: TASK-61
title: >-
  MEASURED NON-FINDING: a modules-only project (no app/) is classified and
  walked correctly
status: Done
assignee: []
created_date: '2026-08-05 19:02'
updated_date: '2026-08-05 19:03'
labels:
  - supervisor
  - classification
  - modules
dependencies: []
priority: high
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## This task was filed on a premise I invented, and the maintainer corrected it

I assumed a module DEVELOPER's project root would be the module itself, so the tree would
start at `public/`/`private/`. **That is not how platformOS works.** Corrected by the
maintainer: *"modules always live in /modules next to /app, but app may not be present."*

So the real shape is `modules/<name>/{public,private}/…` at the project root, with `app/`
optionally absent — and that shape was never in doubt from the classifier's side.

## The corrected measurement: it works

Probed `walkAppSourceFiles` + `getFileType` against a `MockFileSystem` rooted at
`file:///repo` containing ONLY `modules/shop/…` and a `README.md`, with **no `app/`
directory at all**:

| path | classified as |
|---|---|
| `modules/shop/private/views/pages/index.liquid` | Page |
| `modules/shop/public/graphql/get.graphql` | GraphQL |
| `modules/shop/public/translations/en.yml` | Translation |
| `modules/shop/public/views/partials/card.liquid` | Partial |

Walk total: 4. The absent `app/` subtree costs nothing — `expandSubtree` skips a directory
that does not exist rather than failing, and `APP_SOURCE_SUBTREES` already carries
`modules/*/public` and `modules/*/private` as first-class entries.

Root detection also holds: `findRoot`'s markers are `app/`, `modules/`, `.pos` and
`.platformos-check.yml` (see `cli.ts`'s error text), so `modules/` alone identifies a
project root.

## What survives from the original filing

Only this, and it belongs to TASK-60 rather than here: **`misplaced_source` must be a
non-blocking WARNING**, which the maintainer confirmed directly. The dramatic argument I
built for it (that it would fire on every file in a module repo) was based on the wrong
premise and is withdrawn.

Kept as a record rather than deleted, because the measurement is worth having: nothing
previously verified that a modules-only project walks and classifies correctly, and now
something does. If a regression ever makes `app/` mandatory, this is the shape to test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recorded as a measured non-finding — no code change required
- [ ] #2 The measured shape (modules-only, no app/) is worth a permanent regression test if `APP_SOURCE_SUBTREES` or the walk is ever changed
<!-- AC:END -->
