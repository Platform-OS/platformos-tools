---
'@platformos/platformos-check-common': patch
---

A check that dies part-way through a file no longer looks like a clean file.

`extract-undefined-variables.ts` read `markup.name.lookups` off a `{% function %}` tag
after testing only the tag NAME. The tolerant parser leaves `markup` a raw string when the
strict rule fails — `… | dig 'results'`, a filter missing its colon, which is what real
code writes — so the read threw, and the throw aborted the rest of the file for whichever
check was walking it. On one real project `PartialCallArguments` reported zero offenses on
a 700-line layout for that reason. `UndefinedObject` had the same unguarded
read, and the audit turned up a third in `url-helpers.ts`: `tryExtractAssignUrl` read
`.lookups` off a malformed `{% assign %}`, taking `MissingPage`'s remaining findings for
that file — and the language server's page-route definitions — with it. All three now guard
on the markup type, the way their neighbours already did.

The silence was the worse half. `check()` handed a pipeline rejection to `config.onError`,
which no host sets, so it defaulted to doing nothing: an offense set that shrank because a
check crashed was indistinguishable from a file with nothing wrong. A failure is now
recorded as an offense under a dedicated `CheckError` code — never the failing check's own,
so nobody counting that check's offenses is handed one it did not produce — naming the
check and what it said. `onError` still fires for a host that installs one.

That surfacing immediately found a second, unrelated crash on the first project measured:
`MatchingTranslations` was throwing on all 26 of that project's Arabic translation files,
none of which had ever been checked.

Recovered on that project: **+54 offenses, none lost** — 28 real findings the throws had
been eating (`Required parameter object must be passed…` across several commands and a
consumer, `Unknown object 'filters'/'items' used.` on four admin pages) plus the 26
internal errors, now visible.
