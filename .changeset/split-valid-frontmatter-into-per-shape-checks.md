---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
'@platformos/platformos-mcp-supervisor': minor
---

Split `ValidFrontmatter` into five per-shape checks, so the frontmatter mistakes that reject
a deploy can block a write.

**Migration:** `ValidFrontmatter` no longer exists. A `.platformos-check.yml` naming it must
name the replacements instead:

| Was `ValidFrontmatter` | Now | Severity |
|---|---|---|
| an unrecognised key | `UnknownFrontmatterField` | error |
| a value outside the accepted set, and `layout: false` | `InvalidFrontmatterValue` | error |
| a `layout:` naming a layout that does not exist | `MissingLayout` | error |
| an authorization policy or notification that does not exist | `MissingFrontmatterAssociation` | warning |
| a superseded key, and the deprecated `home.liquid` filename | `DeprecatedFrontmatterField` | warning |

**Why.** One code reported seven distinct rules at `Severity.WARNING`. Six of them are
converter rejections measured against a live instance with `pos-cli deploy --dry-run`, and a
rejection fails the ENTIRE changeset rather than the offending file — so `validate_code`
answered `must_fix_before_write: false` for files that could not deploy. The supervisor's gate
reads a check CODE, so it could not admit the fatal shapes without also admitting the
advisory ones.

The three fatal codes are now in the supervisor's `BLOCKING_CHECKS`, each with the converter
error that justifies it. The two advisory codes are deliberately absent, for different
reasons that are recorded separately: a deprecated key and a `home.liquid` page are MEASURED
to deploy cleanly, while a missing association is UNMEASURED — `--dry-run` accepts it, but
`base_converter.rb` returns before `bulk_write_associations_from_snapshot!`, which is what
raises for a name it cannot resolve, so the dry run's silence is a gap in the oracle rather
than evidence. The gate does not block on its own uncertainty.

This is the discriminator TASK-26 was waiting for. Its recorded blocker — that blocking the
code would fix two false approvals and create one false block — rested on two wrong facts:
there were seven reachable shapes rather than three, and `layout: false`, named there as the
harmless one, is itself a converter rejection (`undefined method 'sub' for false`, because
YAML reads it as the boolean and `page_converter.rb`'s `set_layout` guards `nil` rather than
`false`). Its diagnostic said the opposite — "falls back to the default layout" — and now
says the deploy is rejected. The `layout: ''` suggestion is unchanged and still correct.

All five checks share one parsed block through a new memoised extractor. Measured, because
five checks re-parsing one block looked cheap and is not: `parseDocument` costs ~80 µs on a
representative block, so the four redundant parses would have cost ~640 ms over a 2 000-page
project.

The dead `Missing required frontmatter field` rule is removed rather than carried across: no
schema sets `required: true`, so it could not fire, and a check code that can never report
would need a permanent exemption from the supervisor's "every blocking check can actually
block" fixtures.

All five codes need a documentation page under
`app/views/pages/developer-guide/platformos-check/checks/` in `platformos-documentation`, plus
their overview rows and nav entries; `valid-frontmatter`'s page is retired.
