---
id: TASK-76
title: >-
  Remove the 8 remaining MissingPage suppressions from pos-module-community: fix
  the /_maintenance false positive + the html-format direction, then the 11 app
  bugs
status: In Progress
assignee: []
created_date: '2026-08-11 12:24'
updated_date: '2026-08-11 14:30'
labels:
  - check-common
  - platformos-common
  - missing-page
  - routing
  - measured
  - false-positive
dependencies: []
references:
  - packages/platformos-check-common/src/checks/missing-page/index.spec.ts
  - packages/platformos-check-common/src/url-helpers.ts
  - packages/platformos-common/src/route-table/RouteTable.ts
  - ~/projects/desksnearme/app/models/router/route_builder/route.rb
  - ~/projects/desksnearme/config/routes.rb
  - ~/projects/desksnearme/app/models/instance.rb
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

`pos-module-community` carried ten `platformos-check-disable MissingPage` comments. They
should all go. Stripping them produced **14 offenses**, and the split was not what the
suppressions imply: **12 were true positives** — the app code really does 404 — and 2 were
check bugs.

**Progress — two sites resolved, neither by changing the check:**

- `profile/settings.liquid` was refactored to write its `_method` as a literal input
  (committed as `40fc5c2d1`); see "Check bug 1". Its suppression is gone.
- The impersonate site is resolved from the module side: **modules/user `^5.2.12` serves
  `slug: sessions/impersonations/:user_id` (post)**, which the existing form
  `/sessions/impersonations/{{ profile.user_id }}` matches. Its suppression had already
  been removed in `6ddd85cfb`, and the offense is now gone too.

Current state, measured: **8 files still carry a suppression, and stripping those 8 yields
12 offenses — 11 true positives and 1 false positive** (`/_maintenance`).

So what remains here is: **check bug 2** (the one false positive in this project) and
**check bug 3** (a format defect that does not fire in this project), plus the 11 app fixes.

Failing tests already exist in
`packages/platformos-check-common/src/checks/missing-page/index.spec.ts` — 3 red (bugs 2
and 3), 71 green. **They belong in `index.spec.ts`, one spec file per check, so duplicates
stay findable — do not add a second spec file.**

## How this was established

Probe pages deployed to the `dev` environment of `~/projects/pos/pos-module-community`
(`maciek3.staging.oregon.platform-os.com`, `slug_exact_match: true` — the default) via
`pos-cli sync dev -f`, real requests with `curl`, pages deleted afterwards. Cross-checked
against the backend router in `~/projects/desksnearme`:
`app/models/router.rb`, `app/models/router/route_builder/route.rb`,
`app/models/router/route_builder/legacy_route_with_max_deep_level.rb`, `config/routes.rb`.

## Check bug 1 — CLOSED by refactoring the app, deliberately not by changing the check

`views/pages/profile/settings.liquid` posted to `/settings_update` and supplied the override
as `{% theme_render_rc 'components/atoms/input', name: '_method', type: 'hidden', value: 'put' %}`.
`findMethodOverride` (`src/url-helpers.ts`) only reads a literal `<input>` element, so the
check settled for `method="post"` while the page is `method: put`.

Live: `POST /settings_update` with no `_method` → **404**; with `_method=put` → **500**
(matched, then raised on auth); `PUT /settings_update` → **500**. The override genuinely
routes, so the offense was a genuine false positive.

**Decision: the check does not resolve partials or render arguments to guess a form's
method. The override must be visible in the markup.** The page now writes
`<input type="hidden" name="_method" value="put">` directly and the suppression is gone.
Equivalence was verified rather than assumed — `pos-cli exec liquid` shows the component
emitting exactly `type`/`name`/`value` plus a styling `class` (inert on a hidden field) and
`id="_method"` (grepped: unreferenced by any JS or CSS). Live after the change:
`POST /settings_update` + `_method=put` with a browser `Accept` → **500** (matched), without
it → **404**.

