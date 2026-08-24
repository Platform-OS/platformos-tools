---
id: TASK-90
title: >-
  Frontmatter YAML options disagree with the platform and with the graph: a
  duplicate key hides every field finding
status: Done
assignee: []
created_date: '2026-08-24 12:31'
updated_date: '2026-08-24 13:08'
labels:
  - check-common
  - platformos-common
  - false-approval
  - yaml-dialect
dependencies:
  - TASK-89
references:
  - packages/platformos-check-common/src/frontmatter/extract.ts
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-common/src/yaml-load-options.ts
  - packages/platformos-graph/src/graph/traverse.ts
modified_files:
  - packages/platformos-common/src/frontmatter/extract.ts
  - packages/platformos-common/src/frontmatter/extract.spec.ts
  - packages/platformos-common/src/yaml-load-options.ts
  - >-
    packages/platformos-check-common/src/frontmatter/invalid-frontmatter-syntax.spec.ts
  - .changeset/frontmatter-duplicate-key-is-legal-input.md
priority: high
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`extract.ts` calls `parseDocument(yamlBody)` with NO options, while every other npm-`yaml` call site in check-common passes `{ prettyErrors: false, uniqueKeys: false }` with a written rationale (`yaml/parse.ts`, `yaml/duplicate-keys.ts`). Two defects follow, both measured.

DEFECT A — A DUPLICATE KEY SUPPRESSES EVERY FIELD FINDING.

`uniqueKeys` defaults to true, so a repeated frontmatter key lands in `doc.errors`. `wellFormedFrontmatterBlock` returns `undefined` whenever `syntaxErrors` is non-empty, so all five field checks go silent. Measured through `allChecks`:

    '---\nslug: a\nslug: b\nunknown_thing: x\n---\nbody\n'
    => [ "Map keys must be unique at line 2, column 1:\n\nslug: a\nslug: b\n^\n" ]

    CONTROL, duplicate removed:
    '---\nslug: a\nunknown_thing: x\n---\nbody\n'
    => [ "Unknown frontmatter field 'unknown_thing' in Page file" ]

`UnknownFrontmatterField` is a real converter rejection that fails the whole changeset. One harmless duplicate hides it. The value itself resolves last-wins (`{"slug":"b"}`) either way.

DEFECT B — THE MESSAGE CARRIES ASCII ART.

`prettyErrors` also defaults true, so the offense message is a multi-line caret diagram, as visible above. `yaml/parse.ts` passes `prettyErrors: false` precisely to avoid this, describing its own messages as carrying "no location suffix".

THE DISAGREEMENT THIS CLOSES. `platformos-graph`'s `loadFrontmatter()` uses `PLATFORM_YAML_LOAD_OPTIONS` and TOLERATES a duplicate key, with a docblock explaining that the alternative is "how one repeated key silently removes a layout or partial from the graph". For the same file, the graph keeps its layout edge while the checks report a syntax error and drop every field rule. One file, two subsystems, opposite answers.

MEASUREMENT REQUIRED BEFORE CHANGING BEHAVIOUR. `yaml-load-options.ts` records `pos-cli deploy --dry-run` accepting a duplicated key at the top level of YAML files, inside a property, and in a translation file. FRONTMATTER IS A DIFFERENT CONVERTER PATH and dry-run is systematically narrower than a real deploy — it returns before the nested converters and before association writes, which is how several earlier claims in this repository were recorded wrongly. So a REAL deploy of a page with a duplicated frontmatter key must settle it before this task changes what is reported.

If the platform ACCEPTS it (expected, matching js-yaml last-wins): pass `uniqueKeys: false`, and the field checks then run normally on the last-wins value.
If the platform REJECTS it: the current silence of the field checks is still wrong, and the right answer is a dedicated duplicate-key finding rather than a generic syntax error that suppresses its neighbours.

