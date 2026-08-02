---
id: TASK-35
title: An unreadable directory now fails pos-cli check with a raw EACCES stack
status: Done
assignee: []
created_date: '2026-08-01 21:12'
updated_date: '2026-08-01 21:40'
labels:
  - check-node
  - cli
  - error-handling
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduced deliberately by TASK-12.29, and worth finishing properly.

The project walk used to be a `glob`, which skipped a directory it could not read and
said nothing. `walkAppSourceFiles` throws instead, on the principle this epic kept
running into: a lint that quietly covers less of the project than it claims is worse
than one that stops. That part is right and is pinned by a test.

What is not right is what the user sees. The error propagates out of `getApp` to
whatever called it:

- `pos-cli check` surfaces a raw `Error: EACCES: permission denied, scandir
  '/path/app/views/partials/secret'` — accurate, but it reads like a crash rather
  than "I cannot read this directory, so I did not lint it";
- the language server's `preload` rejects, and the failure lands in whatever
  `startServer` does with a rejected preload — worth checking that it degrades
  visibly rather than leaving the session half-initialized;
- `lintBuffer` rejects, so an embedder (the MCP supervisor) turns it into a tool
  error with the same raw text.

Small piece of work: catch it where the caller is a UI, and report the DIRECTORY and
what it means. Do not go back to skipping it silently.

Reproduce: `chmod 000` any directory under `app/`, run `pos-cli check`. (The test that
pins the throw skips itself when running as root, since root reads everything.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pos-cli check reports the unreadable directory as an actionable message, not a raw stack
- [x] #2 The language server's preload failure path is checked and degrades visibly
- [x] #3 The walk still refuses to silently lint a smaller project — the existing test stays green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Done

The throw itself was already right and is untouched (AC #3 — `walk.spec.ts`'s
"surfaces a directory that exists and cannot be read" and check-node's
"surfaces a directory it cannot read instead of linting a smaller app" both still
pass, now asserting the whole error rather than a substring). What changed is what
reaches a human.

### The error explains itself (`platformos-common`)

`walkAppSourceFiles` throws `UnreadableDirectoryError` instead of re-throwing the
raw `EACCES`. It carries `uri`, `rootUri` and `cause`, and its message is:

    Cannot read directory: app/views/partials/secret
      EACCES: permission denied, scandir '/…/app/views/partials/secret'

    It is inside the app, so its contents would be deployed, and skipping it would
    mean reporting on only part of the project. Fix the directory's permissions, or
    move it out of the app, then run again.

Named RELATIVE to the root: it is how the user thinks of the directory and the only
spelling that reads the same everywhere — an absolute `file://` URI is percent-encoded
on Windows (`file:///c%3A/…`) and `fsPath` is meaningless under a virtual filesystem in
the browser. The absolute native path is not lost; the OS puts it in the cause.

Deliberately NOT "add it to `ignore`": `ignore` is applied to the paths the walk
RETURNS, so it cannot stop the walk opening the directory. That advice would not work.

### AC #1 — `pos-cli check`

`cli.ts` now catches at the top level: an `UnreadableDirectoryError` prints its message
and exits 1; anything else still prints with its stack, because that is a bug rather
than a project problem. Verified end to end against a real `chmod 000` directory — the
message above, exit code 1, no stack.

### AC #2 — the language server

Checking the preload path turned up two bugs that were NOT specific to permissions and
broke a session for any cause (a dropped network mount, `EMFILE` on a large project, a
directory another process has locked). Both pre-existed this epic:

1. `preload` is `memoize`d and `memoize` caches the REJECTED promise, so one failure
   replayed for every later preload of that root — the graph build, every rename —
   including after the cause was gone. It now `invalidate`s on failure, so a retry can
   succeed.
2. `progress.end()` was on the success path only, so 'Initializing Liquid LSP' stayed
   on screen for the rest of the session. Now ended with 'Failed'.

Plus: the user is told (`window/showMessageRequest`, MessageType.Error), deduplicated
per root per distinct message — because dropping the memo means the graph rebuild
retries on every file event, and without the dedupe an unreadable directory would put a
toast on screen on every save. A preload that succeeds clears the record, so a failure
that returns after being fixed is reported again. The log is NOT deduplicated and
carries the error object, stack included; `vscode-languageserver` rewires
`console.error` to `window/logMessage`, so it lands in the server's output channel.

`AppGraphManager` had the same cached-rejection bug (a rejected build left in
`graphs`), and its `processQueue` is driven by file-watcher events that nobody awaits,
so an escaping rejection was an unhandled one. Both fixed.

`documentManager.preloadInBackground(rootUri)` replaces the bare fire-and-forget call
in `startServer`. Crashing was considered and rejected: an unhandled rejection ends the
server process, so VS Code restarts it up to 4 times and then refuses, the user loses
every feature and has to reload the window, and the notification blames the extension
rather than the project. The failure is already visible as a toast that names the
directory, and the session self-heals once the cause is fixed.

Pinned by `DocumentManager.spec.ts` "when the walk fails": progress ends, one toast
with the exact message, a repeat of the same failure adds no second toast, and a
preload after the directory becomes readable loads all ten files.

### Not done

`ignore` still cannot exclude an unreadable directory, because the walk runs before the
filter. Nobody has asked for it; if they do, it is a change to when `ignore` is applied,
not to this error.
<!-- SECTION:NOTES:END -->
