---
'@platformos/platformos-check-common': minor
'@platformos/platformos-mcp-supervisor': patch
---

Add `ConflictingSchemaPropertyType`: one property name declared with two different types
across the project's schemas, which the platform resolves as a single ambiguous name.

```yaml
# app/schema/access_token.yml
properties:
  - name: expires_at
    type: string

# app/schema/order.yml — a different table, and that is the point
properties:
  - name: expires_at
    type: integer
```

**Why this is not two local facts.** The platform's property-type lookup takes a NAME and no
owning schema, so every declaration of that name answers together — in any table, profile,
transactable or `user.yml`, app or module, instance-wide. Neither file above is wrong on its
own, which is why no per-document rule can see it and why this check reads every
property-bearing schema.

**What it costs, measured on the platform.** A `range` filter compiles to
`properties->>'name'` — a text compare — only while every declared type is string-ish
(`string`, `date`, `datetime`); one declaration outside that set switches it to
`properties->'name'`, a jsonb compare, and the bound value is then coerced to JSON:

```
range: { gt: "2026-09-15T12:03:07+0000" }   →  invalid input syntax for type json.  Token "-09" is invalid.
range: { gt: "2026" }                       →  parses as a JSON number, matches nothing, reports no error
```

So adding an unrelated `expires_at: integer` to a second schema breaks a working query
against the FIRST one, with nothing about that schema having changed — and the value that
does not error is the worse outcome of the two, because it silently returns no rows. The
`property_type:` argument does not rescue it: the range filter ignores it.

Reported at each declaration, since neither is the wrong one and the reader may be at either.
Deliberately a warning, not an error: a conflict deploys successfully, and `string` beside
`date` is ambiguous without breaking any query today.

Scoping. A type the platform rejects outright is left to `InvalidSchemaPropertyType` — a
schema that cannot deploy never becomes one of the declarations a query resolves against. A
`modules/<name>/…` file that an `app/modules/<name>/…` copy shadows is not counted against
its own overwrite, which is the normal way to retype an installed module's property.
