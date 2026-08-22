---
'@platformos/platformos-common': patch
'@platformos/platformos-check-common': patch
---

Report `method: POST` in a page's frontmatter, which is a deploy rejection the linter
accepted.

```liquid
---
slug: probe
method: POST
---
```

Measured: the converter REJECTS this — `Request method 'POST' is not allowed. Valid methods:
delete, get, patch, post, put, options` — while `method: post` is accepted. A rejection fails
the whole changeset. `validate_code` answered `status: ok`.

The enum comparison lowercased both sides for every field, so a valid method in the wrong
case matched. The platform does not: `page.rb` validates `request_method` with an
`inclusion:` over a lowercase list, and the converter never downcases.

Casing is now a per-field property (`caseSensitiveEnum` on `FrontmatterFieldSchema`) rather
than a property of the comparison, because the fields genuinely differ. `Page.method` is
case-sensitive. ApiCall's `request_type` deliberately stays lenient: it is validated for
PRESENCE only, with no inclusion check anywhere in the platform, so there is no rejection to
mirror and tightening it would invent a false block. Both directions are pinned, each with a
control proving the field is still checked and only its case is forgiven.

Found by this change: the supervisor's deliberately-broken sweep project contains a page
named `bad_method.html.liquid` carrying `method: GET`, authored to be caught, which nothing
had ever reported.
