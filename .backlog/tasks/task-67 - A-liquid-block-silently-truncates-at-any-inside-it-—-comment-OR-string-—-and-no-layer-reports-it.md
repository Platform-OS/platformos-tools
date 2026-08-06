---
id: TASK-67
title: >-
  A {% liquid %} block silently truncates at any %% } inside it — comment OR
  string — and no layer reports it
status: To Do
assignee: []
created_date: '2026-08-06 15:22'
labels:
  - check
  - measurement
  - liquid-parser
  - silent-failure
dependencies: []
references:
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-node/scripts/generate-factory-configs.js
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
priority: high
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

Inside `{% liquid %}`, the lexer scans for the closing `%}` with no awareness of comments or quoting. The first `%}` ends the block. Everything after it — the rest of the block's statements — is re-interpreted as template TEXT and emitted into the response body.

Nothing raises. `liquid_exec` returns `ok: true, error: null`; the page returns 200.

## Measured on `/api/app_builder/liquid_exec`

```
A. {% liquid\n  # a comment mentioning %} the closing sequence\n  assign doubled = 21 | times: 2\n%}RESULT=[{{ doubled }}]
   -> " the closing sequence\n  assign doubled = 21 | times: 2\n%}RESULT=[]"

B. CONTROL, same without the %} in the comment
   -> "RESULT=[42]"

C. %} in a TRAILING comment, nothing after it in the block
   -> " comment\n%}RESULT=[42]"

D. %} inside a STRING LITERAL, no comment involved
   {% liquid\n  assign s = "a %} b"\n  assign doubled = 21 | times: 2\n%}RESULT=[{{ doubled }}]
   -> " b\"\n  assign doubled = 21 | times: 2\n%}RESULT=[|]"

E. {% comment %} mentions %} here {% endcomment %}  -> "RESULT=[ok]"   (block comment tag is NOT affected)
F. {% # mentions %} here %}                        -> " here %}RESULT=[ok]" (inline comment tag IS affected)
```

**The originating report framed this as a `#` comment problem. Row D shows that is wrong** — a `%}` inside a string literal truncates identically, with no comment anywhere. A rule written as "a `#` comment line containing `%}`" would miss it, and building a tag delimiter in a string is a plausible thing for an author to do. Row E bounds it: `{% comment %}` outside a liquid block handles `%}` correctly, so this is specific to the `{% liquid %}` line lexer.

## Our parser AGREES with the platform

`toLiquidHtmlAST` truncates at exactly the same offset for A, C and D. There is no parser/platform divergence and no false approval in the parser — the AST is a faithful record of what the platform will do. **This is purely a missing check**, which is why the fix is a check and not a grammar change.

## The detection gap

Nothing reports the truncation itself:

- `pos-cli check run` on the page fixture emits an incidental `UndefinedObject` warning, because the variable that the truncated `assign` never set is later output. Delete the output and it is silent. On the `lib/` function fixture it reports nothing at all.
- The supervisor answers `status: ok`, `must_fix_before_write: false`.
- The runtime renders 200.

The originating report claimed pos-cli says "No offenses found"; that is not reproducible as stated, but the substance holds — every signal available today names the wrong construct.

## Why it is expensive out of proportion to its rarity

In a `lib/` partial the truncation usually swallows the `return`, and the runtime then raises **"function must return a value"** — pointing at a `return` statement that is present and correct. The symptom names a construct three lines below the cause, so the search starts in the wrong place.

Secondary: the truncation emits server-side template source into the response body, which is an information-disclosure smell independent of correctness.

## Severity: report, do not block

`blocksWrite` requires severity `error` AND membership of `BLOCKING_CHECKS`, and this repo's rule is that blocking is for what the platform genuinely rejects. It does not reject this — it renders 200. So `error` severity, NOT in `BLOCKING_CHECKS`.

## Upstream

A linter rule is a mitigation, not the fix. The parser bug belongs upstream: the `{% liquid %}` line lexer should respect quoting and `#` comments when locating the closing delimiter. File separately.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The check reports all three measured truncation shapes: %% } inside a # comment, inside a TRAILING # comment, and inside a string literal — not only the comment case the original report described
- [ ] #2 The check stays silent on the measured controls: a # comment with no %% }, a well-formed multi-line block, a one-line block, and a %% } that legitimately sits inside another Liquid construct such as {{ '%%}' }}
- [ ] #3 False-positive rate is MEASURED on a real-world corpus of thousands of .liquid files and reported in the test file, not asserted
- [ ] #4 The offense points at the {% liquid %} block whose delimiter terminated early, not at the stranded %% } or at a downstream symptom, because naming the wrong construct is the defect's main cost
- [ ] #5 Registered in src/checks/index.ts AND the factory configs regenerated, so all.yml / recommended.yml list it
- [ ] #6 Severity error, NOT added to BLOCKING_CHECKS: the platform renders the file 200 OK, so it must not gate a write. A test pins that it reports without blocking
- [ ] #7 Reaches all three consumers, verified end to end rather than assumed: pos-cli check run, the MCP supervisor's validate_code, and the language server's diagnostics
- [ ] #8 transport/instructions.ts updated in the same change if what the supervisor reports changes, since its claims are pinned by validate-code.spec.ts
- [ ] #9 Sabotage pass: neutering the detector fails the fire tests, and widening it fails the silence tests
<!-- AC:END -->