This was the only component-rendered `_method` in the project; no community partial emits
one from its own body, and 25 files already use the literal `<input name="_method">` form.

The contract is now pinned by a PAIR in the spec — hidden-in-a-render → reported,
literal → silent — so nobody "fixes" this later by teaching the check to chase renders. The
same pair is why a blanket "bail out of any form containing a render" is also wrong: the
feed-entry form contains `{% render 'modules/common-styling/forms/markdown' … %}` and its
offense is a true positive.

## Check bug 2 — platform-provided routes are not pages

`views/partials/maintenance.liquid` posts to `/_maintenance`, which is a Rails route, not a
page: `resources :maintenance, only: %i[new create], path: '_maintenance'`
(`config/routes.rb:20`). Live: `POST /_maintenance` → **200**, `GET /_maintenance` → **404**
(create only). Other built-ins in the same file worth considering: `/404`, `/422`, `/500`,
`/502`, `/504`, `/maintenance`, `/auth/:provider/callback`, `/auth/failure`, `/api/graph`.

## Check bug 3 — an html page answers a request for ANY other format

Not one of the ten sites; found while measuring, and **it contradicts two existing tests**.

The backend builds an html page's path as `slug(.:format)` — an unconstrained optional
format segment — and returns from `constraints` before adding any mime constraint
(`route.rb`, `extract_format` / `constraints`). Non-html pages instead get
`slug(.<their format>)` **plus** a mime constraint. `html_format_exact_match` defaults to
**false** (`app/models/instance.rb:14`).

Live, html-only page at slug `zzfmtc`: `/zzfmtc` → 200 (format=html), `/zzfmtc.json` → 200
(format=json), `/zzfmtc.csv` → 200 (format=csv).

`RouteTable.match`/`hasMatch` reject an entry whose `format` differs from the URL's
extension, so both of these are false positives today:

- `/api/my-page.json` with only `api/my-page.html.liquid`
- `/blog/rss.rss` with only `blog/rss.html.liquid`

Two existing tests in `missing-page/index.spec.ts` asserted the opposite. They have been
**inverted in place** (rather than duplicated by new ones) and are now two of the three red
tests: `'does not report when a .json URL has only an html page (html serves any format)'`
and `'does not report the rss URL when only an html page exists at that path'`.

The reverse direction stays an offense and its tests stay as they are: a json page's path
is `slug(.json)`, so `/zzfmta.html` → **404** (measured), and
`'…the module page serves the feed as xml…'` is correct.

### The trap in this one

A first pass measured `POST /api/posts` + `_method=put` → **302** and concluded format is
not part of matching at all. That was **curl's `Accept: */*`** satisfying the json route's
mime constraint. Re-measured with a browser `Accept`, the same request is **404**:

| `Accept` | `POST /api/posts` `_method=put` |
|---|---|
| `*/*` (curl default) | 302 — matched |
| browser (`text/html,…,*/*;q=0.8`) | **404** |
| `text/html` | **404** |
| none | **404** |
| browser + `.json` in the URL | 302 — matched |

So a json page does NOT serve the extensionless URL for a browser, and
`'reports when URL has no format suffix but only json page exists'` is **correct** — keep
it. An `<a href>`/`<form action>` means browser navigation, which is the case to model.
Any change here needs the Accept-header control or it will re-derive the wrong rule.

## The 11 remaining true positives (app fixes, in the pos-module-community repo)

| site | route | why it 404s |
|---|---|---|
| `lib/test/index.liquid` ×3, `test_report_html.liquid`, `sent_mails_list.liquid`, `sent_mails_show.liquid` | `/tests/run`, `/tests/run_async`, `/tests/sent_mails`, `/tests/sent_mails/:id` GET | modules/tests serves `/_tests/…`; live `/tests/run` → 404, `/_tests/run` → 500, `/_tests/sent_mails` → 200 |
| `partials/components/organisms/quicklinks.liquid` ×3 | `/admin/inventory/items/new`, `/search`, `/questions` GET | no such pages; all 404 |
| `partials/components/organisms/feed-entry.liquid:81` | `/api/posts` GET | pages at that slug are `put`/`delete` and `.json`; live GET → 404 |
| `partials/migrated/post/like.liquid:8` | `/api/posts/{{ post.id }}/vote` GET | page is `put` + `.json`; live `GET /api/posts/1/vote` → 404 |

