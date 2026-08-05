---
id: TASK-57
title: >-
  {% ensure %} inside {% try %} is a FALSE BLOCK — an undocumented sub-tag the
  platform renders
status: To Do
assignee: []
created_date: '2026-08-03 18:48'
updated_date: '2026-08-04 12:48'
labels:
  - check-common
  - liquid-html-parser
  - false-block
  - eval-final
dependencies: []
references:
  - >-
    /home/ecgtheow/Work/desksnearme-release-candidate/app/lib/liquify/tags/try_tag.rb
  - packages/liquid-html-parser/src/stage-2-ast.ts
priority: high
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`{% try %}a{% ensure %}c{% endtry %}` renders `ac` on the platform. Our tooling reports
`Unknown tag 'ensure'` — an ERROR from `LiquidHTMLSyntaxError`, which the MCP supervisor
treats as BLOCKING, so the agent cannot write it at all.

Measured both ways, on `/api/app_builder/liquid_exec`:

```
{% try %}a{% catch e %}b{% endtry %}          -> "a"          (control, already accepted by us)
{% try %}a{% ensure %}c{% endtry %}           -> "ac"         WE BLOCK THIS
{% try %}a{% catch e %}b{% ensure %}c{% endtry %} -> "ac"     WE BLOCK THIS
{% ensure %}                                  -> Unknown tag 'ensure'   (genuinely unknown alone)
{% definitely_not_a_tag_zzz %}                -> Unknown tag           (probe control)
```

And in our checker, `LiquidHTMLSyntaxError` on all three positions — HTML context and
inside `{% liquid %}`:

```
{% try %}a{% ensure %}c{% endtry %}                    -> Unknown tag 'ensure'
{% try %}a{% catch e %}b{% ensure %}c{% endtry %}      -> Unknown tag 'ensure'
{% liquid try / echo 'a' / ensure / echo 'c' / endtry %} -> Unknown tag 'ensure'
```

## Where it comes from

`Liquify::Tags::TryTag#unknown_tag` handles exactly two sub-tags:

```ruby
def unknown_tag(tag, markup, tokens)
  if tag == 'catch'
    ...
    @catch_block = new_body
  elsif tag == 'ensure'
    @ensure_block = new_body
  else
    super
  end
end
```

So `ensure` is a real sub-tag, taking **no markup**, and `nodelist` renders
`[@try_block, @catch_block, @ensure_block].compact`. It is absent from the tag's own
`@syntax` annotation, which is why `data/tags.json` never carried it.

This is a THIRD population, distinct from both earlier findings:

- TASK-44 — a tag we carry that the platform lacks (`layout`), found by probing.
- TASK-56 — tags the platform `register_tag`s that we lacked, found from the registry.
- This — a sub-tag registered NOWHERE, reachable only through a block's `unknown_tag`
  hook. Neither method could have found it; it turned up while reading `try_tag.rb` to
  settle whether `try_rc` is an alias.

Worth a sweep of its own: every `unknown_tag` override in `Liquify::Tags::*` is a
potential sub-tag our vocabulary does not know.

## Why it was NOT fixed alongside TASK-56

Deliberate, so the two changes stay separately reviewable. The cheap fix — adding
`'ensure'` to the hand-verified list in `undocumented-tags.ts` — stops the block but
models it wrong: it would parse as a flat `LiquidTag` sibling inside the try body rather
than as a BRANCH, and it would then be accepted ANYWHERE, including outside `try`, where
the platform genuinely answers `Unknown tag 'ensure'`. That trades a false block for a
false approval.

`catch` is the model to follow, and it is a five-layer change: grammar rule,
`NamedTags`, `ConcreteLiquidTagEnsure`, `LiquidBranchEnsure`,
`isConcreteLiquidBranchDisguisedAsTag`, the stage-2 case, and the printer. `ensure` takes
no markup, so `liquidTagRule<"ensure", empty>` is the shape — closer to `else` than to
`catch`, which takes an optional variable.

## The printer is the risk

The printer REGENERATES source from the AST. `{% ensure %}` currently survives formatting
only because it is an unknown tag whose markup is a raw string, which the printer emits
verbatim. The moment the grammar parses it, the printer must know how to print it — so a
round-trip fixture is required, not optional.

## Falsifier

A platformOS instance that answers `Unknown tag 'ensure'` for
`{% try %}a{% ensure %}c{% endtry %}`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 {% try %}…{% ensure %}…{% endtry %} is not reported and does not block, in HTML context and inside {% liquid %}, with and without a {% catch %} branch
- [ ] #2 {% ensure %} OUTSIDE a try block is STILL reported, so the false block is not traded for a false approval — the platform answers Unknown tag for it
- [ ] #3 ensure is modelled as a BRANCH like catch, not as a flat sibling tag, so the try body splits correctly for AST consumers
- [ ] #4 A prettier round-trip fixture proves the printer does not destroy or reorder the ensure branch, since a newly-parsed construct is a newly-printable one
- [ ] #5 Every unknown_tag override in Liquify::Tags::* is swept for other sub-tags our vocabulary lacks, and the result is recorded — this defect class is invisible to both the probe sweep and the register_tag registry
- [ ] #6 The three distinct discovery methods (probe, registry, unknown_tag hook) are documented together so the next vocabulary question starts from the right one
<!-- AC:END -->
