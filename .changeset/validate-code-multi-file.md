---
'@platformos/platformos-mcp-supervisor': minor
---

`validate_code` validates a whole changeset in one call — and that is a correctness fix, not
a batching convenience.

```jsonc
// One file — the original contract, unchanged.
{ "file_path": "app/views/partials/card.liquid",
  "content":   "<div>{{ title }}</div>" }

// Several files, validated TOGETHER.
{ "files": [
    { "file_path": "app/views/pages/home.liquid",
      "content":   "{% render 'promo' %}" },
    { "file_path": "app/views/partials/promo.liquid",
      "content":   "<div>Promo</div>" }
  ] }
```

**Why this is about correctness.** Real changes span files: you add a partial and the page
that renders it, rename a snippet and update its callers, add a query and the page that runs
it. Validated one file at a time, the page above is reported as rendering a partial that does
not exist — because at the moment it is checked, it doesn't. The partial is in the agent's
other buffer, unwritten. `MissingPartial` is one of only four checks that BLOCK a write, so
that false positive doesn't just mislead: it stops the agent making a change that is
correct. The only escapes were to write the files unvalidated, or to write them in an order
that happens to keep every intermediate state valid — which for a mutual reference does not
exist.

With every buffer overlaid at once, in the `App` and in the filesystem view reference checks
resolve through, the partial resolves. The false positive is gone by construction rather than
by tuning.

**The batch is not atomic.** Every requested file gets its own entry in `files[]`, in the
order requested and keyed by the caller's own `file_path` string — so a caller mixing
relative and absolute spellings finds its own results without reproducing our normalization.
One declined or failing file never sinks the others.

**One gate to read.** The response carries a request-level `must_fix_before_write`: an agent
about to write a multi-file change needs a single answer to "may I write this changeset?",
and a coordinated edit is only as safe as its worst file. It is deliberately an OR over the
files' own gates, so a file that was merely not checked (`not_applicable`) never blocks the
set.

**Bounded, and self-contradiction refused.** Up to 50 files per call, with a byte cap derived
from the same cost model as the lint deadline, so a batch cannot be admitted that could not
finish inside it. Two entries resolving to the SAME file are refused rather than merged:
buffers are overlaid by normalized URI with the last winning, but results are keyed by the
caller's string, so `card.liquid` and `./card.liquid` would return two entries where only one
buffer was ever checked — one of them a verdict on content that was never looked at.

It is also faster, which is the least interesting part: everything expensive in a lint is
per-project rather than per-buffer — resolving config, walking and reconciling the app,
reconciling the route table — so N files in one call pay for the project once instead of N
times.
