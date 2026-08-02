---
id: TASK-34
title: getAppFilesPathPatterns has no consumer — keep it for watchers or delete it
status: To Do
assignee: []
created_date: '2026-08-01 21:12'
labels:
  - check-node
  - cleanup
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`getAppFilesPathPatterns(rootUri)` returns one glob per `APP_SOURCE_SUBTREES` entry
joined with `SOURCE_FILE_GLOB`. It existed because `getApp` globbed; since TASK-12.29
`getApp` walks instead, and nothing in this repository calls the function except its
own spec.

It was kept on the argument that a file WATCHER needs patterns and a walk cannot serve
that. That argument is plausible but unverified: the VS Code extension builds its own
`documentSelectors` and watcher patterns from `SOURCE_FILE_EXTENSIONS` in
`platformos-common`, so the only candidate consumer left is outside this repo —
`pos-cli` (`pos-cli sync`, `pos-cli check`).

So this is a five-minute question with two honest answers, and it needs looking at
`pos-cli` to pick one:

1. A consumer exists → keep it, and say in the doc comment WHO uses it, so the next
   person does not ask again.
2. No consumer → delete it and its spec. `APP_SOURCE_SUBTREES` and `SOURCE_FILE_GLOB`
   are both exported from `platformos-common`, so anyone who needs the patterns later
   can join them in one line.

Note the API was already renamed once in this release (`getAppFilesPathPattern` →
`getAppFilesPathPatterns`), so if it goes, it should go in the same release rather
than after a version has shipped depending on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Whether pos-cli (or another consumer outside this repo) calls getAppFilesPathPatterns is established
- [ ] #2 The function is either deleted with its spec, or kept with its consumer named in the doc comment
<!-- AC:END -->
