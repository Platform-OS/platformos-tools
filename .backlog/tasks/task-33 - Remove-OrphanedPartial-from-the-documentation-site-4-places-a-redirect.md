---
id: TASK-33
title: Remove OrphanedPartial from the documentation site (4 places + a redirect)
status: To Do
assignee: []
created_date: '2026-08-01 21:12'
labels:
  - docs
  - platformos-check
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`OrphanedPartial` was removed from the linter on 2026-08-01 (TASK-29) after
measurement showed it reporting 350-465 warnings per real project, a large share of
them false: a module's `public/` API has no caller in its own repository, and
partials invoked BY NAME through a dispatcher (`mutation_name: '…'`) or as a callback
(`access_callback: 'lib/can/…'`) are invisible to any static reverse index.

The documentation still describes it, in the four places a check always occupies
(`~/projects/pos/platformos-documentation`):

- `app/views/pages/developer-guide/platformos-check/checks/orphaned-partial.liquid`
  — the check's own page;
- `app/views/pages/developer-guide/platformos-check/checks/overview.liquid:35` — the
  checks table;
- `app/views/pages/developer-guide/platformos-check/platformos-check.liquid:195` —
  the per-check configuration table;
- `app/views/partials/shared/nav/developer-guide.liquid:68` — the nav link.

The page has been published and linked, so deleting it needs a `redirect_to` rather
than a 404 — same treatment as a renamed check.

Worth saying WHY on the overview or in the release note rather than removing it
silently: a team that has the check enabled in `.platformos-check.yml` will notice it
stopped firing, and "we removed it because it was wrong too often" is a better answer
than nothing. An enabled-but-unknown check is ignored by the config loader, so no
project breaks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The check page is removed and its URL redirects rather than 404s
- [ ] #2 The checks overview table, the configuration table and the developer-guide nav no longer list OrphanedPartial
- [ ] #3 The removal and its reason are stated somewhere a reader of the check docs will find
<!-- AC:END -->