The two `/api/posts…` forms are driven by JS (`assets/js/feed/post.js` builds its own
`fetch`), so the markup's method/action is not what actually ships — but the markup as
written is unreachable, which is what the check reports. Fixing them means declaring the
override and the format (`action="/api/posts.json"` + `<input name="_method" value="put">`),
which the spec has as a control.

## Also worth recording

`max_deep_level` — a concept `RouteTable` does not model — appends `(/:slug2)(/:slug3)(/*slugs)`
to a slug, so a surplus segment IS swallowed. It applies only to
`LegacyRouteWithMaxDeepLevel`, chosen when `instance.slug_exact_match` is **false**;
`slug_exact_match` defaults to **true** (`app/models/instance.rb:26`, and
`instance_factory.rb:34` sets it on new instances). This is very likely why the
impersonate form was written the way it was — it would have worked on a legacy instance.
Modelling exact match is right for the default; if legacy instances ever need supporting
that is a separate, config-driven decision, not a silent widening.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The three red tests in `packages/platformos-check-common/src/checks/missing-page/index.spec.ts` pass, and the other 71 in that file still pass. Tests go in `index.spec.ts` beside `index.ts` — do NOT add a second spec file for this check
- [x] #2 The check still does NOT resolve partials or render arguments to determine a form's method — the pair (`_method` hidden in a render → reported, literal `<input>` → silent) stays exactly as it is, and no code is added to chase `_method` through a render
- [x] #3 Routes the platform provides rather than pages — at minimum `/_maintenance` — are not reported as missing, sourced from the backend's `config/routes.rb` and with the source named in a comment so the list can be re-derived
- [x] #4 `RouteTable` matching lets an `html` page answer a URL carrying any other known format extension, because the backend gives html pages an unconstrained `slug(.:format)` path when `html_format_exact_match` is false (the default)
- [x] #5 The reverse direction still does not match: a non-html page does not answer a URL whose extension differs from its own format, asserted for the measured `/zzfmta.html` → 404 shape (a json page and a `.html` URL) — the existing xml-feed test already covers this and must stay green
- [x] #6 `'reports when URL has no format suffix but only json page exists'` still passes unchanged — a json page does not serve the extensionless URL for a browser Accept, and this is the control that stops the format work from over-widening
- [x] #7 Stripping the 8 remaining suppressions from pos-module-community yields exactly the 11 true positives and not the `/_maintenance` false positive (12 offenses today, 11 after this change)
- [x] #8 Each offense assertion is a whole-value equality per the repo's test guidelines, and each new silence is sabotage-tested — breaking the fix makes a named test fail
- [x] #9 The MissingPage check page in the platformos-documentation repo states that platform-provided routes are exempt, how format matching works in each direction, and that a `_method` override must be literal markup to be seen
- [ ] #10 A follow-up issue or PR is opened against pos-module-community listing the 11 app-side fixes and removing the 8 remaining suppressions, so the check change and the cleanup do not drift apart
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed

**Check fixes (platformos-tools)**

- `RouteTable`: `formatMatches(entryFormat, requestedFormat)` replaces the format equality
  test in `match`/`hasMatch`. An html page answers any requested format; any other format
  answers only its own extension, and never the extension-less URL.
- `RouteTable`: `isPlatformRoute(urlPattern, method)` — a table of routes the platform
  serves itself, matched with the same segment/param machinery (`matchEntry` and
  `matchOptionalGroups` lifted to module scope as `entryMatches`/`matchOptionalGroups`).
  Exported from `platformos-common`, consulted by `MissingPage` before it asks for the
  route table.
