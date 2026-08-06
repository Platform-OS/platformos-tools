---
id: TASK-66
title: >-
  GraphQLCheck reports nothing — not even a syntax error — when the docset has
  no GraphQL schema
status: Done
assignee: []
created_date: '2026-08-06 09:02'
updated_date: '2026-08-06 11:33'
labels:
  - platformos-check-common
  - checks
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`GraphQLCheck` gates on `platformosDocset.graphQL()` before it looks at the document, so a project linted without a downloaded schema gets NO offense for a `.graphql` file that does not compile. A syntax error is schema-independent — the parse already failed — so the gate is wrong for that half, and the check's own spec pins the current behaviour ("reports no offenses when platformosDocset.graphQL returns null") on a fixture whose document happens to be syntactically valid, so nothing distinguishes the two cases today.

Found while relocating GraphQL parsing to platformos-common (TASK-65). Deliberately left unchanged there: it is not a relocation, and flipping it makes the check newly fire on every project linted without a schema — which is a behaviour change that wants its own measurement (how many real projects lint without one, and whether `blocksWrite` would then block on it through the MCP supervisor).

The parse and its error are now available as values on the AST node (`ast.syntaxError`), so the fix is to report syntax before the schema gate and keep the gate for `validate()` only. Whatever is decided, the existing "no offenses without a schema" test needs a control that fires — an invalid document — or the silence stays undistinguishable from a fixture with nothing to report.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed: the syntax error is reported before the schema is asked for, and only `validate()` sits behind the schema gate.

**The framing in the description was wrong about the risk.** The schema is not something a project may or may not have: `PlatformOSLiquidDocsManager.graphQL()` downloads it to the `env-paths` cache AND `findSuitableResource` falls back to the copy committed at `platformos-check-docs-updater/data/graphql.graphql` (13051 lines, re-downloaded by that package's `postbuild`). So every Node context — CLI, language-server-node, MCP supervisor — has a schema even offline, and `null` reaches the check only from a caller that injects its own docset: a browser embedder, or a test. Flipping the gate therefore changes no real run, and the "would newly fire on every project linted without a schema" concern was empty.

The spec's single "reports no offenses when graphQL returns null" test is now a pair, which is the actual defect it had: an unknown FIELD stays silent (only a schema could contradict it) and a SYNTAX error must still fire. The silence now has a control beside it, so a check that went quiet about everything fails the second test. Sabotage-checked: restoring the schema gate in front of the syntax branch fails exactly that test.
<!-- SECTION:FINAL_SUMMARY:END -->
