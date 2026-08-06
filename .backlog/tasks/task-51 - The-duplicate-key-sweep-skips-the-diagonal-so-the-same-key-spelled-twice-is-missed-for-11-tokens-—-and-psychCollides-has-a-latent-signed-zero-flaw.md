---
id: TASK-51
title: >-
  The duplicate-key sweep skips the diagonal, so the same key spelled twice is
  missed for 11 tokens — and psychCollides has a latent signed-zero flaw
status: Done
assignee: []
created_date: '2026-08-03 11:14'
updated_date: '2026-08-03 16:42'
labels:
  - check-common
  - yaml
  - missed-detection
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-check-common/src/yaml/duplicate-keys.spec.ts
modified_files:
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.spec.ts
  - packages/platformos-check-common/src/yaml/psych-key-identity.ts
  - packages/platformos-check-common/scripts/verify-yaml-key-identity.mjs
  - docs/platformos-gotchas.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why — a spec assertion that is narrower than the comment claims

TASK-43 shipped a soundness sweep and pinned the missed set to exactly `['1:30 + 5400']`, with a comment reasoning that the sexagesimal is the only genuine trade. The sweep skips `a === b`:

```ts
for (const [a] of RESOLVABLE) for (const [b] of RESOLVABLE) { if (a >= b) continue; … }
```

So the pin says nothing about the most obvious duplicate shape there is: **the same key, spelled the same way, twice.** The comment's confidence is the problem — it reads as an exhaustive bound and is not one.

## Independently re-verified — 11 tokens, not the 10 the eval reported

Sweeping the diagonal over all 61 corpus tokens, `findDuplicateKeys('<tok>: x\n<tok>: y\n')` reports nothing for:

```
y  Y  n  N  0X10  1e3  .inf  -.inf  .nan  1:30  2026-01-01
```

The eval's list omits `2026-01-01`, so the defect is one token wider than reported.

Each is in `UNCOMPARABLE`, and `identityOf` returns `undefined` before any comparison happens. Psych confirms a value IS discarded:

```
en:
  .inf: 1
  .inf: 2      ->  {"en" => {Infinity => 2}}, size 1
```

Literally the same text twice, one key on the platform, last wins, and the check is silent.

`UNCOMPARABLE` exists for a good reason — those tokens' Psych identity is not reproducible from the npm parser's value, and skipping them is what makes the sweep sound. But **identical source text needs no identity resolution at all**: two byte-identical keys collide under every dialect, so the soundness argument for skipping them does not apply.

Also confirmed missed off the diagonal, outside the corpus: `TrUe`/`true`, `oN`/`on`, `.inf`/`.Inf` — all one key in Psych, because npm 1.1 resolves the odd-cased spellings to strings.

## The second, latent defect — the spec's own oracle predicate

```ts
const psychCollides = (a, b) => {
  const left = PSYCH_KEY_IDENTITY[a], right = PSYCH_KEY_IDENTITY[b];
  return left.klass === right.klass && left.value === right.value;
};
```

`value` is stored as a **string** in the generated oracle (`{"klass":"Float","value":"1.0"}`), so this compares `"-0.0" === "0.0"` → false. Ruby collapses them:

```
YAML.load("-0.0: x\n0.0: y\n")  ->  {-0.0 => "y"}     size 1
```

Latent today only because no signed zero is in the corpus (verified: the zero-ish tokens are `0`, `0x10`, `0X10`, `014`, `0o14`). It becomes a **false spec failure** the moment someone extends the oracle, and it will look like an implementation bug.

## Severity

Missed detection — the lowest band — for the behaviour. But the *pin* is a correctness claim about our own coverage, and a confident false premise in a comment propagates further than a bug. Both halves need fixing: the behaviour and the reasoning.

## Constraints

Do not weaken the soundness direction to buy completeness. The 3540-pair sweep asserting zero false positives is the property that matters most — a duplicate reported where Psych keeps two keys is a false advisory that invites deleting working code. The eval swept 3192 additional pairs from tokens outside the corpus and found zero; keep it that way.

## Falsifier

