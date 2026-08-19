---
id: TASK-81
title: >-
  Linting performs a live docs-revision request, so the test suite and every
  one-shot lint depend on the network
status: To Do
assignee: []
created_date: '2026-08-18 14:14'
labels:
  - check-docs-updater
  - architecture
  - test-infrastructure
  - measured
dependencies: []
priority: medium
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND by reproducing a CI failure: 'Integration: lintBuffers > materialises fixes while the app is still live' timed out at 5000ms. It surfaced on ubuntu/node24 and the other three matrix jobs were CANCELLED — the tests matrix has no `fail-fast: false`, so the first failure cancels the rest. The failure is therefore NOT specific to that OS or Node version: it depends on whether that runner's request to the docs host stalled, which any job can hit. Reproduced exactly by stalling ONE request — https://documentation.platformos.com/api/liquid/latest.json.

THE PATH: lintBuffers -> shared PlatformOSLiquidDocsManager.setup() -> remoteRevision() -> download() -> fetch(). setup() runs on the first lint of every process.

ALREADY FIXED (this branch): that fetch was unbounded. It now carries AbortSignal.timeout — REVISION_TIMEOUT_MS 2s for the revision check, DOWNLOAD_TIMEOUT_MS 30s for bulk downloads. Verified: with the docs host stalled the test now passes in ~2.1s instead of timing out. That was a straight defect — an outbound call on a latency-sensitive path with no bound — and it also hung pos-cli check, the language server and the MCP supervisor whenever the docs host held a socket open.

WHAT IS STILL WRONG, and is a DESIGN question rather than a defect: a lint should not reach the network at all.

- vitest runs with fileParallelism:false and isolate:true, so each of the ~253 spec files is a fresh fork and pays its own revision request. Every one is a live dependency on documentation.platformos.com, and with the host stalled each now burns 2s of its 5s budget.
- The docset already ships with the package and is refreshed explicitly at build time by postbuild ('theme-docs download data --optional'), so for a one-shot CLI lint the runtime check is redundant.
- The refresh exists for long-running processes (a language server picking up a new revision), which is legitimate — the manager time-boxes reuse with DOCS_MANAGER_MAX_AGE_MS for exactly that.

So the policy question is: WHO should refresh? Proposal to settle rather than assume: make the refresh an explicit capability of the manager (constructor takes only a Logger today, so there is no seam), opt in for the language server, opt out for one-shot lints and tests. A global fetch guard in the shared vitest setup would make the suite hermetic and faster, but it changes behaviour for 253 spec files and two specs deliberately exercise the network with stubs, so it needs deciding, not patching.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A lint performed by a one-shot consumer makes no network request
- [ ] #2 The language server can still pick up a new docs revision, and a test proves it does
- [ ] #3 The test suite is hermetic: no spec reaches documentation.platformos.com, asserted by a guard rather than by convention
- [ ] #4 The decision about who refreshes is recorded, including why the shipped docset is the right default for a one-shot lint
<!-- AC:END -->
