---
'@platformos/platformos-check-node': patch
---

A render target the app does not contain now supplies its `{% doc %}` to the checks
that read it.

`ignore` says which files are REPORTED on. It must not change what is KNOWN about a
file something else references — a partial's `{% doc %}` is its contract whether or
not the partial is itself linted. `lintApp` built `getDocDefinition` from the app,
and the app has the user's `ignore` applied, so a `{% render %}` into an ignored
module resolved to a real file with no contract. `PartialCallArguments` then fell
through to inferring the parameter list from that file's source, where a `{{ class }}`
used without `| default` looks required — and an OPTIONAL `[class]` param became a
missing required argument at every call site. `MissingRenderPartialArguments`,
`UnrecognizedRenderPartialArguments` and `ValidRenderPartialArgumentTypes` went the
other way and skipped those call sites entirely. The language server never had either
problem, because `DocumentManager.preload` does not apply `ignore`.

`getDocDefinition` now falls back to reading and parsing a target the app does not
contain, memoized per run exactly like the targets it does — and only for a target
some check actually resolved, so nothing is read to build the map. The file is not
added to the app: it is still not reported on.

On a real project (which ignores eleven modules and renders from them),
`pos-cli check` goes from 43 offenses to 31: 17 false "Required parameter class /
value" disappear, and 5 real ones appear that the type and argument checks had been
skipping — including two the module author had already worked around with a
`platformos-check-disable` comment. check-node and the language server now report the
same offenses for that project, file for file.
