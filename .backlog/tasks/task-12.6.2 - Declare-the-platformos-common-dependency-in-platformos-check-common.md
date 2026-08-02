---
id: TASK-12.6.2
title: Declare the platformos-common dependency in platformos-check-common
status: Done
assignee: []
created_date: '2026-07-31 16:41'
updated_date: '2026-07-31 18:10'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Six packages were undeclared, not one

The audit found `@platformos/platformos-common` undeclared in **five** packages, and
`@platformos/liquid-html-parser` undeclared in check-node as well:

| Package | Added |
|---|---|
| `platformos-check-common` | `@platformos/platformos-common` |
| `platformos-check-browser` | `@platformos/platformos-common` |
| `platformos-check-node` | `@platformos/platformos-common`, `@platformos/liquid-html-parser` |
| `platformos-language-server-common` | `@platformos/platformos-common` |
| `platformos-language-server-node` | `@platformos/platformos-common` |
| `vscode-extension` | `@platformos/platformos-common` |

`tsconfig.json` `paths` + `references` were added to check-node and check-browser to
match (they resolved through built `dist` before).

## Version chosen: exact `0.0.17`

Deliberately, not copied blindly. `platformos-common` is at 0.0.17 and is NOT in any
changesets `fixed` group, so it versions independently. Exact pins are the existing
convention for workspace-internal deps here (`platformos-check-*` pin each other
exactly), and `updateInternalDependencies: "patch"` rewrites the range when common
bumps.

**Alignment considered and not taken.** Adding `platformos-common` to the
`platformos-check-*` `fixed` group would guarantee that a check-common release can
never depend on a published common that predates an API it uses. `liquid-html-parser`
already has that same relationship without being grouped, so grouping only common
would be inconsistent, and it changes release behaviour beyond this task. The
safeguard relied on instead is a changeset for common in every change that touches it
(`.changeset/lazy-app-model.md` bumps common, check-common, check-node,
check-browser, and both language-server packages together).

## Acceptance criteria

- #1 ✔
- #2 ✔ machine-verified, not by inspection:
  `platformos-common/src/app/workspace-dependencies.spec.ts` scans every workspace
  package's `src/` for `@platformos/*` specifiers and fails on any that the package's
  own manifest does not declare. It runs with the normal suite.
- #3 ✔ `yarn build` and the full suite pass.
<!-- SECTION:NOTES:END -->
