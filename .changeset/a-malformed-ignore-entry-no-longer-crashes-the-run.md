---
'@platformos/platformos-check-common': patch
---

Skip a malformed `ignore` entry instead of throwing out of the whole run

A bare `-` in an `ignore` list is `null` once YAML has read it, and nothing checked the elements:
both the top-level list and a check's own are typed `string[]` over data that came from a file.
The `null` reached `.startsWith` while patterns were being rewritten and took the entire run with
it — measured, `check()` on a real project raised
`TypeError: Cannot read properties of null (reading 'startsWith')`.

A non-string entry is now skipped where a blank one already was, so the sound patterns beside it
still apply. Measured on the same project: a config carrying `- ` above `modules/vendor/**` now
reports exactly what the config without it reports.

Applies to the top-level `ignore` and a check's own alike, and covers `undefined`, a number and a
nested list as well as `null`.
