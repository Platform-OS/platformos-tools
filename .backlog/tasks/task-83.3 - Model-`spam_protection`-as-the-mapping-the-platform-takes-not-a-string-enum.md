---
id: TASK-83.3
title: 'Model `spam_protection` as the mapping the platform takes, not a string enum'
status: Done
assignee: []
created_date: '2026-08-22 16:32'
updated_date: '2026-08-22 17:52'
labels:
  - platformos-check
  - platformos-common
  - frontmatter
  - correctness
dependencies: []
parent_task_id: TASK-83
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`spam_protection` is declared as `type: 'string'` with `enumValues` (`platformos-common/src/frontmatter.ts:449-452`). The platform takes a **mapping whose first key is the strategy**, and accepts exactly one bare string, `recaptcha`.

The check therefore fires on the shape the platform recommends and stays silent on three that are deploy-fatal. Every mapping form also produces `Invalid value 'undefined' for 'spam_protection'`, because a non-scalar has no `jsValue` to interpolate.

## Measured contract (live instance, `--dry-run`, 2026-08-22)

| frontmatter | platform | linter today |
|---|---|---|
| `spam_protection: recaptcha` | accepted | ok |
| `spam_protection: recaptcha_v3` | **REJECTED** `undefined method 'keys' for an instance of String` | ok — false negative |
| `spam_protection: hcaptcha` | **REJECTED** same | ok — false negative |
| `spam_protection: RECAPTCHA_V3` | **REJECTED** same | ok — false negative |
| `recaptcha: {}` (mapping) | accepted | warning — false positive |
| `hcaptcha: {}` (mapping) | accepted | warning — false positive |
| `recaptcha_v3: {action, minimum_score}` | accepted | warning — false positive |
| `bogus_strategy: {}` | **REJECTED** `Invalid strategy bogus_strategy, available strategies: recaptcha_v2, recaptcha_v3, hcaptcha` | warning, right outcome wrong reason |
| `recaptcha_v3:` without `action` | **REJECTED** `Invalid options for reCAPTCHA V3, action is required` | warning, wrong reason |
| `recaptcha_v3:` with `minimum_score: 2` | **REJECTED** `minimum_score must be between 0 and 1` | warning, wrong reason |

## Platform source

`app/models/form_configuration/spam_protection_configuration.rb`:
- `:28` `strategy` is `@config.keys.first` unless the legacy string form
- `:42` `old_config?` is `@config == 'recaptcha'` — the only valid bare string
- `:46` `v3_config` reads `@config['recaptcha_v3']`

Validated by `FormConfiguration::SpamProtectionValidator` (`form_configuration.rb:64`), whose list is `SPAM_PROTECTION_STRATEGIES` (`:34`) matched with case-sensitive `include?`.

## Scope

Model the field so a mapping is the expected shape and `recaptcha` the one legacy string; report an unknown strategy key, and a missing `action` or an out-of-range `minimum_score` under `recaptcha_v3`. Independently: the enum message must never be able to print `undefined` — for a non-scalar the check either says something true or says nothing.

Depends on TASK-83.1 for the code this reports under.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each of the four accepted forms in the table stays silent, and the silence is paired in the same test with a rejected form that must report
- [x] #2 Each of the six rejected forms in the table reports, and `validate_code` returns `must_fix_before_write: true` for the three whose failure is a converter rejection of the value itself
- [x] #3 No frontmatter message can contain the literal `undefined`, asserted over a non-scalar value for every enum-bearing field
- [x] #4 The strategy key comparison is case-sensitive, matching `SPAM_PROTECTION_STRATEGIES`
- [x] #5 Reverting the field to a plain string enum makes tests fail in both directions — a false positive on the mapping form and a false negative on the bare string (sabotage-verified)
- [x] #6 A changeset accompanies the change
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`spam_protection` is modelled as the mapping the platform takes, ending a false positive on the recommended shape and three deploy-fatal false negatives.

The strategy is the mapping's first key (`SpamProtectionConfiguration#strategy` reads `@config.keys.first`), and `recaptcha` is the single legacy plain string (`old_config?`). Anything else given as a plain string reaches `.keys` and raises. `recaptcha_v3` additionally requires an `action` and a `minimum_score` in 0..1.

`SPAM_PROTECTION_STRATEGIES` and `LEGACY_SPAM_PROTECTION_STRING` are exported from `platformos-common` beside the schema they belong to.

All ten measured rows from the task table are tests, the accepted rows sharing a group with the rejected ones so neither half can go vacuous. One test asserts no frontmatter message can contain the literal `undefined` — every mapping form used to produce `Invalid value 'undefined' for 'spam_protection'`, because a non-scalar has no value to interpolate.

Three sabotages bite: reverting the field to a string enum (7 failures, in both directions), removing the bare-string rule, and removing the `recaptcha_v3` option rules.

Two of the old tests encoded the wrong model — one expected the enum message, the other asserted all four bare strings were valid — and were replaced rather than extended.
<!-- SECTION:FINAL_SUMMARY:END -->
