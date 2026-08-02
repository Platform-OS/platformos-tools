---
id: TASK-36
title: 'MatchingTranslations ships with description: ''TODO'''
status: To Do
assignee: []
created_date: '2026-08-01 21:16'
labels:
  - docs
  - check-common
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while cleaning up after TASK-12 (2026-08-01). Pre-existing on `master`, not a
regression.

`packages/platformos-check-common/src/checks/matching-translations/index.ts` declares
`meta.docs.description: 'TODO'`. That string is not internal: check metadata is what
the generated factory configs, the docs site's check tables and any editor UI show for
the check, so users see "TODO" where every other check explains itself.

Write the real one sentence, and check the same file's `docs.url` points at a page
that exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MatchingTranslations has a description that says what it checks
- [ ] #2 No other check has a placeholder description (the whole allChecks list is scanned once)
<!-- AC:END -->
