---
id: TASK-78
title: >-
  A new upstream filter (falsy_argument_error) breaks the docset-vs-runtime
  sweep as soon as the docs-updater refreshes filters.json — it needs a MEASURED
  return type
status: To Do
assignee: []
created_date: '2026-08-11 20:37'
labels:
  - check-common
  - docs
  - measured
  - generated-files
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The failure

`checks/invalid-hash-assign-target/index.spec.ts`, describe 'Sweep: docset return types vs the
runtime, for every reporting filter', test 'fills a type from the gap table ONLY where the
docset has no data at all':

```
  "holes": [
     "array_index_of",
+    "falsy_argument_error",
     "new_line_to_br",
     "nl2br",
   ]
```

The platformOS docs API now serves a filter this repo has never seen — `falsy_argument_error`
— with an empty `return_type`, so the sweep finds a fourth hole while
`DOCSET_RETURN_TYPE_GAPS` lists three.

## Why it is latent rather than already red

`packages/platformos-check-docs-updater/data/filters.json` is **re-downloaded by the
docs-updater's `postbuild`**, so the failure appears on any machine that runs `yarn build`
after the docs changed, and disappears if the file is reverted — which is what makes it look
like flakiness rather than a real signal. Reverting is a workaround, not a fix: the next build
brings it back.

Discovered while verifying TASK-73, whose own change is offense-identical on all four sample
projects — this failure is unrelated to it and was reverted rather than papered over.

## What must NOT happen

Do not invent a return type. This repo's rule is that `src/filter-arity.ts`,
`src/undocumented-filters.ts` and the `*-oracle.ts` fixtures are generated against a live
instance and committed, and the gap table exists precisely because the docs omit the data.
Guessing `string` because the name looks like an error message is exactly the class of false
premise the oracles were built to stop.

`scripts/verify-filter-return-types.mjs` is the generator to run, against a live instance.
Also worth answering in the same pass: whether the filter is real and reachable at all (a
docs-only entry that no runtime exposes belongs in a different list), and whether the sweep
should FAIL loudly on an unknown hole (its current behaviour, which is arguably right) or
report it as "undocumented and unmeasured".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `falsy_argument_error`'s return type is established against a live instance with the repo's own generator, not inferred from its name or its docs entry
- [ ] #2 Whether the filter exists in the runtime at all is answered explicitly — a docs-only entry is a different problem from an undocumented return type
- [ ] #3 The refreshed `data/filters.json` is committed together with whatever table the measurement updates, so a `yarn build` on a clean tree leaves the suite green
- [ ] #4 Regenerating on an unchanged instance still produces a byte-identical file
- [ ] #5 The sweep's behaviour on a FUTURE unknown hole is decided deliberately: fail loudly (as now) or report it as unmeasured, with the reason recorded
<!-- AC:END -->
