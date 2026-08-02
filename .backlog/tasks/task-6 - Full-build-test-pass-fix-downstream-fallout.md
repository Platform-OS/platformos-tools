---
id: TASK-6
title: Full build + test pass; fix downstream fallout
status: Done
assignee: []
created_date: '2026-05-11 13:12'
updated_date: '2026-08-02 09:58'
labels:
  - testing
dependencies:
  - TASK-4
  - TASK-5
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-1 … TASK-5 land, run the full monorepo build and test suite and fix the
fallout.

```bash
NPM_TOKEN=dummy yarn build
NPM_TOKEN=dummy yarn test
yarn type-check
```

## Fallout to expect (revised 2026-08-02)

- **Extension-anchored classification (TASK-1).** Any fixture that leans on a
  wrong-extension file being classified — most likely `.yaml` translation fixtures,
  since `.yaml` stops being a platformOS extension.
- **`.yaml` leaving `SOURCE_FILE_EXTENSIONS`** changes `SOURCE_FILE_GLOB`, which the
  lint's walk, the LSP's file-operation filter and the VS Code file watcher all derive
  from. `vscode-extension/src/common/constants.spec.ts` asserts the glob patterns
  literally (`**/{app,marketplace_builder,modules}/**/*.yaml` at `:23`) and will fail —
  that is the guard doing its job, not a fixture to paper over.
- **Anchored classification (TASK-3.1).** Specs that classify a bare URI with no
  project root, or that rely on a fixture outside `app/` being recognised.
- **Snapshot churn** wherever a file's classification or the loaded-file set moved.

**`marketplace_builder/` removal is cancelled** — the old AC#4 ("grep returns no live
hits") is wrong and dropped. That root stays; see TASK-1.

## Baseline, not an absolute number

The old AC pinned "239 test files, 1576+ tests", which is stale. Capture the counts on
the branch tip BEFORE starting and compare, so a test that silently stops running is
visible. Note `packages/syntaxes` has its own mocha suite with a known pre-existing
failure baseline (476 passing / 18 failing on master as of 2026-07-21) — it is
unrelated to this epic and must not be "fixed" here.

## Also verify on real projects

`yarn test` does not cover the thing most likely to break: which files are in the app.
For arabbank and pos-module-community, compare before/after the file count, the
per-type counts and the offense totals. TASK-1.1's notes are the template — it caught a
3140 → 3139 change and named the one file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `yarn build` succeeds with zero TypeScript errors
- [x] #2 `yarn type-check` passes
- [x] #3 `yarn test` shows no failures beyond the recorded pre-existing `packages/syntaxes` baseline, and no drop in test-file or test count against the pre-change baseline
- [x] #4 File counts, per-type counts and offense totals on arabbank and pos-module-community are compared before and after, with every difference explained by name
- [x] #5 The VS Code glob/documentSelector specs are updated to match the new `SOURCE_FILE_GLOB` rather than exempted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02, covering the TASK-1 … TASK-5 slice. TASK-3.1 is still open and carries
its own verification ACs (the LSP loaded-file-set comparison), so its dependency here
was dropped rather than blocking this.

## Results

    yarn build       clean
    yarn type-check  clean
    yarn test        294 files, 2700 tests, 0 failures

Baseline before the change was 294 files / 2699 tests, so nothing stopped running; the
delta is +52 new assertions in platformos-common minus the .yaml selector test that was
replaced by an inverted one.

## Fallout, all of it the .yaml removal

Five tests in three files failed, every one a glob or selector assertion — the guards
doing exactly their job. Updated, none exempted:

- `platformos-check-node/src/index.spec.ts` — four `getAppFilesPathPatterns` globs
- `language-server-common/src/server/startServer.spec.ts` — the rename-report pattern
  and the file-watcher globPattern
- `vscode-extension/src/common/constants.spec.ts` — the documentSelectors list and the
  yaml-source selection test, plus a NEW inverted test pinning that `.yaml` is now
  rejected, with the `translation.rb:7` reason

No snapshot churn and no fixture moved. Nothing depended on a wrong-extension file.

## Real projects — no collateral

App file sets byte-identical before and after on all four:

| | files | removed | added |
|---|---|---|---|
| pos-module-community | 946 | 0 | 0 |
| arabbank | 3139 | 0 | 0 |
| Accala-MP | 2789 | 0 | 0 |
| htevent | 2895 | 0 | 0 |

Offense totals identical per-check as well: pos-module-community 43 → 43,
arabbank 9623 → 9623, every individual check count matching.

Method: stash the two source files, rebuild platformos-common, dump
`App.all()` + per-type counts + full sorted path list, restore, rebuild, diff.
Scripts in the session scratchpad (`appdump.mjs`, `lintcount.mjs`).

`packages/syntaxes` runs its own mocha suite and was not touched.

## Note for whoever runs this again after TASK-3.1

The interesting comparison there is different: the LSP's loaded-file set, not the App's.
The App already excludes what the unanchored classifier still admits.
<!-- SECTION:NOTES:END -->
