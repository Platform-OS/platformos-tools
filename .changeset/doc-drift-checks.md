---
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
---

Report `{% doc %}` drift on the partial that can fix it, not on the call site.

A `{% doc %}` block is a declared contract and is treated as the source of truth: what it
says is required IS required at every call site. The corollary is that when the doc and the
implementation disagree, the defect is in the PARTIAL, and the diagnostic belongs there.
`UnusedDocParam` already covered one direction of that drift. Two checks complete it.

**`RequiredDocParamWithDefault` (warning, auto-fixable)** — a parameter the doc declares as
required that the partial then reads through `| default`. Supplying the default is evidence
the author handled the missing value, so the declaration almost certainly meant `[param]`.
`modules/common-styling/forms/upload.liquid` on `pos-module-community` is the case that
prompted this: its doc declares eight parameters, none bracketed, and its body opens with
`assign image_editor_enabled = image_editor_enabled | default: false`. Two callers omit that
argument and each got `Missing required argument`, on files that cannot fix the doc. One
warning now lands on the partial, and the fix — bracketing the name in place, leaving type
and description untouched — clears the call-site errors everywhere at once. It is safe to
apply unattended, since making a parameter optional only widens what a caller may omit. The
alternative, teaching the call-site check to believe the source over the doc, was tried and
reverted: it treats the symptom and leaves the doc wrong for hover, completion and
`backfill-docs`.

**`MissingDocParam` (error)** — a variable the partial reads from its caller and does not
declare. The mirror of `UnusedDocParam`, and not a cosmetic omission: the call-site checks
read the doc as the complete parameter list, so an undeclared input is simultaneously
required by the implementation and impossible to pass — `UnrecognizedRenderPartialArguments`
reports it as an unknown argument at every call site that tries. Reported once per variable,
at its first read, with a suggestion that inserts the declaration after the last existing
`@param`. No type is emitted with it: nothing at a READ says what a caller should pass, and
a guessed `{string}` would be a claim `ValidDocParamTypes` and the type checks then act on.

Both run on partials only, and only where the doc declares at least one `@param` — a doc
holding only an `@description` declares no contract, and `PartialCallArguments` owns those
partials by inferring the parameter list from the source. Objects in scope inside every
partial (`context`, `app`, …) are never reported.

`UndefinedObject` cedes the undeclared inputs of a documented partial to `MissingDocParam`,
so nothing is reported twice. The split is by definition, not by file: a name nothing in the
file defines is an input the caller was meant to pass, and `MissingDocParam` owns it; a name
the file DOES define and reads out of that definition's reach — a `for` variable after its
loop, a value read before its `assign` — is a scope error no `@param` would fix, and stays
with `UndefinedObject`. The two conditions are complements, so every name still draws exactly
one report: measured on `platformos-blog` and `project-e`, the single
`Unknown object 'data' used.` warning on `modules/user/public/lib/queries/api_call.liquid`
became the single `MissingDocParam` error on the same read — a partial that forwards
`data: data` to a GraphQL call while declaring only `api_template` and `timeout`, so no
caller can supply it.

Both checks share the per-file analysis the call-site checks already run, which now also
reports which names the file defines and which of the optional ones it defaults ITSELF. That
last distinction is what keeps a `| default` FALLBACK source out of
`RequiredDocParamWithDefault`: in `assign profile = profile | default: params.profile` it is
`profile` the partial handles the absence of, while `params` is only what it falls back on.
The analysis is memoized on `(source, in-scope names)` and now takes the parse its caller
already holds, so between the two checks a documented partial costs one walk and no parse.

Measured on real projects. `RequiredDocParamWithDefault`: 122 offenses over 56 files on
`platformos-blog`, 111 over 48 on `project-e`, 17 over 7 on `pos-module-community` with its
vendored modules unignored — every one a doc backfilled as required over a body that
defaults it, each with the safe fix. `MissingDocParam`: 1 offense on each of
`platformos-blog` and `project-e`, 0 on `pos-module-community` and on three client
projects, and the one it finds is a real defect.
