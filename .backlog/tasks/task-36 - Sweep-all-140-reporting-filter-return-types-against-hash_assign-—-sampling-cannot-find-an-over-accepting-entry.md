---
id: TASK-36
title: >-
  Sweep all 140 reporting filter return types against hash_assign — sampling
  cannot find an over-accepting entry
status: Done
assignee: []
created_date: '2026-08-02 07:10'
updated_date: '2026-08-02 12:45'
labels:
  - check-common
  - false-block
  - testing
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - packages/platformos-check-common/scripts/verify-filter-return-types.mjs
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-oracle.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-sweep.spec.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`InvalidHashAssignTarget` now derives variable types from the docset `return_type`. Four spellings map to reporting types: `string` (78 filters), `array` (31), `number` (17), `boolean` (14) — 140 filters in total. A single wrong `return_type` among them is a false block on valid code.

Round 4 tested roughly a dozen of the 140 and named this the largest unexamined surface it was aware of. Its reasoning is correct and worth preserving: sampling a subset of an accepting population cannot find an over-accepting member. This is the same structural blindness that let twelve fictional filter names survive round 1, and it was closed there by a full sweep rather than more sampling.

## What to do

Mechanically exercise every one of the 140: assign a variable through the filter, then `hash_assign` into it with both a key and an index subscript, and compare the check's verdict against the runtime.

`liquid_exec` is the correct oracle here, not `--dry-run`. A bad `hash_assign` target is a runtime raise, not a converter rejection; the converter accepts every one of these buffers. The rule that the dry-run oracle outranks the runtime one is scoped to syntax.

## Related

The complementary gap — six spellings deliberately mapped to `untyped`, five of which the runtime can now disambiguate — is TASK-37. This task is about the filters that DO report, and whether every one of them should.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every filter whose docset return_type maps to a reporting type is exercised through assign-then-hash_assign, with both a key subscript and an index subscript
- [x] #2 Each reported case is settled against the runtime oracle, so a report is known to be a true positive rather than assumed to be one
- [x] #3 Any filter whose docset return_type is contradicted by the runtime is recorded with the evidence, and the resulting fix is either a mapping change or a docset data correction, named explicitly
- [x] #4 The sweep is a repeatable artefact in the repo, so a docset update re-runs it instead of requiring the analysis to be redone by hand
- [x] #5 The filters mapped to untyped are listed with their spellings, so the deliberately-silent population is visible rather than implicit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

**No over-accepting entry exists.** All 163 reporting filter names agree with the runtime, for both subscripts. AC#3 is satisfied vacuously: nothing was contradicted, so neither a mapping change nor a docset correction was needed. The check's `DOCSET_RETURN_TYPES` and `filters.json` were left untouched.

## The population is 163, not 140

The task was filed against "140 reporting filter return types". That is the docset row count; it is not what the check sees.

- `filters.json` holds 140 reporting rows over **138 distinct names** (`map` and `split` are each listed twice; the check keys a Map by name, so the last wins).
- `AugmentedPlatformOSDocset.expandAliases` re-emits every entry under each of its aliases **with `return_type` attached**, adding **25 more reportable names** that appear nowhere in `filters.json` as filters: `to_json`, `t`, `t_escape`, `select`, `sort_by`, `reject`, `limit`, `compact`, `flatten`, `any`, `map_attributes`, `markdownify`, `date_before`, `sum_array`, `intersection`, `in_groups_of`, `rotate`, `add_to_array`, `prepend_to_array`, `shuffle_array`, `subtract_array`, `is_included_in_array`, `jwe_encode_rc`, `to_xml_rc`, `www_form_encode_rc`.

A sweep built over the raw docset covers 138 and reports full coverage while missing 25 — the same shape of mistake as sampling, one level up. All 25 were measured and all 25 agree.

The undocumented filters the augmentation also appends carry no `return_type`, so they resolve to `untyped` and report nothing; covered by `undocumented-filters.spec.ts`.

## Method

