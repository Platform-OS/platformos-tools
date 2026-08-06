---
id: TASK-39
title: >-
  Advisory for duplicate YAML keys: accepted by the platform, but a value is
  silently lost
status: Done
assignee: []
created_date: '2026-08-02 09:16'
updated_date: '2026-08-02 16:42'
labels:
  - check-common
  - detection-gap
  - eval-round4
dependencies:
  - TASK-33
modified_files:
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - packages/platformos-check-common/src/checks/duplicate-yaml-key/index.ts
  - packages/platformos-check-common/src/checks/duplicate-yaml-key/index.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-common/src/checks/yaml-syntax-error/index.ts
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking-silence.spec.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

TASK-33 established that `pos-cli deploy --dry-run` accepts a repeated YAML key and resolves it last-wins, and removed the false block that refused those writes. Every YAML reader in the monorepo now agrees with that behaviour.

What remains is a real authoring defect with no diagnostic at all: the earlier value is silently discarded. In a translations file that means a translation the author wrote never appears, and nothing anywhere says so.

## Why this was deliberately NOT done in TASK-33

Three reasons, all of which still constrain the design:

1. It is not a deployability question. `must_fix_before_write` claims the platform will take the file, and the platform does. This must never block.
2. The server instructions currently tell an agent that a duplicated name is not reported, because the platform accepts both. TASK-33 made that sentence true. Adding a diagnostic makes it false again, so the instructions have to change in the same commit.
3. `YAMLSyntaxError` answers exactly one question — does this file parse — and its docstring commits it to syntax only. A semantic finding belongs in its own check with its own severity.

## The judgement to make

Whether a duplicated key is worth a diagnostic at all, and at what severity. The argument for: it is silent data loss, invisible in review, and the fix is unambiguous. The argument against: it is legal input the platform handles, and this server has spent four evaluation rounds learning that reporting legal input is its most expensive failure mode.

Whoever picks this up should decide that question explicitly rather than inherit it from this description.

## Falsifier

Evidence that the platform does something other than last-wins — merging, or taking the first value. The remedy text would then be wrong in a way an author would act on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repeated key produces a NON-blocking diagnostic naming both positions, so the author can see which value is being discarded
- [x] #2 must_fix_before_write stays false for a duplicate key, and a test asserts it: the platform deploys the file, so the write gate must not move
- [x] #3 The severity decision is recorded with its reasoning, including why this is not an error despite discarding data
- [x] #4 The check is separate from YAMLSyntaxError, whose docstring commits it to syntax only
- [x] #5 The server instructions are updated in the same change, since they currently tell the agent a duplicated name is not reported at all
- [x] #6 The must-stay-silent corpus is updated so it asserts the absence of a BLOCK rather than the absence of any diagnostic, wherever the two now differ
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The falsifier was the real work

**Last-wins had never been measured.** It was asserted in THREE places — `yaml/parse.ts`, TASK-33's own notes, and `FINDINGS.md:81` — and every one of those claims rode along in a sentence about `pos-cli deploy --dry-run` ACCEPTING a duplicate-key file. Acceptance and resolution are different questions; only the first had an oracle behind it. TASK-33's notes even say plainly "I did NOT re-run `--dry-run` myself".

Settled 2026-08-02 by deploying a probe (authorised, minimal, reverted):

```
app/translations/en/pos_dup_probe.yml
  en:
    pos_dup_probe_key: FIRST
    pos_dup_probe_key: SECOND
    pos_dup_probe_nested:
      a: FIRST
      a: SECOND

-> top=[SECOND]  nested=[SECOND]  absent=[translation missing: ...]
```

Last-wins at BOTH levels. The absent-key control is what makes it conclusive: an unresolved key renders `translation missing`, so `SECOND` is a real resolution rather than a fallback. Synced with `pos-cli sync --file-path` (single file, not a full deploy), then removed via `DELETE /api/app_builder/marketplace_releases/sync` and verified gone — `sync --file-path` on a deleted file is a silent no-op, which would have left the probe live.

The falsifier did NOT trigger, so the remedy text can honestly say the earlier value is discarded.

## The severity decision (AC#3)

