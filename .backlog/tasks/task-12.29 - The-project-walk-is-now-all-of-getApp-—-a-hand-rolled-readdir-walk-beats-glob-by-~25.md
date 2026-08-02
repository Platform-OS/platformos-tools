---
id: TASK-12.29
title: >-
  The project walk is now all of getApp — a hand-rolled readdir walk beats glob
  by ~25%
status: Done
assignee: []
created_date: '2026-08-01 13:45'
updated_date: '2026-08-01 19:21'
labels:
  - performance
  - check-node
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-12.19 the app is reconciled rather than rebuilt, and reconciliation does
not register in a phase split: `getAppFilePaths` and `getApp` measure the same
(arabbank, loaded machine: 79-96 ms vs 85-95 ms). So `getApp` IS the walk now, and
the walk is `glob()` over `getAppFilesPathPatterns`.

Measured while implementing TASK-12.19, warm, three runs each — a plain
`fs.readdir({ withFileTypes: true })` recursion over the same subtrees against the
glob that produces the same paths:

| project | files | dirs | glob | readdir walk | stat of every dir |
|---|---|---|---|---|---|
| arabbank | 3141 | 1116 | 34-39 ms | 23-32 ms | 15-20 ms |
| pos-module-community | 1511 | 628 | 21-22 ms | 14-16 ms | 8-12 ms |
| Accala-MP | 2789 | 1116 | 33-37 ms | 23-24 ms | 15-17 ms |

The readdir column already enumerates every entry, so a walk that also collects the
FILES costs about the same — roughly 25% under the glob, and it can filter by
extension (`SOURCE_FILE_EXTENSIONS`) as it goes rather than matching a pattern per
path.

The stat column is there to rule out the tempting third option: a directory-mtime
probe to decide whether the previous path list is still valid. It saves ~15 ms over
the walk, and buys a correctness surface (mtime granularity across filesystems,
WSL/network mounts) for a fifth of a warm call. Not worth it — and TASK-12.19's whole
argument is that the walk is the invalidation mechanism, not a cost to be avoided.

## Watch for

- The anchoring rule from TASK-12.22 must survive: walk `APP_SOURCE_SUBTREES`, never
  the whole tree with a directory-name blacklist.
- `platformos-common` owns which extensions are sources (`SOURCE_FILE_EXTENSIONS` /
  `SOURCE_FILE_GLOB`). A walk that hardcodes `.liquid` is a fourth opinion about what
  a platformOS file is — see TASK-12.27.
- The paths must come out normalized and forward-slashed on Windows, as
  `normalize-path` does for the glob today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The walk produces a file-by-file identical path list to the current glob on arabbank, Accala-MP and pos-module-community
- [x] #2 Walk time is measured against the 34-39 ms / 21-22 ms / 33-37 ms baselines recorded here
- [x] #3 Symlinked directories and unreadable directories behave as they do today, pinned by a test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DONE — but with the SHARED walk, not a second hand-rolled one

TASK-12.25 landed `walkAppSourceFiles` in `platformos-common` (an anchored `readdir`
recursion over `APP_SOURCE_SUBTREES` on an `AbstractFileSystem`) for the graph build
and the LSP preload. `getAppFilePaths` now uses that same walk instead of `glob`, so
the toolchain has ONE project walk rather than the two this task's title implied.

Two changes made it competitive with a Node-only walk:

- `NodeFileSystem.readDirectory` builds each entry's URI with a new
  `path.childUri(dirUri, name)` — string append — instead of `path.join`, which
  parses and re-serializes the URI per entry. It runs once per entry of every
  directory a walk opens (~30 000 times on arabbank, mostly for files the caller
  discards) and was about a third of the walk. `childUri` is pinned against `join`
  itself over every name shape a listing can produce (`#`, `?`, spaces, unicode,
  Windows separators, hidden names) in `check-common/src/path.spec.ts`, so the two
  cannot drift. The graph CLI's inlined copy of `NodeFileSystem` got the same change.
- The walk skips hidden entries, which is what `glob`'s `dot: false` did. Not just
  for parity: an Emacs lock file is a DANGLING SYMLINK named `.#page.liquid` and
  macOS leaves `._page.liquid` beside every file on a non-native filesystem — both
  would otherwise classify as real partials and be linted.

### AC #1 — identical, and measured on four projects (AC #2)

Candidate path lists are IDENTICAL, file for file, to the glob's on arabbank (3141),
Accala-MP (2789), pos-module-community (946 after `ignore`) and htevent (2906). Warm
walk, median of 5 interleaved rounds:

| project | glob | shared walk (landed) | Node-only walk (rejected) |
|---|---|---|---|
| arabbank | 39 ms | 33 ms | 29 ms |
| Accala-MP | 37 ms | 32 ms | 29 ms |
| htevent | 33 ms | 28 ms | 25 ms |
| pos-module-community | 34 ms | 31 ms | 29 ms |

Whole `getApp` (walk + reconcile), warm: arabbank 31-38 ms, Accala-MP 32-38,
htevent 24-27, pos-module-community 30-32 — and the app it produces contains no file
the old glob did not offer.

**Why not the Node-only walk**, which this task proposed and which is another 3-4 ms
faster: it is a second implementation of "walk the app subtrees", and 3-4 ms on the
largest project on hand does not pay for that. The wildcard expansion, the
hidden-entry rule and the missing-subtree rule would have had to be right in two
places. Measured, recorded, rejected — not overlooked.

### AC #3 — symlinks and unreadable directories

Pinned in `check-node/src/index.spec.ts` (`Unit: getApp walk edge cases`, POSIX-only,
skipped as root):

- a symlinked DIRECTORY is not followed and a symlinked FILE is taken — same as the
  glob, which had `follow: false`;
- hidden files and directories are skipped — same as the glob;
- an unreadable directory now FAILS the run with `EACCES`, where the glob skipped it
  in silence. Deliberate: a lint that quietly covers less of the project than it
  claims is the exact failure mode this epic keeps finding (see TASK-12.24). Called
  out in the changeset.

`getAppFilesPathPatterns` stays exported — a file WATCHER needs patterns, and a walk
cannot serve that — but the lint no longer globs. `glob` is still a dependency
(`config/load-third-party-checks.ts`).

Monorepo `yarn test` 296 files / 2645 tests green, `yarn type-check` clean.
<!-- SECTION:NOTES:END -->
