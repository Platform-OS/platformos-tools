---
id: TASK-75
title: >-
  MissingPage: diagnose parameterized-route near misses (and the form inputs
  that were meant to fill them) instead of a bare "no page found"
status: To Do
assignee: []
created_date: '2026-08-11 08:29'
labels:
  - check-common
  - platformos-common
  - missing-page
  - routing
  - measured
  - dx
dependencies: []
references:
  - packages/platformos-check-common/src/checks/missing-page/index.ts
  - packages/platformos-check-common/src/url-helpers.ts
  - packages/platformos-common/src/route-table/RouteTable.ts
  - packages/platformos-common/src/route-table/parseSlug.ts
  - >-
    packages/platformos-language-server-common/src/definitions/providers/PageRouteDefinitionProvider.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## What prompted this

A form targets a path, and the page that is *supposed* to serve it carries a parameter segment
in its slug:

```liquid
<form action="/users/action" method="post">
  <select name="user_id">…</select>
</form>
```
```yaml
# app/views/pages/users/action.liquid
slug: users/action/:user_id
method: post
```

`MissingPage` reports `No page found for route '/users/action' (POST)`. That message names the
URL and nothing else: it does not say that a page for `users/action/:user_id` exists one
segment away, it does not notice that the form carries an input called exactly `user_id`, and it
does not say what would make the two meet. The developer is left to guess, and the observed
guess in real code is to silence the check —
`modules/community/public/views/partials/components/organisms/feed-entry.liquid:80` (in
pos-module-community) wraps `<form action="/api/posts">` in
`{%- comment -%}platformos-check-disable MissingPage{%- endcomment -%}`.

The ask is that the check **identify the parameters**: when nothing matches the URL literally
but a route exists whose slug is that same path plus one or more `:param` segments, report
*that*, name the missing params, and say what closes the gap. Both segment positions are in
scope: trailing (`users/action/:user_id`) and interior (`users/:user_id/action`).

## Measured runtime behaviour — read this before implementing

The premise that a form input or query param can *fill* a route segment was tested, not
assumed. Probe pages were deployed to the `dev` environment of `~/projects/pos/pos-module-community`
(`maciek3.staging.oregon.platform-os.com`) via `pos-cli sync dev -f …`, real requests were
issued with `curl`, and the pages were deleted again. Each hypothesis has a paired control that
must still succeed, so no row is vacuous.

| request | slug under test | result |
|---|---|---|
| `POST /zzprobec/action` | `zzprobec/action` | **200** — control |
| `POST /zzprobea/action/42` | `zzprobea/action/:user_id` | **200**, binds `user_id=42` — control |
| `POST /zzprobea/action` body `user_id=42` | `zzprobea/action/:user_id` | **404** |
| `POST /zzprobeb/42/action` | `zzprobeb/:user_id/action` | **200** — control |
| `POST /zzprobeb/action` body `user_id=42` | `zzprobeb/:user_id/action` | **404** |
| `POST /zzprobee/action/42` | `zzprobee/action/:id` | **200** — control |
| `POST /zzprobee/action` body `id=42` | `zzprobee/action/:id` | **404** — `:id` is not privileged |
| `POST /zzprobea/action` body `slug3=42` | `zzprobea/action/:user_id` | **404** — `slug3` is not privileged |
| `GET /zzprobeg/action/42` | `zzprobeg/action/:user_id` | **200** — control |
| `GET /zzprobeg/action?user_id=42` | `zzprobeg/action/:user_id` | **404** |
| `GET /zzprobeg/action` | `zzprobeg/action/:user_id` | **404** |
| `POST /zzprobed/action` | `zzprobed/action(/:user_id)` | **200** — optional group, no param needed |
| `POST /zzprobed/action/42` | `zzprobed/action(/:user_id)` | **200** |
| `POST /zzprobec/action/42` | `zzprobec/action` | **404** — a surplus segment is not swallowed |

**Routing is purely path-based.** A body param, a query param, the parameter's name, and the
positional `slug`/`slug2`/`slug3` spellings all fail to supply a required segment.

Two consequences, both load-bearing:

1. `RouteTable`'s **parameter-segment** model is correct, and the offense in the opening
   example is a **true positive** — the app code really is broken. **Do not resolve this task
   by suppressing the report.** The deliverable is a better diagnosis, not silence. A change
   that makes the example stop reporting is a regression, and AC #3 is the control that
   catches it. (Its **format** model is a separate matter and is genuinely wrong in one
   direction — see TASK-76. Nothing in this task depends on that, but do not read the
   sentence above as a clean bill of health for `RouteTable` as a whole.)
2. Optional groups already match and already produce no offense (`zzprobed`), so an optional
   group must never be treated as a near miss.

Route params surface under both their name and their position — the probe echoed
`params={"foo":"bar","slug":"zzprobea","slug2":"action","slug3":"42","user_id":"42","format":"html"}`
— which is why `slug3` was worth ruling out as a filler and is worth knowing when writing the
message.

If anyone believes they have a counter-example where an input *does* fill a segment, add it as a
probe against a live instance and record the result here before acting on it. Prose cannot fail;
a probe can.

