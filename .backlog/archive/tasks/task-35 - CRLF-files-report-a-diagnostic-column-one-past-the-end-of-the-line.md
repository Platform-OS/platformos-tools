---
id: TASK-35
title: CRLF files report a diagnostic column one past the end of the line
status: Done
assignee: []
created_date: '2026-08-02 07:10'
updated_date: '2026-08-02 08:31'
labels:
  - check-common
  - positions
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - packages/platformos-check-common/src/utils/position.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

In a file with CRLF line endings, any diagnostic whose offset lands on the line terminator reports a column one past the last character the line actually has. Measured drift is a constant +1, independent of how many lines precede.

| Fixture | LF column | CRLF column | line length | max valid |
|---|---|---|---|---|
| unclosed flow sequence (YAMLSyntaxError) | 9 | 10 | 8 | 9 |
| unclosed output (LiquidHTMLSyntaxError) | 6 | 7 | 5 | 6 |
| unclosed if tag (LiquidHTMLSyntaxError) | 9 | 10 | 8 | 9 |

## Scope

NOT YAML-specific and not introduced by the recent YAML work. It reproduces on `LiquidHTMLSyntaxError`, the oldest blocking check, so it predates the round-3 and round-4 changes. Three evaluation rounds tested CRLF and missed it because every fixture used a mid-line diagnostic, and mid-line spans are unaffected (verified: `UnknownFilter` and `MissingPartial` are byte-identical under both endings).

## Cause (read, not instrumented)

`packages/platformos-check-common/src/utils/position.ts:4-12`. `getPosition` runs `line-column` over the raw source, in which the carriage return is a member of the preceding line. An offset pointing at the newline of a CRLF pair therefore yields a column one past the visible end of the line.

The offset clamp in `yaml/parse.ts` is correct and is not the cause; the drift enters at the offset-to-column conversion.

## Impact

No false block and no false approval. The verdicts are right; the caret points at a column that does not exist. It matters to an agent applying a positional edit, and to anyone comparing our positions against the CLI.

## Known limit of the report

Two checks were confirmed affected and three cleared. Nobody enumerated which of the 39 checks can emit a diagnostic whose offset lands on a terminator, so "two affected" is a lower bound, not a count. Establishing that set is part of this task.

## Falsifier

A terminator-landing diagnostic in a CRLF file whose reported column is already within the line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A diagnostic whose offset lands on a line terminator in a CRLF file reports a column no greater than the visible line length plus one
- [x] #2 The paired LF and CRLF forms of the same fixture report identical line and column, for both a terminator-landing and a mid-line diagnostic
- [x] #3 The blast radius is enumerated rather than sampled: the set of checks that can emit a terminator-landing offset is established, so the fix is known to cover them all
- [x] #4 Mid-line diagnostics are unchanged under both line endings, proven by a regression case rather than by inspection
- [x] #5 A CRLF case is added at the supervisor level too, so the wire-facing line and column are pinned and not only the check-common helper
- [x] #6 getPosition keeps its existing contract exactly: 0-based line, 0-based character in UTF-16 code units, so the LSP continues to consume Offense positions raw and the supervisor keeps its single +1 conversion
- [x] #7 The language-server test suite passes unchanged, and a CRLF diagnostic range is asserted at the LSP layer so the shared helper is pinned from both consumers rather than only from the supervisor
- [x] #8 The end-of-input case is fixed alongside: an offset equal to source.length reports one past the last character instead of collapsing onto it, since yaml/parse.ts deliberately produces such offsets
- [x] #9 No position other than terminator-landing and end-of-input ones changes value, demonstrated by running the existing offense position pins before and after
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SHARED-CONSUMER CONSTRAINT (verified 2026-08-02). getPosition is NOT supervisor-private. It is called once, in check-common/src/index.ts:246-247, to build Offense.start and Offense.end, and that Offense feeds two surfaces with different conventions:

  check-common getPosition   -> lineColumn(source, {origin: 0})  -> 0-based line, 0-based character
    -> LSP:        offenseToDiagnostic (language-server-common/src/diagnostics/offenseToDiagnostic.ts:34-45)
                   copies line and character STRAIGHT into an LSP Range. No conversion.
    -> supervisor: lint-batch.ts:112-122 adds +1 to both, and is documented as the ONLY
                   place that conversion happens.

So the contract getPosition must keep is the LSP one: 0-based line, 0-based character counted in UTF-16 code units. Any fix that shifts line or character numbering generally, or that moves the origin, breaks VS Code diagnostics, and would silently double-shift through the supervisor's +1.

WHAT line-column ACTUALLY DOES, measured rather than read:

  LF    '{{ x \n{{ y'    offset 5 = \n            -> line 0, col 5
  CRLF  '{{ x \r\n{{ y'  offset 5 = \r -> 0,5    offset 6 = \n -> line 0, col 6

The carriage return is counted as an ordinary character of the preceding line. Only offsets AT or AFTER the \r on that line drift, which in practice is the \r and the \n themselves, since the next line restarts at 0. That is why mid-line diagnostics are unaffected and three rounds of CRLF testing missed it.

