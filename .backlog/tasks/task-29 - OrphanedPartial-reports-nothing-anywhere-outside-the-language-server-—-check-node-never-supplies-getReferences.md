---
id: TASK-29
title: >-
  OrphanedPartial reports nothing anywhere outside the language server —
  check-node never supplies getReferences
status: Done
assignee: []
created_date: '2026-08-01 20:16'
updated_date: '2026-08-01 20:59'
labels:
  - bug
  - check-node
  - platformos-graph
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while implementing TASK-12.5 (2026-08-01).

`OrphanedPartial` is the toolchain's one whole-project check: it asks "does any file
render me?" and reads `context.getReferences` to find out. It returns silently when
that dependency is absent — and it is absent in `platformos-check-node`, which
builds its `Dependencies` without one.

So the check is a no-op in `pos-cli check` and in CI, which is precisely where
TASK-12.6.8 moved it to. The only runtime that supplies `getReferences` is the
language server (`AppGraphManager`), and `diagnostics/runChecks.ts` deliberately does
NOT wire it, so the check says nothing there either. An orphaned partial is currently
reported by nothing.

The dependency direction is why: building a reverse index means a dependency graph,
and `platformos-graph` sits ABOVE `platformos-check-node`. check-node cannot import
it. So the provider has to come from the caller — which is now possible:
`lintBuffer` accepts `getReferences` (TASK-12.5), and `platformos-graph` already
exposes `appBackedGetSourceCode` + `buildAppGraph` so a graph can share the App
model's parsed files rather than reparsing (TASK-12.6.5).

What is missing is the wiring for the CLI: `pos-cli check` runs `appCheckRun`, which
has no way to be handed a provider at all.

## Options

1. `appCheckRun` takes an optional `getReferences`, and the CLI entry point builds a
   graph when the config enables `OrphanedPartial`. Keeps the dependency direction
   (the CLI can depend on graph; the library cannot).
2. The graph moves below check-node. Large, and it inverts what TASK-12.6.5 just
   settled.
3. `OrphanedPartial` builds its own reverse index from the `App` — every Liquid file
   parsed, once per run, inside check-common. Simplest to wire, and the cost lands
   only in runs that enable the check; but it is a second implementation of what the
   graph already computes.

Whichever way, the check must either work or be removed: a check that is enabled by
`recommended` and can never fire is worse than no check, because a clean report reads
as "no orphans".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 OrphanedPartial reports a genuinely orphaned partial in pos-cli check
- [x] #2 A test pins the report end to end from the CLI entry point, not just from a stubbed provider
- [x] #3 The chosen option keeps platformos-graph above platformos-check-node, or documents why it moved
- [x] #4 The cost of building the reverse index is measured on a real project and paid only by runs that enable the check
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## RESOLVED BY REMOVAL — the check is gone (user decision, 2026-08-01)

The reverse index was built, wired and measured before the decision, and what it
showed is why the decision went the other way.

`check()` grew a lazily-built reverse index (`references.ts`) that resolved every
Liquid file's `render`/`include`/`theme_render_rc`/`function`/`background`/`graphql`
targets through `DocumentsLocator` — the same resolver the forward checks use — under
`singleFileOnly: false` only. It worked: `pos-cli check` reported orphans for the
first time, pinned end to end. Then, on real projects:

| project | partials | reported orphaned |
|---|---|---|
| pos-module-community | 678 | 231 — **every one** under `modules/*/public` |
| htevent | 1789 | 407 |
| arabbank | 2217 | 535 |
| Accala-MP | 1525 | 471 |

Two false-positive classes, neither fixable by a better index:

1. **A module's `public/` directory is its API.** Its callers are the apps that
   install the module, which are not in the repository. That was 100% of
   pos-module-community's hits. Excluding `access === 'public'` fixed that class.
2. **Partials invoked BY NAME.** arabbank runs commands through a dispatcher
   (`{% function ... = 'lib/commands/execute', mutation_name: 'authentications/delete' %}`)
   and authorization partials as callbacks
   (`{% include 'lib/can_do_or_redirect', access_callback: 'lib/can/theme_manage' %}`).
   No static reverse index sees either. Indexing every string literal that resolves
   to a partial was tried and measured: it recovered 2 of 535 on arabbank and 9 of
   231 on pos-module-community, while weakening "referenced" to "mentioned". Reverted.

Which left the check reporting 350-465 warnings per real app, a large share of them
wrong. Rather than ship that — or ship it disabled, which is a check nobody runs —
`OrphanedPartial` was removed.

**And with it, `singleFileOnly`.** It was the partition's only member, so
`CheckOptions.singleFileOnly`, `meta.singleFile` and `Dependencies.getReferences` are
gone too, along with `lintBuffer`'s `wholeProject`. Every remaining check answers for
one file, resolving against the project through indexes that are already cached, so
the editor, `pos-cli check` and `validate_code` now run exactly the same set. That is
a simpler contract than the one this task set out to complete.

Left for whoever wants orphan detection back: it needs the graph's reference model
plus the two idioms above understood (dispatcher targets, callback arguments), which
is a different piece of work from wiring a dependency.
<!-- SECTION:NOTES:END -->
