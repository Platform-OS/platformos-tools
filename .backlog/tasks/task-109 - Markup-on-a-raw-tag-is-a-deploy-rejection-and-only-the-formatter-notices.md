---
id: TASK-109
title: Markup on a raw tag is a deploy rejection and only the formatter notices
status: To Do
assignee: []
created_date: '2026-09-07 06:46'
labels:
  - check-common
  - liquid-html-parser
  - prettier-plugin-liquid
  - false-approval
  - measured
dependencies: []
priority: low
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while surveying TASK-105. Split out because the fix CANNOT live in the same layer.

`raw` takes no markup. The deploy refuses it:

```
views/partials/zz_p_raw_markup.liquid: Body syntax is invalid
  (Liquid syntax error: Syntax Error in 'raw' - Valid syntax: raw)
```

Measured against `pos-cli deploy --dry-run` on a live instance and reproduced against `liquid` 5.11.0 locally. `platformos-check` reports nothing.

**Why it is not part of TASK-105.** That task makes the parser raise for `comment`/`raw`/`doc` blocks that never close. The obvious next step — raise for `raw` with markup too — would break a deliberate, tested behaviour: `packages/prettier-plugin-liquid/src/test/liquid-tag-no-argument/` exists to assert that the printer REWRITES `{% raw what %}{% endraw %}` into `{% raw %}{% endraw %}`. That autofix happens to repair a genuine deploy rejection, and it needs the parser to keep reading the construct. A parser that throws takes the repair away.

So this belongs in check-common, near `InvalidTagSyntax`. Note that `InvalidTagSyntax` currently exempts `RAW_CONTENT_TAGS = ['comment','raw','doc']` (`grammar.ts:107`) for a good reason — an empty markup string is CORRECT for a closed raw tag — so this needs a rule that distinguishes "no markup, as expected" from "markup the platform refuses", not a hole punched in that exemption.

Low: prettier already repairs it for anyone who formats, and `{% raw what %}` is an odd thing to write. It is filed because a project that never runs the formatter still gets a rejected changeset with nothing pointing at the cause.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `{% raw markup %}` is reported by a check, in both the `{% %}` form and the `{% liquid %}` body form
- [ ] #2 The PARSER stays tolerant of it — `prettier-plugin-liquid/src/test/liquid-tag-no-argument/` asserts the printer strips the argument, and a printer cannot repair what the parser refuses to read
- [ ] #3 CONTROL: `{% comment junk %}…{% endcomment %}` is NOT reported — markup on `comment` is legal on the platform, markup on `raw` is not
- [ ] #4 The `liquid-tag-no-argument` fixture still round-trips
<!-- AC:END -->
