---
id: TASK-58
title: >-
  Move the dependency majors that current ranges block — one PR per group,
  changelog-driven
status: To Do
assignee: []
created_date: '2026-08-04 21:47'
updated_date: '2026-08-04 21:51'
labels:
  - dependencies
  - maintenance
  - tech-debt
dependencies: []
documentation:
  - 'https://github.com/microsoft/TypeScript/releases'
  - 'https://eslint.org/docs/latest/use/migrate-to-10.0.0'
  - 'https://github.com/graphql/graphql-js/releases'
  - 'https://github.com/colinhacks/zod/releases'
  - 'https://github.com/webpack/webpack-dev-server/blob/master/CHANGELOG.md'
  - >-
    https://github.com/microsoft/vscode-languageserver-node/blob/main/CHANGELOG.md
  - 'https://github.com/nodeca/js-yaml/blob/master/CHANGELOG.md'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

On 2026-08-04 both lockfiles were regenerated so every package sits at the newest version its declared range allows, and `yarn audit` reports **0 vulnerabilities** for the root and `packages/vscode-extension/syntaxes` lockfiles. Roughly 20 packages have newer **majors** that the declared ranges still block. None are needed for security — they were deliberately deferred because they carry breaking changes.

This card records what is left, the traps already discovered, and the verification protocol, so a future session does not have to re-derive any of it.

## How to work this

Land **one PR per group** below. For every major bumped: read that project's changelog / migration guide FIRST, then bump the range in the owning `package.json`, re-resolve, and run the full verification protocol. Summarise the breaking changes you actually hit in the PR description.

**Verification protocol** (all commands need `NPM_TOKEN=dummy`):
`yarn install` → `yarn build` → `yarn type-check` → `yarn test` (baseline: 306 files / 2983 tests) → `yarn --cwd packages/prettier-plugin-liquid test`, `test:3`, `test:idempotence`, `test:idempotence:3` (baseline: 85 files / 137 tests each) → `yarn --cwd packages/vscode-extension/syntaxes test` (baseline: 494 passing / 0 failing) → `yarn audit` in root **and** in `packages/vscode-extension/syntaxes`.

## Inventory (current → target, owning package)

**A. Dev/build tooling — low risk, can share one PR.** webpack-cli 6→7, webpack-dev-server 5→6, copy-webpack-plugin 13→14, jsdom 28→30 (root devDeps); env-paths 2→4 (check-docs-updater); markdown-it 14→15 (codemirror-language-client); @vscode/test-electron 2→3, @vscode/test-web 0.0.62→0.0.81, ovsx 0.10→1.1, @types/node ^22→^26, @types/prettier 2→3 (vscode-extension); @vscode/web-custom-data 0.4→0.6 (language-server-common).

**B. typescript 5.9 → 7** (root devDep, used by every package). Expect new errors. Note `tsconfig.json` now sets `lib: ES2022` with `target: es2021`.

**C. eslint 8 → 10** (vscode-extension devDep). Needs the flat-config migration (`eslint.config.js`); @typescript-eslint 8.66 is already installed. **Also in scope:** eslint was silently crashing until 2026-08-04, so its findings were never addressed — it currently reports 10 errors / 11 warnings in `packages/vscode-extension/src`. Fix or triage them here.

**D. graphql 16 → 17** (check-common, language-server-common) — verify `graphql-language-service` supports 17 before starting.

**E. zod 3 → 4** (mcp-supervisor) — must stay inside the range `@modelcontextprotocol/sdk` supports.

**F. vscode-languageserver 9 → 10 / vscode-languageclient 9 → 10** (language-server-*, vscode-extension). Protocol 3.18; the types are already at 3.18.0, where `Diagnostic.message` is `string | MarkupContent` — `JSONValidator` normalises it via `Diagnostic.getMessageString()`.

**G. js-yaml 4 → 5** (platformos-common, check-common) — touches translation and YAML-check parsing. Read the changelog for YAML 1.1 vs 1.2 scalar handling and cross-check against task-55.

**H. Resolutions-pinned transitives** in root `resolutions`: uuid ^11→^14, diff ^8→^9 (diff is also pinned in the syntaxes `resolutions`).

**I. syntaxes sub-project:** `vscode-textmate` and `vscode-oniguruma` are declared as `"latest"`, which makes any fresh install non-reproducible. Pin them to real ranges. Regenerating already moved them 8.0.0→9.3.2 and 1.7.0→2.0.1 with a byte-identical test result.

## Traps already paid for — do not rediscover

- **Never re-add an unscoped `"ajv"` resolution.** yarn 1 bare-name resolutions beat scoped ones, so it forces eslint's `ajv@^6.12.4` onto ajv 8 and eslint dies with `TypeError: Cannot set properties of undefined (setting 'defaultMeta')`. The entry was removed; eslint/eslintrc now get ajv 6.15.0 and audit stays clean.
- **webpack ≥ 5.109** defaults `experiments.typescript` to `"auto"`, which self-enables when Node ≥ 22.6 and no `.ts` loader is registered. It then resolves imports back to sibling `.ts` sources and strips them in strip-only mode, which cannot handle `enum`. `prettier-plugin-liquid/webpack.config.js` sets it to `false`.
- **@types/node ≥ 24** dropped the `RelativeIndexable` augmentation that made `Array.prototype.at()` type-check under `lib: ES2021`. That is why `lib` is now ES2022.
- **The syntaxes mocha suite is not run by CI** and is not a yarn workspace, so root `yarn install --frozen-lockfile` never installs its deps. It is green at **494 passing / 0 failing** as of 2026-08-04 (the old 476/18 baseline is gone), so any failure there is a real regression — run it by hand when touching the grammar or its dependencies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each group A–I lands as its own PR, or is explicitly declined with the reason recorded on this task
- [ ] #2 For every major bumped, the upstream changelog/migration guide is read and the breaking changes actually encountered are summarised in that PR's description
- [ ] #3 `yarn audit` reports 0 vulnerabilities for the root lockfile and for packages/vscode-extension/syntaxes/yarn.lock after each PR
- [ ] #4 `yarn build`, `yarn type-check` and `yarn test` pass, with no drop from the 306 files / 2983 tests baseline
- [ ] #5 prettier-plugin-liquid passes all four suites (test, test:3, test:idempotence, test:idempotence:3)
- [ ] #6 The syntaxes mocha suite stays at 494 passing / 0 failing
- [ ] #7 vscode-textmate and vscode-oniguruma are pinned to explicit ranges instead of "latest"
- [ ] #8 Any package deliberately left below its latest major carries a comment in package.json stating why
- [ ] #9 eslint reports zero errors in packages/vscode-extension/src once group C lands
- [ ] #10 CLAUDE.md is updated wherever a bump changes a documented command, constraint or version floor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-08-04: the syntaxes trap noted in the description is now obsolete. That suite was fixed in the same session and is **494 passing / 0 failing** — the old 476/18 baseline no longer applies, so treat ANY failure there as a regression. All 18 failures were stale Shopify-era baselines: they expected `all_products`, `collection`, `product` and `settings` to scope as `variable.language.liquid`, but `liquid/objects.yml` now lists only platformOS globals, so those identifiers correctly fall through to `variable.other.liquid`. Fixed with `yarn test:accept`; verified identical on vscode-textmate 8.0.0 and 9.3.2. Note the suite is still not run by CI, so group I must exercise it by hand.
<!-- SECTION:NOTES:END -->