- `PageRouteDefinitionProvider`: go-to-definition now offers only the matches tying the
  best precedence. Needed because an html page matches a `.json` URL but loses to the json
  page that also does; without this the provider offered two targets for one URL.

Both fixes were sabotage-tested. Restoring the old format rule fails exactly the two format
tests; removing the `isPlatformRoute` call fails exactly the three platform-route tests.

**Comment policy applied:** backend file paths, instance flags and live-probe transcripts
were removed from the comments in favour of tests. Facts formerly in prose are now pinned by
`does not report the GET form of it, /_maintenance/new`, `still reports a GET to
/_maintenance, which the platform does not serve`, `still reports a lookalike path`, and the
format cases in `format-aware matching` / `rss format link regression`.

**App fixes (pos-module-community)** — all 8 remaining suppressions removed; the project now
reports **0** MissingPage offenses with **0** suppressions.

- `lib/test/{index,sent_mails_list,sent_mails_show,test_report_html}.liquid`: `/tests/…` →
  `/_tests/…`, which is what modules/tests serves.
- `quicklinks.liquid`: the three placeholder links in this showcase partial became `href="#"`,
  matching the `href: "#"` the same file already uses for its demo buttons.
- `post/like.liquid` and `feed-entry.liquid`: the two JS-driven forms now declare the request
  their JS actually makes — `.json` on the action plus `method="post"` and
  `<input type="hidden" name="_method" value="put">`.
- `maintenance.liquid`: suppression removed, now covered by the platform-route exemption.

Verified against the live instance: every changed URL still routes (`PUT /api/posts.json`,
`PUT /api/posts/1/vote.json`, and the extension-less forms, all 302 rather than 404; the four
`/_tests/…` links 200/500, i.e. matched). Whole-project lint is unchanged at 1544 offenses
with these edits stashed vs applied, so nothing else regressed.

## Watch item

Both JS-driven forms serialize `new FormData(form)` into a JSON body, so the added `_method`
input now appears as `"_method": "put"` in those two payloads. The receiving pages read named
params and ignore extras, so this is inert — but it is a payload change, and it is the only
behavioural side effect of this work. Reverting it means restoring a suppression on those two
forms, since a static check cannot tell that a form is driven by `fetch`.

## Still open

- AC #9: the MissingPage page in the platformos-documentation repo.
- AC #10: open the PR against pos-module-community for the 8 files above.

## AC #9 — done

`platformos-documentation` `app/views/pages/developer-guide/platformos-check/checks/missing-page.liquid` gained three sections — **HTTP methods** (a methodless form is a GET, and a `_method` override has to be literal markup), **Response formats** (html answers any format, any other format answers only its own extension and never the extension-less URL), and **Platform-provided routes** (the exempt list, exempt per method rather than per path). The incorrect/correct examples now carry a format case and a `_method` case, and 'Disabling This Check' says which apparent false positives are real and that a JS-driven form is the one genuinely unanalyzable case.

Also corrected a pre-existing factual error on that page: it claimed form actions default to `POST`. `getEffectiveMethod` defaults to `get`, the HTML default. That wrong premise is exactly what made the two `/api/posts` forms look correct.

The one-line summaries in `checks/overview.liquid` and `platformos-check.liquid` still describe the check accurately, so neither needed editing — only the check's precision changed, not its purpose.

## AC #10 — overtaken, not done

A separate PR is no longer possible: all nine files were squashed into the `rename hash assign to assign` commit on the unpushed `rename-hash-assign-to-assign` branch, which was then rebased onto newer master. The MissingPage cleanup will ship inside that branch's PR rather than its own.

Re-verified on the rebased tree: **0 MissingPage offenses, 0 suppressions**. Pushing that branch is the author's call, so nothing was pushed.
<!-- SECTION:NOTES:END -->
