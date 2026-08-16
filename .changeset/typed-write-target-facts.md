---
'@platformos/liquid-html-parser': minor
'@platformos/platformos-check-common': patch
'@platformos/prettier-plugin-liquid': patch
---

The parser now publishes the two facts about a write target that consumers were recovering by
scanning the source, and one shared helper unpicks the three tags that spell a write.

**`AssignMarkup.targetPosition`** — the span of the target alone (`x`, `x['k']`, `x.a.b`).
`name` and `lookups` could not reconstruct it: a bracket lookup's node begins INSIDE the
brackets, so the last lookup's end falls one short of the `]`, and the grammar permits
whitespace (`x [ 'k' ]` parses) that rules out any fixed offset. The CST always carried
`target` as a `ConcreteLiquidVariableLookup` and stage 2 dropped it. `hash_assign` and
`function` already published an equivalent node, so all three write tags are now uniform.

It is a `Position` rather than a node deliberately: a `Position` has no `type`, so `isNode`
rejects it and it stays invisible to the visitors and to prettier's `getVisitorKeys`. Adding
the node would have put a new child on every `{% assign %}` in every project.

**`LiquidString.unquoted`** — set by, and only by, the `dotLookup` mapping. It is the one signal
that tells `h.k` from `h['k']` after parsing, since both model the key as a `String`. Previously
the only difference was that a dot lookup's node was MISSING `single`, in violation of its own
`boolean` declaration — a type violation that two consumers had independently reasoned about and
built on, each documenting at length that it could not be trusted. `dotLookup` now sets
`single: false` as well, so no `String` node carries `undefined` in a `boolean` field.

A quoted string's node shape is unchanged: `unquoted` is absent rather than `undefined`.

`InvalidHashAssignTargetSyntax` reads the marker instead of scanning for the last `[` or `.`
between two lookups; the scan and the marker were measured to agree on every target the grammar
accepts before it was removed. `InvalidWriteTarget` reads `targetPosition` instead of scanning
forward for the `]`. The prettier printer still brackets every write target — for `hash_assign`
a dot in the last lookup is a platform parse error, so that does not depend on the signal — but
its comment no longer claims the signal does not exist.

**`write-targets.ts`** is one answer to "what does this tag write, and where is its target",
replacing six hand-rolled switches over `assign` / `hash_assign` / `function` and their casts.
It extracts only; the two consumers keep their own rules, because they answer different
questions — `variable-types.ts` asks what the write DOES to the type table and
`InvalidWriteTarget` asks whether it is LEGAL, and those trees differ (`x['k'] << v` narrows
there and is deliberately silent here).
