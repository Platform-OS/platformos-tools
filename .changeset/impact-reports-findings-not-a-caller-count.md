---
'@platformos/platformos-mcp-supervisor': minor
---

`impact` reports findings only, and costs nothing when there is nothing to find.

The `dependents` field is removed. It answered "who depends on this file", and that question
has no sound static answer: `{% render partial_name %}`, `{% include var %}` and
`{% function r = var %}` all parse and all resolve their target at runtime, so one variable
anywhere makes a file's caller set undecidable — and a caller whose file does not parse
contributes nothing either. Every count the field published was therefore a lower bound
presented as a total, and `total: 0` was read as "safe to change" by the one audience it had.
Measured on a real project: a partial called once by name and once through an assigned
variable was reported as having exactly one dependent, with nothing to say the second call
existed.

What remains is the half that is sound. `signature_risk` names the existing callers whose
arguments no longer match the `{% doc %}` contract in the buffer being validated — each
finding carried by that caller's own text, the cross-file counterpart to
`PartialCallArguments`. It is now present ONLY when non-empty: an empty array claimed
"checked, every caller matches", which a scan of the callers that happen to be visible cannot
earn.

The cheap question is now asked first, which removes the cost objection to keeping any of
this. The contract is read from the buffer already in hand; the project is read only if there
is one. A buffer with no `{% doc %}` block does no project I/O at all — on a real 2,768-file
app, where no file declares a doc block, that is every call, and the 235 ms project read
becomes 0 ms. A 10,000-file project pays the same nothing. The guard also keeps a non-Liquid
buffer from being parsed to discover it has no contract, worth ~8 ms on an 8 KB schema.

`status` is unchanged in shape: `computed` means the comparison ran, `not_applicable` that
there was no contract to compare against, `unavailable` that it could not run. None of the
three is a clearance, and the server instructions now say so outright — this server never
tells an agent that nothing depends on a file.
