---
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
---

A missing argument at an `{% include %}` site is a warning about explicitness, not an error —
and no call-site offense names a tag the author did not write.

`{% include %}` runs the partial in the CALLER'S scope. A variable the target reads and the
call does not pass is therefore not missing: it resolves from the caller, and nothing is
broken. `PartialCallArguments` reported it as `Required parameter X must be passed to render
call` at `Severity.ERROR`, which is wrong twice over — the claim, and the tag name.

**`ImplicitIncludeArguments` (warning)** takes over that direction. It says what is actually
true: `Partial 'x' reads 'order', which the include does not pass — it resolves from the
caller's scope. Pass it explicitly.` A separate code rather than a softened severity, because
severity is per check and per-check overridable, so a team that uses `include` deliberately
can turn the explicitness rule off without losing the real `render` errors. The suggestion
inserts `, order: order`, which hands over the same value the partial was reading from the
caller anyway. The platform-supplied names are included, not exempted — `content_for_layout`
in a layout, `forloop` inside a caller's `{% for %}` are exactly the inherited-scope reliance
the warning exists to surface, and each can be passed explicitly.

Documented targets keep the ERROR. `MissingRenderPartialArguments` still reports a missing
required `@param` at an include site, because a `{% doc %}` block is a declared contract and
the ecosystem already honours it there — the `can_do_or_*` helpers in `pos-module-community`
are included with every documented param passed explicitly, down to `entity: null`. Only the
INFERRED path warns, since inference cannot tell a deliberately scope-sharing helper from a
partial that wanted an argument. The unknown-ARGUMENT direction is unchanged too: passing
something the target never reads is a real mistake whichever tag was used.

`include` is not deprecated, and this is not a step towards removing it. The live docset marks
no tag deprecated and describes `include` as what to reach for "when the partial must run in
the caller's scope"; `{% break %}` crosses an include boundary and stops at a render one,
which is why the `can_do_or_unauthorized` / `can_do_or_redirect` authorization helpers work at
all. Converting those call sites to `render` would silently keep rendering a page after a
denied check.

**Wording, everywhere.** `{% render %}`, `{% include %}` and `{% theme_render_rc %}` all parse
to the same `RenderMarkup` node, so a check that words its message from the node type names a
tag that may not be in the file. `callSiteTag` reads the enclosing `LiquidTag` instead — the
tag's own name is the answer — and all four call-site checks now use it:
`PartialCallArguments`, `MissingRenderPartialArguments`,
`UnrecognizedRenderPartialArguments` and `DuplicateRenderPartialArguments`, including the
`with … as` alias branch of the third. `theme_render_rc` was being called "render" too, and
now names itself. Since every one of those tag names is also a `DocumentType`, the same answer
resolves the target as well as wording the message.

Measured on the project where the two false ERRORs were found: a layout's
`content_for_layout` (in scope in a layout) and a partial's `forloop` (in scope inside the
caller's loop) are now warnings, while the true positives on a partial reading
`{{ forloop.index }}` outside any loop of its own — so its output is always empty — still
report as `PartialCallArguments` errors at the two `render` sites that omit it. The `role`
argument that same include passes and its target never reads stays an error too, now worded
`Unknown parameter role passed to include call`.

Project-wide the split is 6270 errors + 1231 warnings against 7491 errors before, and 1221 of
the 1231 warnings are the same findings under a new code. The other 10 are findings the old
check never reached: `extractUndefinedVariables` throws on a `{% function %}` tag whose markup
the parser left unstructured, and the throw aborts the rest of that file for the check, so a
syntax error in one partial costs offenses in every file that calls it.
`ImplicitIncludeArguments` reaches those sites because it returns before analyzing anything at
a non-`include` call site. That crash is pre-existing and is filed separately — fixing two
occurrences of it recovered 156 offenses, and left this check's 1231 warnings untouched in
both runs. Nothing here depends on it.