### The counter-example that keeps coming back is a STALE DEPLOY

Re-probed 2026-08-11 after `pos-module-user`'s `app/views/partials/admin/home/index.liquid`
(a form posting to `/sessions/impersonations` with `<select name="user_id">`) was reported as a
false positive. Same answer as the table above, and the instance that seems to disagree is
explained rather than believed. On that instance:

- `POST /sessions/impersonations` with `user_id=123` in the body → **200**
- `POST /sessions/impersonations/123` → **404**

the exact reverse of the repository — because the **deployed** `modules/user` predates
`pos-module-user@f0bb64f` (2026-06-17), which changed the slug from `sessions/impersonations`
to `sessions/impersonations/:user_id`. Under the old slug the bare path *is* the route and the
extra segment is surplus, so both answers are ordinary path matching and no body param was
read. **Compare a deploy, not a repository** — `pos-module.lock.json` said `user: 5.2.12`,
whose checked-out source carries `:user_id`, and the instance still answered as the older code.
A stale instance is the most convincing false counter-example available, because both of its
answers are wrong in the direction that supports the wrong conclusion.

Consequence for the app code: that form is **broken** against its own module's current page, as
is any other caller still posting to the bare path. `f0bb64f` updated `pos-module-community`'s
`admin/users/users/edit.liquid` to `/sessions/impersonations/{{ profile.user_id }}` and left
this one behind.

The semantics are pinned in `checks/missing-page/index.spec.ts` (describes `parameter segments
are filled by the path and nothing else` and `true positives (must keep reporting)`) so they
cannot regress while the message is being improved.

## Where the work lands

- `packages/platformos-common/src/route-table/RouteTable.ts` — matching today answers one
  question (`hasMatch`/`match`: does any entry match this URL literally). The near-miss question
  ("which entries would match if the URL supplied N more `:param` segments, and which params are
  they") is a new one, and it belongs beside the existing matcher rather than reimplemented in a
  consumer.
- `packages/platformos-check-common/src/checks/missing-page/index.ts` — consumes it, and is the
  only place that can see the form's inputs.
- `packages/platformos-check-common/src/url-helpers.ts` — already walks a `<form>` subtree for
  `_method` (`findMethodOverride`); collecting descendant control names is the same walk.

## Adjacent, deliberately NOT in scope

The `feed-entry.liquid` suppression above is a *different* near miss: `/api/posts` matches the
slug `api/posts` exactly but the pages there are `put`/`delete` and `.json.liquid` (format
`json`), while a `<form>` with no `method` is `get` and a URL with no extension is format `html`.
"A page exists at this route but only for PUT, and only as json" is a worthwhile second
diagnosis and a separate change; keep this task to the parameter question so the PR stays
reviewable. Re-evaluating that `platformos-check-disable` lives in the pos-module-community repo,
not here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given a URL and method that no route matches literally, the route model can report the routes that would match if the URL supplied additional `:param` segments, together with the names of those unsupplied params, ordered by the same precedence as a normal match
- [ ] #2 Near misses are found for a trailing missing param (`users/action/:user_id`), an interior missing param (`users/:user_id/action`), and for more than one missing param at once
- [ ] #3 A route whose extra segments are an optional group is never reported as a near miss, because it already matches — asserted by a test on `users/action(/:user_id)` that expects zero offenses, paired with a control on `users/action/:user_id` that must still report
- [ ] #4 A near miss respects method and format exactly as a literal match does: a page with the same slug shape but a different method or a different format is not offered as one
- [ ] #5 For a `<form>`, the check knows the `name` of every descendant `input`/`select`/`textarea` control, and the message distinguishes the case where the missing params are all present as control names from the case where they are not
- [ ] #6 The bracket spelling (`name="post[id]"`) is handled deliberately: measured against a live instance to establish what `context.params` receives, and either treated as supplying `post_id` or explicitly not — with the measurement recorded, not inferred
- [ ] #7 When a near miss exists the offense message names the near-miss page's slug, the missing param(s), and the remedy (put the value in the action path, or make the segment an optional group); when no near miss exists the message is byte-identical to today's
- [ ] #8 An `<a href>` gets the same near-miss diagnosis as a form, minus the control-name half, since a link has no inputs to inspect
- [ ] #9 Producing the diagnosis costs nothing on the path where a route matches — the common case's work is unchanged (relevant to the TASK-12 lint-speed budget)
- [ ] #10 Offense assertions are whole-value equalities on the full offense array, per the repo's test guidelines — no `toContain`, no length-plus-property reads
- [ ] #11 Every new silence is sabotage-tested: breaking the near-miss detection makes a test fail, and each 'does not report' test is paired with a control that must still fire
- [ ] #12 The MissingPage check page in the platformos-documentation repo describes the new message and the fact that route params are never supplied by form inputs or query strings
- [ ] #13 The MCP supervisor's `transport/instructions.ts` is updated in this same change if the new message alters what `validate_code` reports, since `validate-code.spec.ts` pins those claims
<!-- AC:END -->
