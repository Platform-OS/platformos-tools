---
'@platformos/platformos-check-common': patch
---

`UnknownProperty` binds `for` and `tablerow` loop variables, and answers `size` on a hash.

`for` is a write — it binds its loop variable — and the check did not treat it as one. When
the loop variable reused the name of a variable that already had a shape, the outer shape
stayed in force inside the body, so every property of the ITEM was checked against the shape
of the COLLECTION's source. `pos-module-community` could not remove six
`platformos-check-disable UnknownProperty` directives for that reason: in
`activities/users/audience.liquid`, `for r in relationships['followship:profile']` follows a
`graphql r = …` four lines earlier, and the correct `r.l_id` was reported as unknown.

The loop variable now takes the ITEM shape of the iterated value over the loop BODY, and the
outer value comes back at `{% endfor %}` — Liquid pushes a scope for the loop variable, so
past the loop the name means again what it meant before. Only a list whose item shape is
known says anything: a hash iterates as `[key, value]` pairs and a `group_by` result indexed
by key is opaque, so those bind nothing rather than pass the collection's own shape off as the
item's. A loop whose markup did not parse now forgets every tracked shape instead of leaving a
stale one in force. `tablerow` goes through the same path. TASK-58's alias rule is preserved:
a loop item is a REFERENCE into the collection, so a partial that writes through one still
returns a `deepOpen` shape.

The read side removes false positives; the item side finds real bugs, because a loop over a
GraphQL result is now checked against the query's selection set. On the largest project
measured: −2 false positives, **+13 true ones** — an analytics CSV export reading
`analytic.min_price` / `max_price` / `profile_id` from a query that selects `price_min`,
`price_max` and `porfile_id` (a typo in the query, so three columns have always been empty),
a migration whose `organization.delivery_fee_countryside` guard was always false, and four
reads through an `item_inventory` relation the query does not select. On a second project:
−20 false positives, +2 true ones (`review.vendor_response`, read twice from a query that
never selects it).

Separately, `size` is now answered on an object shape. It is the number of keys on a hash,
as it is a count on an array and a length on a string, and it is answered AFTER the
properties — a hash that has its own `size` key reads through to that value, because Liquid
looks the key up first. `form.errors.count` still reports.