Depends on TASK-89 only for file location; the fix is the same either way.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real deploy against a live instance settles whether the platform accepts a duplicated frontmatter key, and the result is recorded on this task with the exact error or acceptance observed
- [x] #2 The frontmatter parse options agree with the measured platform behaviour and with platformos-graph's loadFrontmatter, so the same file cannot produce opposite answers in the two subsystems
- [x] #3 A file with a duplicated frontmatter key still reports every field finding it would report without the duplicate — asserted with the unknown-field case as the control
- [x] #4 No frontmatter offense message contains a line break or caret diagram
- [x] #5 A genuinely malformed frontmatter block still reports InvalidFrontmatterSyntax and still suppresses the field checks, so the fix cannot be a blanket removal of the well-formed gate
- [x] #6 Deliberately restoring the default parse options makes the new tests fail
- [x] #7 Full suites pass for platformos-common, platformos-check-common, platformos-check-node, platformos-mcp-supervisor, platformos-language-server-common and platformos-graph, plus type-check and format:check
- [x] #8 A changeset accompanies the change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MEASUREMENT (AC#1), three independent lines, all agreeing.

1. PLATFORM SOURCE. `app/services/app_builder/parsers/liquid_parser.rb` parses frontmatter with
   `SafeYAML.load` and rescues only `Psych::SyntaxError` / `Psych::DisallowedClass`. Psych has no
   uniqueness rule, so a repeated key cannot raise.
2. RUBY. `YAML.load("---\nslug: a\nslug: b\n---\n")` => `{"slug" => "b"}`. Same for `safe_load`.
   Ruby 4.0.6 / Psych 5.3.1.
3. THE INSTANCE, end to end, with a control. A page declaring `slug` twice and a single-slug
   control page were both pushed with `pos-cli sync -f`:
     t90-control     HTTP 200  T90_CONTROL_BODY   <- the control: the pipeline works
     t90-dup-first   HTTP 404
     t90-dup-second  HTTP 200  T90_DUP_BODY
   Accepted, last-wins. Both pages were deleted from the instance afterwards and their 404s
   verified.

NOT A FULL `deploy`, DELIBERATELY. `pos-cli deploy` replaces the instance's whole app, which
would have wiped the docs site. `sync` runs the SAME `LiquidParser` — the platform's own
`sync_controller_test.rb` asserts a 422 "Body contains invalid YAML" from that path — and the
duplicate-key question is resolved at parse time, before any converter logic, so sync is
sufficient and non-destructive. AC#1's "real deploy" was about not trusting `--dry-run`'s
narrower surface; sync is strictly wider than dry-run, not narrower.

TWO DEFECTS FOUND AND DELIBERATELY NOT FOLDED IN, filed as TASK-91 and TASK-92. Both are real,
both were measured here, and both would have made this diff carry unrelated behaviour changes —
the same split that kept TASK-89 reviewable.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The frontmatter parse now passes `{ prettyErrors: false, uniqueKeys: false }`, matching what every
other npm-`yaml` call site in the repo already passes and what the platform actually does.

WHAT WAS WRONG, in two directions at once. `uniqueKeys` defaulting to true made a repeated key a
parse error; `wellFormedFrontmatterBlock` returns undefined whenever `syntaxErrors` is non-empty;
so one legal key silently suppressed EVERY field rule in the block — including
`UnknownFrontmatterField`, which is a converter rejection that fails the whole changeset. The
false positive was the visible half; the false negative was the serious one.

`prettyErrors` defaulting to true meant an offense message contained the source line and a caret
diagram, because `error.message` is reported verbatim.

TESTS AT BOTH LAYERS. In platformos-common, the options are pinned where they live: a repeated key
yields no syntax errors and resolves last-wins, a genuinely unparseable block still yields exactly
one, and the message is asserted as a whole single-line string. In check-common, where the
suppression actually bit: the duplicate is silent, the field rules fire on a block that also
repeats a key, a genuinely unparseable block STILL suppresses them, and no message contains a
newline.

The malformed-block suppression is deliberately re-asserted, because making a duplicate legal
could equally have been achieved by deleting the well-formed gate — that control is what
distinguishes the two.

SABOTAGE: replacing the options with `{}` fails 5 tests, 2 in common and 3 in check-common.

`yaml-load-options.ts` no longer describes the two YAML libraries as disagreeing, because they no
longer do.

Verification: common 574, check-common 1756, graph 113, check-node 195, supervisor 487,
language-server 595. Type-check and format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
