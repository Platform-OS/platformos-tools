---
id: TASK-12.6.2
title: Declare the platformos-common dependency in platformos-check-common
status: To Do
assignee: []
created_date: '2026-07-31 16:41'
labels:
  - packaging
  - check-common
dependencies: []
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/platformos-check-common` imports `@platformos/platformos-common` in **20 source files** (`path.ts`, `index.ts`, `types.ts`, `context-utils.ts`, `find-root.ts`, `liquid-doc/arguments.ts`, `checks/translation-utils.ts`, `checks/missing-page/index.ts`, …) but does not list it in its `package.json`. It resolves today only because yarn workspaces hoist it to the root `node_modules`.

Found while designing TASK-12.6. It is a latent packaging bug on its own — a consumer installing the published `@platformos/platformos-check-common` outside this workspace gets an unresolvable import — and it becomes load-bearing the moment the `App` model (12.6.1) lives in `platformos-common` and check-common consumes it.

Only `@platformos/platformos-graph` currently declares the dependency (at `0.0.17`), so pick the version deliberately rather than copying that pin blindly, and check whether the two should be aligned.

Also confirm the same class of omission does not exist elsewhere: check every package that imports `@platformos/*` against its declared dependencies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 platformos-check-common declares @platformos/platformos-common in its package.json dependencies at a version consistent with the workspace
- [ ] #2 Every package that imports an @platformos/* module declares it — verified by a check over all packages, not by inspection of this one
- [ ] #3 yarn build and yarn test pass, and the built check-common resolves platformos-common without relying on root hoisting
<!-- AC:END -->