Three measurements per filter, because one cannot tell a wrong docset entry from a badly-written probe:

- `{{ x | type_of }}` — what the value IS (diagnosis)
- `{% hash_assign x['k'] = … %}` — key subscript (settlement)
- `{% hash_assign x[0] = … %}` — index subscript (settlement)

Oracle is O1a (`liquid_exec`), not O1c: a bad `hash_assign` target is a runtime raise, not a converter rejection, and the converter accepts every one of these buffers.

Invocations are hand-written. A mechanically-derived call from the docset's `parameters[]` produces `'abc' | abs` and `'abc' | plus: 'a'`, which raise for reasons unrelated to the return type — and a filter that raises says nothing about what it returns. Every one was iterated against the instance until it rendered. Alias invocations are *derived* from their parent's by name substitution, asserted to have actually changed the string, so the two cannot drift.

## What the measurements showed

The runtime type is frequently NOT the plain class the docset names, and every one still behaves as its docset spelling predicts:

- `ActiveSupport::SafeBuffer` (8 filters: markdown, sanitize, html_safe, format_number, escape_javascript, raw_escape_string, url_to_qrcode_svg, videoify)
- `JOSE::EncryptedBinary` (jwe_encode) — docset says `string`
- `Float` where the docset says `number` (round, time_diff, fractional_to_amount)
- `null` — `asset_name_to_raw_url` returns nil for a missing asset; still raises, so the report is a true positive

This is why the settlement is the `hash_assign` outcome and `type_of` is recorded only as diagnosis.

## Three rows unmeasurable through the transport

`ecdh_compute`, `gzip_compress`, `hkdf` return binary; the runtime's complaint quotes the offending value back, and the response is an HTTP 406 with no body. They are settled by composition — all three measured `type_of` as `String`, and every other `String` row was measured raising for both subscripts — and `settledOutcome()` **throws** rather than guessing if those peers ever disagree.

This was also a **probe defect caught before it became a finding**: the first classifier treated only 5xx as failure, so the 406 read as `rendered`, i.e. as a false block by the check. Any non-2xx is now `unmeasured`.

## Artefacts

- `scripts/verify-filter-return-types.mjs` — the generator. Not run in CI (needs instance credentials). Generates ephemeral EC/RSA keys per run for `ecdh_compute`/`jwe_encode` and **never writes them out**. **Refuses to run** if its invocation table and the docset disagree about which filters report, so a docset addition stops the sweep and demands an invocation rather than leaving a name unswept. Formats its output with prettier before writing, so regeneration is byte-stable and never dirties the tree.
- `filter-return-type-oracle.ts` — 163 committed measurements, plus `UNTYPED_RETURN_TYPE_SPELLINGS` (AC#5) and `HASH_RETURN_TYPE_FILTERS`, kept separate because `hash` is *recognised* (maps to `object`, a valid target) whereas the rest are spellings the check *refuses to interpret*.
- `filter-return-type-sweep.spec.ts` — hermetic, runs in CI, drives the real check over the real `filters.json` through the engine's own `check()` so aliases are expanded by the real code path. Both adjacent and newline-separated shapes are run and required to agree, because this check has already had one boundary defect only one shape could see.

## Sabotage verification

Seven sabotages, each reverted:

| # | Sabotage | Result |
|---|---|---|
| A | `array` mapped to `string` in the check | 43 disagreements |
| B | array reports regardless of subscript | 43 disagreements |
| C | one oracle row falsified | composition guard threw, refusing to infer |
| D | docset gains a reporting filter | coverage tripwire failed |
| E | docset retypes `upcase` to `array` | 2 tests failed, naming `upcase` |
| F | adjacency start bound made exclusive again | shape-disagreement guard threw |
| G | `expandAliases` removed from the augmentation | 36 disagreements (14 array aliases × 1 + 11 others × 2) |

## Verification

319 test files / 3129 tests pass, type-check clean, prettier clean, build clean. Regeneration against an unchanged instance produces a byte-identical file.
<!-- SECTION:NOTES:END -->
