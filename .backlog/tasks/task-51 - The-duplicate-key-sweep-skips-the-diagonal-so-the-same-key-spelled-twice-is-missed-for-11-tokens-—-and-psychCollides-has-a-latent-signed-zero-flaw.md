---
id: TASK-51
title: >-
  The duplicate-key sweep skips the diagonal, so the same key spelled twice is
  missed for 11 tokens — and psychCollides has a latent signed-zero flaw
status: To Do
assignee: []
created_date: '2026-08-03 11:14'
labels:
  - check-common
  - yaml
  - missed-detection
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-check-common/src/yaml/duplicate-keys.spec.ts
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
- [ ] #1 A key whose source text is IDENTICAL to an earlier key in the same mapping is reported, for every one of the 11 tokens currently missed
- [ ] #2 Zero false positives is preserved — the existing soundness sweep still passes, and tokens outside the corpus are swept too
- [ ] #3 The diagonal is covered by the sweep rather than skipped, so a future UNCOMPARABLE addition cannot silently reintroduce this
- [ ] #4 psychCollides no longer distinguishes -0.0 from 0.0, and a signed zero is added to the oracle corpus so the fix is exercised rather than latent
- [ ] #5 The comment that reasons about the missed set is corrected, not just the assertion — it currently states a bound it does not establish
- [ ] #6 The odd-cased collisions (TrUe/true, oN/on, .inf/.Inf) are either reported or documented as a measured remaining gap with the reason
<!-- AC:END -->
