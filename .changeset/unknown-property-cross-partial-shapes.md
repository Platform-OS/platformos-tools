---
'@platformos/platformos-check-common': patch
---

`UnknownProperty` resolves shapes through partial boundaries and GraphQL conditionals,
and stops inventing shapes it does not know.

The check reported `Unknown property 'r' on 'relation'` on correct code, and the cause
was not the query it came from — it was a write four lines earlier. `hash_assign
relation['_incoming_changes'] = data`, on a variable of unknown shape, built a brand-new
object shape containing only the key being assigned and published it as authoritative,
so `relation` was thereafter believed to have exactly one property. Ignorance became a
claim. `assign x['a'] = …`, `assign list << item` and `function x['k'] = 'partial'` did
the same thing, and `assign` was worse: it recorded the VALUE's shape as the BASE's,
clobbering a known base rather than narrowing it. All three write tags now go through
one rule — a write at a path NARROWS a known shape and claims nothing about an unknown
one — and a dynamic key (`x[key]`) claims nothing at all.

Four things the check could not see, it now sees:

- **Fragments.** `results { id ...record }` left the spread's fields invisible, so
  reading any of them was a false positive. `FragmentSpread` and `InlineFragment` now
  resolve, transitively, nested inside field selections, and cyclic pairs terminate. An
  absent fragment definition leaves the level unchanged.
- **`@include` / `@skip`.** A conditional field was treated as unconditionally present,
  which is a false NEGATIVE: a query that excludes a field said nothing when you read
  it. Conditional fields are now resolved against the `graphql` tag's argument values —
  a literal, a tracked boolean, or the variable's declared default in the query itself.
  Forwarded from a value the check cannot prove, the field stays unknown and nothing is
  reported.
- **`function` return shapes.** The handler closed the variable's shape range and moved
  on, so a variable assigned from a partial had no shape and NO lookup through it was
  ever validated. The callee is now analyzed with the call site's arguments bound, so a
  partial that returns `r.records.results.first` gives its caller the shape the query
  defines. `include` is not a call boundary and is not treated as one.
- **Custom GraphQL scalars.** `Record.properties: HashObject` holds a hash, so it is
  unknown rather than a primitive.

That combination is what makes the payoff possible: the same partial called with
`include_related: true` is silent, and called without it — where the query declares
`Boolean = false` — reports. It was already in the wild. On two real projects, a
`relationship_created` consumer calls `queries/relationships/find_by_id` with no
`include_related` and reads `relationship.r.type`; that consumer is dead code, and the
check now says so.

Seven more false-positive classes the sweep turned up, each with a regression test:

- An empty hash (`{}`) is a PLACEHOLDER, not a hash with no keys — `{ "errors": {} }`
  gets filled two partials away through the reference Liquid hands out. Empty objects
  are `open`. A write we can SEE still closes the level.
- A `parse_json` body with an interpolated value (`{ "id": {{ object.id | json }} }`) is
  not JSON; dropping the output tags leaves a document a tolerant parser still reads,
  one key short of the truth. Such a body claims nothing.
- A filter after `parse_json` that changes the value (`| hash_merge:`) invalidates the
  claim — 23 reports of `site.settings` on one project.
- A write inside one conditional branch is not a fact about a sibling branch or about
  the code after the `endif`. Writes are bounded by their enclosing `LiquidBranch`.
- A partial that mutates through an alias — a `for` item, an `assign` copy, a dynamic
  key — returns a `deepOpen` shape: what it names is still checked, "no such field" is
  withdrawn.
- `.size` is defined on every Liquid value.
- An array with no known item shape can verify nothing about an item.

Measured with `pos-cli check` (all checks, whole project, two runs each), `UnknownProperty`
offenses before → after, across four real projects: 297 → 10, 602 → 35,
pos-module-community 3 → 5, and 0 → 0. 871 offenses disappeared and 22 appeared; every one of the 22 was read
against the partial or query it came from and is a real bug — a command returning
`{url, photo, name}` read as `actor.avatar`, a `filters` partial writing `tags` read as
`filters.tag`, a query selecting `roles` in `load.graphql` but not `find.graphql`, a
fragment with no `currency` field read as `item.currency`. No false positive survived the
sweep.

Reading other files costs nothing measurable, because the false-positive paths that were
doing the most work now short-circuit: on the two largest projects, 110.9 / 108.5 s →
102.5 / 102.5 s (6% faster) and 114.1 / 113.9 → 112.1 / 112.6 s. Cross-partial analysis is memoized on
`(callee uri, callee source, bindings)` with a read log that revalidates a hit, so a
long-lived language server cannot serve a shape derived from a `.graphql` file that has
since been edited.

Flow insensitivity and alias mutation are handled by WITHDRAWING claims rather than by
merging branches: after a conditional write, or at a partial boundary that mutates
through an alias, the variable is unknown. Both are cheap and safe; a real dataflow pass
would recover the precision and neither is worth one yet.

The check is now three modules — `property-shape.ts` (the shape value type and GraphQL
inference), `shape-analysis.ts` (writes, values, cross-partial returns, memoization) and
`index.ts` (dependency wiring and reporting).
