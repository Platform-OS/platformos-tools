---
id: TASK-83
title: >-
  Make ValidFrontmatter's deploy-fatal findings block, by splitting it into
  per-shape checks
status: To Do
assignee: []
created_date: '2026-08-22 16:31'
labels:
  - platformos-check
  - correctness
  - frontmatter
  - epic
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
  - >-
    .backlog/tasks/task-26 -
    ValidFrontmatter-findings-that-hard-fail-the-deploy-are-warnings-and-do-not-block-—-needs-a-discriminator-before-the-gate-can-act.md
priority: high
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`ValidFrontmatter` reports seven distinct rules under one check code at `Severity.WARNING`. Six of them are measured **hard converter rejections**, and a converter rejection fails the ENTIRE changeset rather than the offending file. `validate_code` answers `must_fix_before_write: false` for every one of them, so the write gate approves files that cannot deploy.

Three of the six are not reported at all today.

## Measured deploy behaviour (live instance, `pos-cli deploy --dry-run`, 2026-08-22)

| Shape | Deploy | Reported today |
|---|---|---|
| unknown field | **REJECTED** — `Unknown properties: …` | warning |
| layout missing | **REJECTED** — `Could not find Layout with layout: …` | warning |
| `layout: false` | **REJECTED** — `undefined method 'sub' for false` | warning, and the message says it is harmless |
| invalid enum (`method: POST`) | **REJECTED** — `Request method 'POST' is not allowed` | **nothing** |
| frontmatter YAML syntax (tab, unclosed flow) | **REJECTED** — `Body contains invalid YAML: …` | **nothing** |
| `spam_protection: recaptcha_v3` (bare string) | **REJECTED** — `undefined method 'keys' for an instance of String` | **nothing** |
| deprecated field (`layout_name`, `redirect_url`) | accepted | warning |
| deprecated `home.liquid` alias | accepted | warning |
| missing required field | accepted | unreachable — no schema sets `required: true` |
| association missing (`authorization_policies`) | **UNKNOWN** | warning |

`authorization_policies` cannot be settled by `--dry-run`: `base_converter.rb` returns before `persist_slice!` and before `bulk_write_associations_from_snapshot!`, which is where `raise_missing_association_error` lives. Until a real deploy settles it, the supervisor's own rule applies — the gate never blocks on its own uncertainty — so that shape stays non-blocking.

## Why splitting, rather than a discriminator field

TASK-26 records this as blocked on TASK-8.1 (a typed `data` payload on `Offense`). That is a **mis-linkage**: TASK-8.1 asks *which symbol a diagnostic is about*, for rendering a docset entry, and its leading answer is `findCurrentNode`. What the write gate needs is *which rule fired* — a different question `findCurrentNode` cannot answer, and one the repository already answers everywhere else with a check code.

One rule per code is the established house style: doc-params are five codes (`MissingDocParam`, `UniqueDocParamNames`, `ValidDocParamTypes`, `UnusedDocParam`, `RequiredDocParamWithDefault`), filters are four (`UnknownFilter`, `FilterArity`, `ValidFilterArgumentTypes`, `DeprecatedFilter`). `ValidFrontmatter` carrying seven rules is the anomaly.

Splitting needs no new seam, no cross-package contract change, and gives each shape its own severity, its own config entry, and direct `BLOCKING_CHECKS` membership.

## Decisions taken

- **Hard split, no alias layer.** A project naming `ValidFrontmatter` in `.platformos-check.yml` must update. The repository has no check-aliasing machinery and building it for one migration is not justified; the changeset names the replacement codes.
- **Association-missing stays non-blocking** until a real deploy settles it.
- **ApiCall `request_type` stays case-insensitive**: `api_call_notification.rb:16` validates presence only, with no inclusion check, so tightening it would invent a false block. Page `method` is case-sensitive (`page.rb:11,34`). That asymmetry is why casing is a per-field flag rather than a global switch.

## Subtask order

S1 first: it establishes the codes, so each later detection fix lands already classified and blocking correctly. S5 is independent and may land at any time.

## References

`UPSTREAM-ISSUES-VERIFIED.md` — issue 1 (D1, D2, D3), N1, N2, N3, N4, N6 carry the reproductions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every subtask is Done
- [ ] #2 `validate_code` returns `must_fix_before_write: true` for each of: unknown field, missing layout, `layout: false`, `method: POST`, tab-indented frontmatter, and a bare non-`recaptcha` `spam_protection` string
- [ ] #3 `validate_code` still returns `must_fix_before_write: false` for a deprecated field, a deprecated `home.liquid`, and a missing authorization policy — each with a control proving the check itself still reports
- [ ] #4 No consumer distinguishes frontmatter findings by matching the message string
<!-- AC:END -->