A Psych load where `.inf: 1\n.inf: 2` yields two keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A key whose source text is IDENTICAL to an earlier key in the same mapping is reported, for every one of the 11 tokens currently missed
- [x] #2 Zero false positives is preserved — the existing soundness sweep still passes, and tokens outside the corpus are swept too
- [x] #3 The diagonal is covered by the sweep rather than skipped, so a future UNCOMPARABLE addition cannot silently reintroduce this
- [x] #4 psychCollides no longer distinguishes -0.0 from 0.0, and a signed zero is added to the oracle corpus so the fix is exercised rather than latent
- [x] #5 The comment that reasons about the missed set is corrected, not just the assertion — it currently states a bound it does not establish
- [x] #6 The odd-cased collisions (TrUe/true, oN/on, .inf/.Inf) are either reported or documented as a measured remaining gap with the reason
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The diagonal (AC#1, #3, #5)

`UNCOMPARABLE` tokens now get a RAW source-keyed identity instead of `undefined`.

The argument is that the set's own justification does not apply to the case it was hiding. `UNCOMPARABLE` exists because npm `yaml` and Psych resolve those spellings DIFFERENTLY, so trusting the resolved value risks a false positive against a different spelling. Compared against ITSELF that cannot arise: the same bytes resolve the same way under any one parser, so two byte-identical keys are one key deterministically. All 11 tokens closed — `.inf: 1` twice is one key on the platform with a value discarded, and it was silent.

Prefixed `raw ` so it can never alias a resolved identity. That also means it stays silent exactly where returning `undefined` was silent: `raw 1e3` never matches `number int 1000`, which is correct, because Psych reads `1e3` as the String "1e3" and keeps two keys.

Both sweeps now include the diagonal, and the corpus-size formula is `n * n` rather than `n * (n - 1)` — the old formula excluded the diagonal to match a sweep that excluded it, so the two agreed with each other and neither described the coverage.

## The oracle records the ANSWER, not ingredients (AC#4)

The generator now loads an ACTUAL two-key document per pair in Ruby and emits the measured equivalence class, with a transitivity check that fails the generator rather than emitting a group id that would be a lie.

This removes the whole class of interpretation bug, and both directions of it were real:

- **signed zero** — the old predicate compared `klass` plus `inspect`, so `"-0.0" !== "0.0"`, while a Ruby Hash collapses them (`Float#eql?` is value-based). Latent only because no signed zero was in the corpus. Three are now.
- **NaN** — object identity would have been wrong the OTHER way: two separately-parsed NaN objects are not `eql?`, yet `.nan` twice really does collapse to one key. Every proxy for the measurement disagrees with it somewhere, so there is no longer a proxy.

Corpus 61 -> 75 tokens: signed zeros, odd-cased booleans and floats, and the QUOTED spellings of uncomparable tokens.

## AC#6 — the odd-cased collisions are CLOSED, not documented

The AC permitted documenting them as a gap. Measured Psych's rule instead, and it is simple enough to implement:

```
booleans   case-insensitive over the six whole words: true|false|yes|no|on|off
           so TrUe, tRUE, truE, FaLsE, yEs, nO, oN, oFf are all booleans
y Y n N    STRINGS, despite the 1.1 spec listing them as booleans
floats     .inf / .nan case-insensitive, sign significant
```

Case is folded for the inf/nan family ONLY, and the boundary is measured in both directions: `.inf` + `.Inf` are ONE key so the case is folded; `y` + `Y` are TWO keys so folding them would be a false positive; `-.inf` + `.inf` are two, so the sign survives. Folding uniformly would have looked tidier and been wrong.

The 5476-pair sweep against the measured oracle is what verifies this, which is why implementing was the low-risk option rather than the ambitious one.

## Two mistakes, both caught by the sweep rather than by me

**I introduced a false positive.** `yes:` and `"yes":` were reported as one key, which Psych keeps as two. The cause was a reasoned assumption stated in a comment: "a quoted key's `source` includes its quotes". It does NOT — measured, `source` EXCLUDES the delimiters, so `"yes"` arrives as the bare text `yes`. Fixed with a scalar-TYPE guard, which also repairs a PRE-EXISTING latent case: `".inf"` would have shared an identity with the plain `.inf`, and those are a String and a Float to Psych. The comment that asserted the false premise is corrected, not just the code.

**Three missed pairs surfaced** — `"0X10" + 0X10`, `"1e3" + 1e3`, `"y" + y`. Checked against HEAD before treating them: both forms returned `undefined` there, so the pairs were ALREADY missed and the corpus addition made them visible rather than new. Pinned with the reason instead of absorbed silently. Closing them would mean encoding "Psych resolves this family to the literal String" per family — a bigger change than this task, and the soundness sweep would have to re-earn it.

## Verification

- Full suite **327 files / 3248 tests, exit 0**; `yarn build` clean; `format:check` clean.
- YAML specs 40/40. Soundness: **zero false positives across 5476 ordered pairs**, diagonal included.
- Completeness pinned at FOUR missed pairs, each with a stated reason, against ONE previously — where the one was only true because the sweep skipped the diagonal and the corpus lacked odd-cased spellings.
- **Three sabotages, all bite**: reverting the raw identity fails 1; dropping the quoted-scalar guard fails 3 INCLUDING soundness; dropping Psych's case-insensitive booleans fails 2 INCLUDING soundness. Two of the three failing the soundness sweep is the useful signal — both guards are load-bearing in the expensive direction.

## Reviewed and rejected: switching the global parse to YAML 1.1

Raised in review, measured rather than argued:

| token | 1.2 (today) | 1.1 | Psych |
|---|---|---|---|
| `yes` `no` `on` `off` | string ✗ | boolean ✓ | boolean |
| `014` | 14 ✗ | 12 ✓ | 12 |
| `y` `Y` `n` `N` | string ✓ | boolean ✗ | string |
| `TrUe` | string ✗ | string ✗ | boolean |
| `1e3` | 1000 ✗ | 1000 ✗ | `"1e3"` |
| `1:30` | `"1:30"` ✗ | 90 ✗ | 5400 |

It fixes five tokens and BREAKS four: `y`/`n` are correct at 1.2 and wrong at 1.1. Net 11 mismatches to 9 — a partial improvement, not a fix. `1:30` proves no option can work, since both parsers produce a number and disagree about which.

Also measured: `schema: 'yaml-1.1'` and `compat: 'yaml-1.1'` add NOTHING over `version: '1.1'` — all three configurations are byte-identical, because `version` already selects the schema. And no option touches the LEXER, so none of them would have fixed the false blocks in TASK-43 or TASK-50.

The complementary idea from the same review — warn on ambiguous plain scalars so authors remove them — is filed as **TASK-55** with these tables recorded.

## Docs

Gotchas §2 gained the two traps in the TEST METHOD, which are the transferable part: `.nan` twice is one key while two NaN objects are not `eql?` (so object identity is not a safe proxy), and a parser's "source text" may exclude the quotes (so the scalar's type is the only reliable discriminator). The closing advice now says to compare by what the platform does with a document containing both keys — never by source text, never by your own parser, and never by a proxy for Ruby's equality.
<!-- SECTION:NOTES:END -->
