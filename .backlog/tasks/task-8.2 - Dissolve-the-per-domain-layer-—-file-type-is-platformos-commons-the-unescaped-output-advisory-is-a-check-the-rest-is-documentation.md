---
id: TASK-8.2
title: >-
  Dissolve the per-domain layer — file type is platformos-common's, the
  unescaped-output advisory is a check, the rest is documentation
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
updated_date: '2026-08-16 11:59'
labels: []
dependencies:
  - TASK-7
references:
  - packages/platformos-common/src/path-utils.ts
  - packages/platformos-common/src/guards/directory-knowledge.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
  - ~/projects/pos/platformos-documentation
parent_task_id: TASK-8
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## This task was INVERTED on 2026-08-16

It previously said: build a per-domain intelligence layer in the supervisor — path→domain
detection, triggered gotchas from `domain-gotchas.yml`, content-trigger `tips` from
`content-triggers.yml`, and a `domain_guide` result field. **Do not build it.** Every one
of its four pieces now belongs to a package that already owns the question, and three of
them would fail an existing guard or invariant if written here.

The premise it rested on — "check-common has NO domain concept" — was true when it was
verified on 2026-06-09 and is not true now. What was called a *domain* is `PlatformOSFileType`,
it lives in `platformos-common`, and checks read it as `context.fileType`.

## Reading the old data files

`domain-gotchas.yml` and `content-triggers.yml` are no longer on disk. Recover them to a
scratch directory to enumerate what they contained:

```
git show 69aa9e4:docs/mcp-supervisor/salvage/data/domain-gotchas.yml
git show 69aa9e4:docs/mcp-supervisor/salvage/data/content-triggers.yml
```

They are INPUT to this task's classification, not content to restore. Nothing from them
lands in this repository as data — TASK-7's invariant 6 forbids the supervisor shipping
documentation, and invariant 4 forbids it owning a second detector framework. Each entry
leaves as a check, as an upstream documentation change, or as a recorded drop.

## Where each of the four pieces goes

**1. Domain detection → already owned, and writing it here fails a guard.**
`platformos-common` owns file identity: `PlatformOSFileType`, `getFileType(uri, rootUri)`,
`parseAppPath(relativePath)`, and `AppFile.fileType` derived once at construction. A check
reads `context.fileType`. `platformos-common/src/guards/directory-knowledge.spec.ts` scans
every workspace package's `src/` and fails on a second copy of the directory table, so a
`getDomainFromPath` in the supervisor breaks the build rather than shipping.

Note the v1 list was not a file-type list. It fused two different kinds of truth, which
ADR 004 has since separated: `pages`/`partials`/`layouts`/`graphql`/`schema`/`translations`
are platform types, but **`commands` and `queries` are a `core`-module CONVENTION** — a
partial under `lib/commands/<x>` invoked by `{% function %}`, which the platform itself
cannot see. Convention truth belongs in the configurable overlay TASK-9.7 owns, never in a
file-type table and never presented to an agent as a platform fact.

**2. Triggered gotchas → they are documentation, and each form already has a home.**
- `has_check:X` — a reminder attached to a check is that check's `meta.docs.description`
  and `meta.docs.url`. TASK-7.7 already attaches both. Nothing to add.
- `uses_tag:X` — a caveat about a tag belongs in that tag's entry in `tags.json`, filed
  upstream in `~/projects/pos/platformos-documentation`, and reaches the agent when
  enrichment renders the docset entry. If the caveat is worth telling an agent it is worth
  telling every reader of the docs.
- `always` (per file type) — platformOS architecture guidance. It is a documentation page
  and, at most, a URL; it is not prose compiled into an MCP server.

**3. Content-trigger tips → the one real deliverable here.**
The `| raw` advisory is a genuine finding and **no check covers it today** (verified: no
unescaped-output check exists in `platformos-check-common/src/checks/`). Restore it as a
check-common `CheckDefinition`, not as a regex over file content — `| raw` is a
`LiquidFilter` node, and the AST framework is what replaces the regex scanner. Scope it by
`context.fileType` where scoping is genuinely warranted rather than by a hand-written
domain list.

Severity is a judgement to make on measurement, not in advance: unescaped output is a real
XSS vector and also entirely legitimate in a template that is deliberately emitting markup.
Measure the rate on the projects in `~/projects/pos` before choosing between `info` and
`warning`, and it does **not** join `BLOCKING_CHECKS` — nothing about it stops the file
working.

Every other entry in the old `content-triggers.yml` gets the same treatment: it becomes a
check with a doc page, or it is dropped with the reason recorded.

**4. `domain_guide` and `tips` result fields → they stay deleted.**
TASK-12.5 (archived) removed both as permanently-empty stubs, because an agent cannot
distinguish an always-empty field from a meaningful one, and `assemble.spec.ts` pins the
exact result key set with each removed field asserted ABSENT. After points 1–3 there is
nothing left to populate them with: the guidance is a URL on a diagnostic and the tips are
diagnostics. Do not re-add them.

The one field worth *considering* is the file's `PlatformOSFileType` on the result — cheap,
already computed, and it tells an agent what kind of file it just wrote. Ship it only if it
demonstrably changes agent behaviour; absent that, it is another always-present field of
unclear value and the same TASK-12.5 reasoning applies.

## Knock-on

TASK-8.4 ("complete the result contract to v1 parity: `tips`, `domain_guide`, `structural`,
`parse_error`") loses two of its four fields to this decision, and TASK-8.5's v1-parity
baselines cannot be met on them either. Both need re-reading before they start — v1 parity
is no longer the target where v1 was wrong.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The supervisor contains no path-to-domain classifier and no domain vocabulary of its own; file type is read from platformos-common, and the directory-knowledge guard passes
- [ ] #2 The unescaped-output advisory ships as a check-common CheckDefinition over the LiquidFilter AST node, registered, with factory configs regenerated and a documentation page added to the documentation repo
- [ ] #3 Its severity is chosen from a measured rate over the real projects in ~/projects/pos, the numbers are recorded, and it is not added to BLOCKING_CHECKS
- [ ] #4 Every entry of the recovered content-triggers.yml and domain-gotchas.yml is dispositioned in a committed table: became a check, filed upstream, or dropped with a reason
- [ ] #5 Tag caveats that were gotchas are filed against tags.json upstream and the issues are linked from this task; no gotcha prose lands in this repository
- [ ] #6 tips and domain_guide remain absent from ValidateCodeResult and assemble.spec.ts still asserts them absent
- [ ] #7 No pos-supervisor:* code is introduced, the supervisor gains no data/ directory, and no salvaged data file is committed
<!-- AC:END -->
