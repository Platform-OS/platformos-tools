---
'@platformos/platformos-mcp-supervisor': minor
---

`impact` now reports what your change BREAKS in files you are not editing, instead of counting
who depends on the one you are.

The count is gone, and it had to be. A file's dependant set is not decidable: `{% render var %}`,
`{% include var %}` and `{% function r = var %}` all parse and all resolve their target at
runtime, so one variable anywhere makes "nothing references this" unprovable — and a caller
whose file does not parse contributes nothing either. Measured on a real application, a partial
called once by name and once through an assigned variable was reported as having exactly one
dependant, with nothing to say the second call existed. Every number that field published was a
lower bound presented as a total, to an audience that read `total: 0` as "safe to change".

WHAT REPLACES IT. Lint is per-file and forward-looking: it visits only the buffers you send, so
a page the edited partial has just broken is never looked at. Impact now looks at it — by
linting the edited file's dependants twice, once with your changeset applied and once without,
and reporting only the findings the change INTRODUCED:

```json
"impact": { "status": "computed", "breaks": [{
  "file": "app/views/pages/home.liquid",
  "diagnostics": [{
    "check": "MissingRenderPartialArguments", "severity": "error",
    "message": "Missing required argument 'title' in render tag for partial 'card'.",
    "line": 1, "column": 11,
    "suggestions": [{ "description": "Add required argument 'title'",
                      "edits": [{ "start_index": 16, "end_index": 16, "new_text": ", title: ''" }] }],
    "see_also": "https://documentation.platformos.com/…/missing-render-partial-arguments"
  }]}]}
```

Those are the check engine's own findings, so they carry its message, severity, documentation
and fixes rather than a second opinion computed here.

RELEVANCE IS CAUSAL, NOT CATEGORICAL. There is no allowlist of "cross-file" check codes — an
allowlist rots the first time a check is added, and it asks the wrong question anyway. A finding
a dependant already had is excluded for having been there BEFORE, not for its code, so a check
added upstream is covered on the day it ships. It also reaches edits a `{% doc %}`-shaped design
could not: a renamed GraphQL variable now reports `GraphQLVariablesCheck` on every caller, and a
`.graphql` file can carry no doc block at all.

A break in someone else's file does NOT set `must_fix_before_write`. That flag answers "will
THIS file be broken if I write it", and your buffer may be perfectly correct.

NOTHING IT RETURNS IS A CLEARANCE. An empty impact means no break was found among the dependants
that are VISIBLE. This server does not answer "who depends on this file" and no longer publishes
a number in place of one.

TWO MEASURED BOUNDS, because the deadline cannot be one: a lint is synchronous CPU work and no
timer preempts it, so bounding the input is the only defence. `MAX_CANDIDATE_BYTES` (64 KiB)
caps the text discovery will parse — the most-referenced file on a real 2,615-file application
cost 4.7 s and then returned `unavailable` anyway; it now reaches the same answer in 230 ms.
`MAX_DEPENDANTS_LINTED` (100) caps how many dependants are linted, covering 99.4% of real
targets. Hitting either is REPORTED — `unchecked_dependants`, or `status: unavailable` — rather
than silently shortening the analysis.

Impact costs ~240 ms per request on that application, almost entirely the project read, which
overlaps the primary lint. Start the server with `--no-impact` (or `POS_SUPERVISOR_NO_IMPACT=1`)
to switch the stage off entirely; results then carry `impact.status: "disabled"`, distinct from
`unavailable` because retrying cannot change it. It is a server setting rather than a tool
parameter deliberately: an agent that does not know it is editing a shared partial is exactly
the one that would not ask for the check.

Breaking for anything reading `impact`: `dependents`, `signature_risk` and `scope` are gone,
replaced by `breaks`. `status` gains `disabled`.
