---
id: TASK-37
title: >-
  An ignored render target's {% doc %} is invisible to check-node, so
  PartialCallArguments reports false positives
status: To Do
assignee: []
created_date: '2026-08-02 18:45'
labels:
  - check-node
  - correctness
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`pos-cli check` on `pos-module-community` reports:

```
modules/community/public/views/partials/migrated/profiles/card.liquid
✖  PartialCallArguments
  Required parameter class must be passed to render call
  {% render 'modules/common-styling/user/avatar', size: '2xl', name: name, image_src: image_src %}
```

`class` is declared OPTIONAL by the target's own `{% doc %}`:

```liquid
{% doc %}
  @param {string} size - avatar size
  @param {string} [class] - additional CSS classes   ← optional
  @param {string} name - user display name
  @param {string} image_src - URL of the avatar image
{% enddoc %}
```

so there is nothing to report. The language server agrees and reports nothing.

## Cause

`lintApp` (`platformos-check-node/src/index.ts`) builds its `getDocDefinition` map
from `appFiles(app)`, and the app comes from `getAppFilePaths(config)`, which applies
the user's `ignore`. That project ignores `modules/common-styling/**`, so the target is
not in the app, has no entry in the map, and `getDocDefinition` returns `undefined`.

`PartialCallArguments` then falls through to its inference branch, which derives the
parameter list from undefined variables in the partial's SOURCE (read through
`context.fs`, which has no ignore list and finds the file fine). `class` is used bare —
`{{ class }}`, no `| default` — so inference calls it required.

Proven by deleting one line: with `modules/common-styling/**` removed from
`.platformos-check.yml`, check-node reports **no offense** on that file.

The language server does not have the bug because `DocumentManager.preload` does not
apply the user's ignore list, so its `getDocDefinition` finds the doc.

## The rule this breaks

`ignore` says which files are REPORTED ON. It must not change what is KNOWN about a
file that something else references — a render target's `{% doc %}` is the target's
contract, and it is the same contract whether or not the target is linted. Reading it
is exactly as available as `context.fs.readFile(locatedFile)`, which the same check
already does two lines earlier.

Note this is not specific to `ignore`: any render target outside the app set has the
same problem.

## Change

Give `lintApp`'s `getDocDefinition` a fallback for a relative path the app does not
contain: read and parse that file on demand, memoized like the rest, rather than
returning `undefined`. Keep it lazy — the map must not load anything at construction
time (see the "Never `await file.load()` at map time" note in the package's CLAUDE.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A render target inside an `ignore`d path still supplies its `{% doc %}` to PartialCallArguments, pinned by a test with an ignored module
- [ ] #2 `pos-cli check` on pos-module-community no longer reports 'Required parameter class' on modules/community/public/views/partials/migrated/profiles/card.liquid
- [ ] #3 check-node and the language server agree on the offenses for that file — the divergence is what made this hard to see
- [ ] #4 The ignored file itself is still not REPORTED on: ignore keeps its meaning
- [ ] #5 The doc-definition map is still built without reading anything, and only the targets actually resolved are loaded
<!-- AC:END -->
