---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
---

Anchor an `ignore` pattern on the project root when it carries a slash, the way `.gitignore`
reads it.

`modules/<name>/**` is what the documentation tells you to write to drop a vendored module,
and it used to be rewritten to `**/modules/<name>/**` — "match at any depth". So it also
silenced the FIRST-PARTY `app/modules/<name>`, which is where a platformOS app keeps its own
modules. Nothing reported the suppression, because an ignored file produces no offense for
anyone to miss: measured on a real project, a page with six offenses — two of them `ERROR`,
including an unknown tag — produced zero diagnostics in the editor, while the same file
outside `app/modules` produced all six.

A pattern with a slash anywhere but the very end is now relative to the project root; a bare
name still matches at any depth, and covers what is inside it as well as a file of that name,
since the subject is always a file. A leading `/` keeps working and is now redundant.

| pattern | matches |
|---|---|
| `modules/user/**` | `<root>/modules/user/**` only — `app/modules/user` is linted again |
| `node_modules` | any depth, including its contents |
| `node_modules/**` | `<root>/node_modules/**` only — **changed** |
| `**/node_modules/**` | any depth, spelled explicitly |
| `*.liquid` | any depth, unchanged |

Breaking for a config that relied on a slash-bearing pattern reaching any depth. Write `**/`
in front of it to keep that. The factory configs' default is now the slash-less
`node_modules`, so it still reaches a nested one.