WHY THE LSP DOES NOT VISIBLY SUFFER TODAY, and why that is not a reason to leave it: the LSP specification says a character value greater than the line length defaults back to the line length, and a \r\n pair is a line terminator so the \r is not part of the line content. VS Code therefore clamps the out-of-range character and renders the caret correctly by accident. The supervisor has no such clamp, so it emits a 1-based column the line does not have.

That also settles the direction of the fix: excluding \r from the column count moves check-common TOWARD the LSP specification, not away from it. The LSP-visible change should be nil (clamped either way) and the supervisor-visible change should be exactly the terminator-landing columns.

SECOND DEFECT IN THE SAME EIGHT-LINE FUNCTION, found while reading it and worth fixing in the same change since anyone touching this will meet it: getPosition clamps with Math.min(index, source.length - 1). An index equal to source.length -- end of input -- is therefore reported as the position of the LAST character rather than one past it. yaml/parse.ts explicitly produces such offsets and documents that yaml points one past the last character for an unterminated construct on the final line. So an end-of-file position is already collapsed by one, on BOTH surfaces, independently of line endings.

IMPLEMENTED 2026-08-02. `getPosition` was rewritten to reproduce the LSP document model exactly, rather than patched at the CRLF case.

WHY A REWRITE AND NOT A PATCH. Measuring `TextDocument.positionAt` — the implementation VS Code and the language server actually use — showed the previous mapping diverged from it in more than one way, and the CRLF column was only the visible one:

  LF    '{{ x \n{{ y'    offset 5 (\n)   line-column 0,5   LSP 0,5   agreed
  CRLF  '{{ x \r\n{{ y'  offset 6 (\n)   line-column 0,6   LSP 0,5   DIVERGED
  'abc\n'                offset 4 (EOF)  line-column n/a   LSP 1,0   DIVERGED
  ''                     offset 0        line-column null  LSP 0,0   DIVERGED

So the invariant worth holding is not "columns look sensible" but "we agree with the LSP at every offset", and that is what `position.spec.ts` asserts — against the real `vscode-languageserver-textdocument` (added as a devDependency), over every offset of 17 source shapes. Pinning it against hand-written expectations would only have pinned my reading of the specification.

THREE DEFECTS FIXED, not one:

  1. CRLF terminator columns, the reported defect.
  2. End of input. `fromIndex` returns null past the last character and the old code clamped the lookup to `length - 1`, so an offset of exactly `source.length` landed ON the last character. `yaml` reports `[length, length + 1]` for EVERY unterminated construct, so this misplaced a whole class of parse errors, and an empty source came back as `line: -1, character: -1`.
  3. UNDER-HIGHLIGHTING IN THE EDITOR, found by a failing language-server test rather than predicted. An offense whose exclusive END offset was end-of-input had its range truncated by one character: `runChecks.spec.ts` expected `hi: salut` to highlight as `hi: salu`. Any diagnostic ending at end of input was one character short in VS Code.

Lone `\r` is now a line terminator too, because the LSP treats it as one — a classic-Mac file was one long line to us and many lines to the editor rendering our diagnostics.

DIFFERENTIAL, old implementation against new, every offset of 15 source shapes. Disagreements fall into exactly four classes and nothing else: inside a CRLF pair (11), end of input (14), lines after a lone CR renumbering (5), empty source (1). Zero unaccounted-for changes.

PERFORMANCE — the reason this is also relevant to TASK-38. The old implementation rebuilt a `line-column` index on EVERY call, and `report()` calls it twice per offense. Worst-case buffer (128 KiB, 4 229 offenses, 8 458 lookups):

  old   3 664.7 ms
  new       9.4 ms      389x

A single-entry memo keyed on string identity makes the repeat case a pointer comparison. That is ~3.6 s of the ~8.8 s round 4 measured for a single 128 KiB buffer, so the throughput regression in TASK-38 should be re-measured before it is attributed.

SABOTAGE-VERIFIED, four separate mutations, each reverted after measuring: removing the terminator walk-back (7 unit failures), restoring the `length - 1` clamp (18), treating a lone CR as ordinary (9), not consuming the `\r\n` pair (8). Reverting `position.ts` wholesale fails 4 of 5 new supervisor cases and 3 of 3 new LSP cases. The fifth supervisor case is the mid-line control and must NOT fail — it is what proves nothing else moved.

The first version of the bounds test did NOT bite under sabotage: its fixture put the diagnostic mid-line, where no overrun is possible. Replaced with three sources that each land on a terminator; it now fails under sabotage.

VERIFIED: 314 test files / 3 074 tests pass (was 312 / 3 040 — two new spec files), type-check 0 errors, prettier clean, `yarn install --frozen-lockfile` clean.

NOT DONE, deliberately: `liquid-html-parser/src/errors.ts` has the same `Math.min(index, length - 1)` clamp. It feeds `getOffset`, which is the parser's 1-based convention and self-consistent with it; changing one without the other would break the round trip in `LiquidHTMLSyntaxError`. Out of scope here and not currently producing a wrong result.
<!-- SECTION:NOTES:END -->