**WARNING**, with precedent rather than intuition: `DuplicateRenderPartialArguments` is the same defect one level up — a duplicate the runtime tolerates while discarding a value — and it is a WARNING. The same situation should not get a different severity for being in YAML.

- Against ERROR: the platform accepts the file; `errors[]` is where an agent looks for things that stop code working.
- Against INFO: this is silent DATA LOSS, not a style preference.

The distinction from the false-block failures of rounds 1-4 is the load-bearing part: that input was legal AND INTENDED. A key written twice is legal and essentially never intended — there is no authoring pattern where you define a key twice and want the first thrown away.

Severity is NOT what keeps it off the gate, and the check says so: `blocksWrite` requires `severity === 'error'` AND `BLOCKING_CHECKS` membership. This satisfies neither, so AC#2 is true twice over by construction.

## Design decisions

**Anchored on the DISCARDED entry**, deliberately departing from `DuplicateRenderPartialArguments`, which anchors on the later occurrence. Here the later occurrence WINS (measured), so highlighting it would point the author at the working value and invite them to delete it.

**Detection cannot use the shared AST.** `toYAMLNode` builds the JSON node model through `toJS`, which has already resolved the duplicate away. The duplicate only exists in the YAML document, so `findDuplicateKeys` re-parses with `uniqueKeys: false` — where both pairs survive in `items` with ranges.

**Three false positives designed out**, each checked against platform semantics rather than assumed:

| case | why it is NOT a duplicate |
|---|---|
| `1:` vs `"1":` | number and string are distinct Ruby Hash keys. `toJS()` collapses them because JS keys are strings — a property of the JS model, not the document |
| `yes:` vs `true:` | YAML 1.2 resolves one to a string and one to a boolean |
| `<<:` twice | merge keys are repeatable under YAML 1.1 and the platform's handling is UNMEASURED — silence until it is |

Keys are compared by resolved TYPE AND VALUE, never source text.

**Unparseable files are left to `YAMLSyntaxError`** — a second opinion on a file the author must already fix is noise, and the offsets would be untrustworthy.

## Two defects of my own, found and fixed

**A NUL byte** (`\x00`) sat in the identity template literal where a space belonged. It compiled, worked, and silently defeated three separate attempts to edit that line before the inconsistent tool output gave it away. Removed; audited every other new file — none.

**A vacuous test.** The parse-guard case used a broken file with no duplicate in it, so deleting the guard failed nothing — the silence came from the input, not the guard. The fixture now carries a real duplicate the parser still recovers, plus a control asserting the duplicate IS findable, so neither half is vacuous. Sabotage (e) went from passing to failing once fixed.

## Sabotage verification

| # | Sabotage | Result |
|---|---|---|
| a | `<<` exclusion removed | merge-key silence fails |
| b | compare by `String(value)` not type+value | the `1` vs `"1"` case fails |
| c | sequence walk removed | seq-item duplicate missed |
| d | anchor on survivor instead of discarded | 5 range assertions fail |
| e | parse guard removed | broken-file silence fails (after the fixture was fixed) |
| f | 0-based instead of 1-based line | 5 message assertions fail |

## Documents corrected in the same change (AC#5)

- `instructions.ts` — a duplicated name is no longer described as unreported; both halves pinned in `validate-code.spec.ts` (that it IS reported, that it does NOT block), plus a negative pin so the old sentence cannot return.
- `yaml-syntax-error/index.ts` — records that the syntax/semantics split held: still not a syntax error, now reported by a separate non-blocking check.
- `yaml/parse.ts` — separates the measured acceptance claim from the now-measured resolution claim, and names why they were conflated.

## AC#6

The check-common silence corpus scopes to `check(app, [YAMLSyntaxError])`, so its claims stay true unchanged. The supervisor corpus filters `fromCheck` per code and asserts `blocked` across the whole gate, so it also survives. Added an explicit end-to-end test asserting the absence of a BLOCK together with the PRESENCE of the advisory — asserting only the silence would let the check be deleted without a failure; asserting only the warning would let it drift onto the write gate.

## Verification

320 test files / 3153 tests pass, type-check clean, prettier clean, build clean.
<!-- SECTION:NOTES:END -->
