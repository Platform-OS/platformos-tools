---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': minor
'@platformos/platformos-mcp-supervisor': patch
---

Add `InvalidSchemaPropertyType`: a schema property type the platform rejects was reported by
nothing, and recorded in three places as something the platform accepts.

```yaml
# app/schema/thing.yml
properties:
  - name: bogus
    type: not_a_real_type
```

A real deploy rejects it — `Attribute type \`not_a_real_type\` is not allowed. Valid attribute
types: string, integer, float, …` — and a rejection fails the whole changeset.

**Why it was believed otherwise.** Every prior measurement used `pos-cli deploy --dry-run`,
which accepts the file. The dry run returns before `persist_slice!`, so the nested
`CustomAttributeConverter` that validates the type never runs. That silence was written down
as evidence in `blocking.ts`, in `YAMLSyntaxError`'s docblock and in the MCP server's own
instructions to agents; all three are corrected. What survives is the narrower, true claim:
schema-SHAPE validation is scoped out because no check covers it, not because the platform
is permissive.

Measured against the live instance, by real deploy rather than dry run:

| Case | Deploy |
|---|---|
| `type: not_a_real_type` | rejected |
| `type: String` — a valid type, wrong case | rejected (the model's `inclusion:` is literal) |
| unknown top-level key | rejected — `Available properties are: metadata, name, properties` |
| unknown property-level key | rejected |
| duplicate property names | **accepted** |
| `properties:` as a mapping rather than a sequence | rejected |

The check covers the property `type` across all four file types whose `properties:` are
converted by `CustomAttributeConverter` — `schema/`, `transactable_types/`,
`instance_profile_types/` and `user.yml` — confirmed on the instance for a table and for
`user.yml`. It is an error and blocks the write.

`SCHEMA_PROPERTY_TYPES` and `PROPERTY_BEARING_FILE_TYPES` live in `platformos-common` beside
the other converter-derived facts, and the type list is pinned by a literal rather than
derived, because it is our transcription of a platform constant and a corrupted list would
otherwise move every test with it.

The unknown top-level key is measured and still unreported; it is tracked separately rather
than folded in here. `schema-table.ts`'s docblock example, which showed the mapping form, is
corrected — that form does not deploy.

Also new: a `deploy` provenance oracle in the supervisor's silence fixtures. Labelling this
evidence `dry-run` would have been false, since the dry run accepts the very shapes at issue.
